import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { type ChargeDetail, ChargeState, Direction, ProofKind, zonedInstant } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { Db, DbClient } from '../../database';
import { ProofDeclarationForbiddenError } from '../../proofs/errors';
import { ProofRepository } from '../../proofs/repositories/proof';
import { ChargeClosedError, ChargeNotPaidError, SilenceUnavailableError } from '../errors';
import { ChargeRepository } from '../repositories/charge';
import { StoredProofState } from '../schemas/charge';
import { ownerOf, ownerPays, owns } from '../utils/columns';
import { chargeForActor, confirmationRequired } from './access';

export type ChargeClient = {
  /** The detail as `actorId` sees it; owner, creditor and debtor may read, anyone else is refused. */
  get(actorId: string, id: string): Promise<ChargeDetail>;
  /**
   * Whoever collects settles by hand, and a file or declaration waiting in review counts as accepted. The owner
   * of a conta a pagar settles alone only when no payee can confirm; otherwise they declare the payment.
   */
  pay(actorId: string, id: string, now?: Date): Promise<ChargeDetail>;
  /** Only the owner cancels a single charge, and a conta a pagar is ended as a whole instead. */
  cancel(actorId: string, id: string): Promise<ChargeDetail>;
  /**
   * Undoes a settlement: the charge is pending again and whatever proof the settlement had answered goes back
   * to review. The same people who may settle a charge may take it back.
   */
  reopen(actorId: string, id: string): Promise<ChargeDetail>;
  /**
   * The creditor of a conta a receber pauses or resumes the automatic notices of one pending charge. Anyone else
   * gets a 404; sending the value already stored answers without writing or recording anything.
   */
  setNotify(actorId: string, id: string, notify: boolean, now?: Date): Promise<ChargeDetail>;
};

export declare class ChargeService extends Factory.Service<ChargeClient> {
  handler: typeof createService;

  services: {
    db: Environment.Service<Db>;
  };
}

function record(tx: DbClient, chargeId: string, actorId: string, type: string, now: string, payload?: Record<string, unknown>) {
  return EventRepository.record(tx, { type, eventableType: EventableType.Charge, eventableId: chargeId, actorId, payload, at: now });
}

/**
 * A registro's charge settles on its own due date: paid at the start of that day in the billing timezone, recorded as
 * `charge.paid { via: 'registered' }` by the owner. The caller has already checked it is pending.
 */
export async function markRegistered(tx: DbClient, row: ChargeRepository.Row, timezone: string, now: string): Promise<ChargeRepository.Row> {
  await ChargeRepository.markPaid(tx, row.id, zonedInstant(row.due_date, '00:00', timezone), now);
  await record(tx, row.id, ownerOf(row), 'charge.paid', now, { via: 'registered' });

  const updated = await ChargeRepository.get(tx, row.id);

  if (!updated) {
    throw new HttpNotFoundError();
  }

  return updated;
}

async function pay(db: DbClient, actorId: string, id: string, now: Date): Promise<ChargeDetail> {
  return db.transaction(async (tx) => {
    const { row, direction } = await chargeForActor(tx, actorId, id, true);

    if (direction !== Direction.Receivable && !owns(row, actorId)) {
      throw new HttpForbiddenError();
    }

    if (row.state !== ChargeState.Pending) {
      throw new ChargeClosedError();
    }

    if (direction === Direction.Payable && (await confirmationRequired(tx, row))) {
      throw new ProofDeclarationForbiddenError();
    }

    const stamp = now.toISOString();
    const proof = await ProofRepository.current(tx, id, true);
    const answering = proof?.state === StoredProofState.Pending;
    const declaration = proof?.kind === ProofKind.Declaration;

    if (answering) {
      await ProofRepository.answer(tx, proof!.id, { state: StoredProofState.Accepted, dropFile: declaration }, stamp);
    }

    await ChargeRepository.markPaid(tx, id, stamp, stamp);

    if (answering) {
      await record(tx, id, actorId, 'proof.accepted', stamp, { name: declaration ? undefined : proof?.file?.name });
    }

    await record(tx, id, actorId, 'charge.paid', stamp, { via: answering ? (declaration ? 'declaration' : 'proof') : 'manual' });

    return ChargeRepository.dto(tx, row, actorId);
  });
}

async function cancel(db: DbClient, actorId: string, id: string): Promise<ChargeDetail> {
  return db.transaction(async (tx) => {
    const { row } = await chargeForActor(tx, actorId, id, true);

    if (!owns(row, actorId) || ownerPays(row)) {
      throw new HttpForbiddenError();
    }

    if (row.state === ChargeState.Cancelled) {
      return ChargeRepository.dto(tx, row, actorId);
    }

    if (row.state !== ChargeState.Pending) {
      throw new ChargeClosedError();
    }

    const now = new Date().toISOString();

    await ChargeRepository.markCancelled(tx, id, now);
    await record(tx, id, actorId, 'charge.cancelled', now);

    return ChargeRepository.dto(tx, row, actorId);
  });
}

async function reopen(db: DbClient, actorId: string, id: string): Promise<ChargeDetail> {
  return db.transaction(async (tx) => {
    const { row, direction } = await chargeForActor(tx, actorId, id, true);

    if (direction !== Direction.Receivable && !owns(row, actorId)) {
      throw new HttpForbiddenError();
    }

    if (row.state !== ChargeState.Paid) {
      throw new ChargeNotPaidError();
    }

    const now = new Date().toISOString();
    const proof = await ProofRepository.current(tx, id, true);

    // A file the settlement had accepted goes back under review; a manual settlement never touched it.
    if (proof?.state === StoredProofState.Accepted) {
      await ProofRepository.reopen(tx, proof.id, now);
    }

    await ChargeRepository.markPending(tx, id, now);
    await record(tx, id, actorId, 'charge.reopened', now);

    return ChargeRepository.dto(tx, row, actorId);
  });
}

async function setNotify(db: DbClient, actorId: string, id: string, notify: boolean, now: Date): Promise<ChargeDetail> {
  return db.transaction(async (tx) => {
    const row = await ChargeRepository.get(tx, id, true);

    if (!row || !owns(row, actorId)) {
      throw new HttpNotFoundError();
    }

    if (ownerPays(row)) {
      throw new SilenceUnavailableError();
    }

    if (row.state !== ChargeState.Pending) {
      throw new ChargeClosedError();
    }

    if (row.notify === notify) {
      return ChargeRepository.dto(tx, row, actorId);
    }

    const stamp = now.toISOString();

    await ChargeRepository.setNotify(tx, id, notify, stamp);
    // The event names are history already written: they keep the old wording on purpose.
    await record(tx, id, actorId, notify ? 'charge.unsilenced' : 'charge.silenced', stamp);

    return ChargeRepository.dto(tx, row, actorId);
  });
}

export function createService({ db }: Service.Context<ChargeService>): ChargeClient {
  return {
    get: async (actorId, id) => ChargeRepository.dto(db, (await chargeForActor(db, actorId, id)).row, actorId),
    pay: (actorId, id, now = new Date()) => pay(db, actorId, id, now),
    cancel: (actorId, id) => cancel(db, actorId, id),
    reopen: (actorId, id) => reopen(db, actorId, id),
    setNotify: (actorId, id, notify, now = new Date()) => setNotify(db, actorId, id, notify, now)
  };
}
