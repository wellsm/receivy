import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { ChargeState, type ContactLedger, Direction } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { directionOf } from '../../charges/utils/columns';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { Db, DbClient } from '../../database';
import type { AvatarFiles } from '../../storage';
import { AvatarRepository } from '../../users/repositories/avatar';
import { TimelineOverflowError } from '../errors';

export type LedgerClient = {
  contact(userId: string, contactId: string, cursor?: string): Promise<ContactLedger>;
};

export declare class LedgerService extends Factory.Service<LedgerClient> {
  handler: typeof createService;

  services: {
    db: Environment.Service<Db>;
    avatarFiles: Environment.Service<AvatarFiles>;
  };
}

const PAGE_SIZE = 50;
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function money(amountCents: bigint) {
  if (amountCents < -MAX_SAFE_CENTS || amountCents > MAX_SAFE_CENTS) {
    throw new TimelineOverflowError();
  }

  return { amountCents: Number(amountCents), currency: 'BRL' as const };
}

/** What is still open in one direction, summed exactly: cents past the safe range are an overflow, never a rounding. */
function pendingTotal(rows: ChargeRepository.Row[], userId: string, direction: Direction): bigint {
  return rows
    .filter((row) => row.state === ChargeState.Pending && directionOf(row, userId) === direction)
    .reduce((total, row) => total + BigInt(row.amount_cents), 0n);
}

/**
 * Every charge between the viewer and one contact, whichever of them owns the billing. The rows come in
 * one read, ordered by id: the totals sum all of them, the page starts after the cursor.
 */
export async function contactLedger(db: DbClient, userId: string, contactId: string, cursor?: string): Promise<ContactLedger> {
  const { userId: otherId } = await ContactRepository.user(db, userId, contactId);
  const all = await ChargeRepository.between(db, userId, otherId);
  const after = cursor ? all.filter((row) => row.id > cursor) : all;
  const page = after.slice(0, PAGE_SIZE);

  return {
    contactId,
    contact: await ContactRepository.get(db, userId, contactId),
    receivable: money(pendingTotal(all, userId, Direction.Receivable)),
    payable: money(pendingTotal(all, userId, Direction.Payable)),
    charges: await ChargeRepository.dtos(db, page, userId),
    nextCursor: after.length > PAGE_SIZE ? page.at(-1)!.id : null
  };
}

export function createService({ db, avatarFiles }: Service.Context<LedgerService>): LedgerClient {
  return {
    contact: async (userId, contactId, cursor) => AvatarRepository.sign(avatarFiles, await contactLedger(db, userId, contactId, cursor))
  };
}
