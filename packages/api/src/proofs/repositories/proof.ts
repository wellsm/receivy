import { createHash } from 'node:crypto';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import {
  type ChargeDetail,
  ChargeState,
  Direction,
  ProofKind,
  ProofMime,
  ProofState,
  type ProofUploadInput,
  type ProofUploadTicket,
  type PublicProofState
} from '@receivy/common';
import { ChargeClosedError, ChargeInReviewError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { UnprocessableEntityError } from '../../common/errors';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { PublicLinkRepository } from '../../public/repositories/public-link';
import { lockAccountReferences } from '../../users/services/locking';
import {
  ProofDeclarationForbiddenError,
  ProofInvalidFileError,
  ProofMissingError,
  ProofPendingError,
  ProofReviewedError,
  ProofReviewInvalidError,
  ProofSizeMismatchError,
  UploadInProgressError,
  UploadMissingError
} from '../errors';
import type { UploadExpiryClient } from '../schedulers/upload-expiry';
import type { ProofStorage } from '../services/storage';
import { currentProof, type ProofRow } from './proof-row';
import { MAX_PROOF_BYTES, validateProof } from '../services/validation';
import { uploadExpiryIdentifier } from '../utils/expiry';

const KEY = /^proofs\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;
const sqlNull = null as unknown as undefined;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const userId = (actor: ProofRepository.Actor) => ('userId' in actor ? actor.userId : undefined);

/** "Nothing attached" is the absence of the row; what was there lives on in `events`. */
async function clearProof(db: DbClient, chargeId: string): Promise<void> {
  await db.proofs.deleteMany({ where: { charge_id: chargeId } });
}

async function authorize(
  db: DbClient,
  id: string,
  actor: ProofRepository.Actor,
  lock = false
): Promise<{ row: ChargeRepository.Row; direction: Direction | 'public' }> {
  if ('userId' in actor) {
    return ChargeRepository.findForActor(db, actor.userId, id, lock);
  }

  if (lock) {
    await lockAccountReferences(db, 'write');
  }

  const row = await db.charges.findOne({ select: ChargeRepository.SELECT, where: { id }, ...(lock ? { lock: true } : {}) });

  if (!row || (await PublicLinkRepository.resolveCharge(db, actor.token, actor.secret)).id !== id) {
    throw new HttpNotFoundError();
  }

  return { row, direction: 'public' };
}

function pending(row: ChargeRepository.Row) {
  if (row.state !== ChargeState.Pending) {
    throw new ChargeClosedError();
  }
}

function ownsProof(proof: ProofRow | null, actor: ProofRepository.Actor): boolean {
  return !!proof && proof.actor_hash === ProofRepository.actorHash(actor);
}

/** A file on its way over the sender's own declaration: the declaration stays under review until the bytes land. */
function declarationSlot(proof: ProofRow | null): boolean {
  return proof?.state === StoredProofState.Pending && proof.kind === ProofKind.Declaration && !!proof.file;
}

/** Whether the charge still waits for `key`: a reserved upload, or a file on its way over a declaration. */
function awaits(proof: ProofRow | null, key: string): boolean {
  if (proof?.file?.key !== key) {
    return false;
  }

  return proof.state === StoredProofState.Uploading || declarationSlot(proof);
}

export namespace ProofRepository {
  export type Actor = { userId: string } | { token: string; secret: string };

  /** How long a reserved upload slot waits for its bytes. */
  export const UPLOAD_TTL_MS = 5 * 60_000;

  export const actorHash = (actor: Actor) => hash('userId' in actor ? `user:${actor.userId}` : `public:${actor.token}`);

  /**
   * Reserves the charge's single proof slot and hands back a signed PUT. The bytes never touch the API:
   * the bucket event turns the slot into a pending proof once they land. A rejected file may be replaced;
   * a file under review may not, and another actor's live upload is not overridden.
   */
  export async function startUpload(
    db: DbClient,
    storage: ProofStorage,
    expiry: UploadExpiryClient,
    id: string,
    actor: Actor,
    input: ProofUploadInput,
    now = Date.now()
  ): Promise<ProofUploadTicket> {
    if (
      ![ProofMime.Jpeg, ProofMime.Png, ProofMime.Pdf].includes(input.mime) ||
      !Number.isSafeInteger(input.size) ||
      input.size <= 0 ||
      input.size > MAX_PROOF_BYTES ||
      !input.filename.trim() ||
      input.filename.length > 200 ||
      /[\x00-\x1f\x7f]/.test(input.filename)
    ) {
      throw new ProofInvalidFileError('Envie JPG, PNG ou PDF de até 10 MB.');
    }

    const key = `proofs/${id}/${crypto.randomUUID()}`;
    const expiresAt = new Date(now + UPLOAD_TTL_MS).toISOString();
    const stamp = new Date(now).toISOString();

    const previousKey = await db.transaction(async (tx) => {
      const { row, direction } = await authorize(tx, id, actor, true);
      const proof = await currentProof(tx, id, true);

      pending(row);

      // Only the side that pays sends files: the debtor, the owner of a conta a pagar, or the public link.
      if (direction === Direction.Receivable) {
        throw new HttpForbiddenError();
      }

      // A file under review may not be replaced, except the sender's own declaration, which the file completes.
      const ownDeclaration =
        proof?.state === StoredProofState.Pending && proof.kind === ProofKind.Declaration && ownsProof(proof, actor);

      if (proof?.state === StoredProofState.Accepted || (proof?.state === StoredProofState.Pending && !ownDeclaration)) {
        throw new ProofPendingError();
      }

      const liveUpload = proof?.state === StoredProofState.Uploading && !!proof.expires_at && Date.parse(proof.expires_at) > now;

      if (liveUpload && !ownsProof(proof, actor)) {
        throw new UploadInProgressError();
      }

      const file = { key, name: input.filename.split(/[\\/]/).at(-1)!, mime: input.mime, size: input.size };

      // The declaration stays under review, sent time and all, until the file actually lands.
      if (ownDeclaration) {
        await tx.proofs.updateOne({ where: { id: proof!.id }, data: { file, expires_at: expiresAt, updated_at: stamp } });
        await tx.charges.updateOne({ where: { id }, data: { updated_at: stamp } });

        return proof!.file?.key ?? null;
      }

      await clearProof(tx, id);
      await tx.proofs.insertOne({
        data: {
          id: crypto.randomUUID(),
          charge: { id },
          state: StoredProofState.Uploading,
          kind: ProofKind.File,
          file,
          ...(userId(actor) ? { sender: { id: userId(actor)! } } : {}),
          actor_hash: actorHash(actor),
          expires_at: expiresAt,
          created_at: stamp,
          updated_at: stamp
        }
      });
      await tx.charges.updateOne({ where: { id }, data: { updated_at: stamp } });

      return proof?.file?.key ?? null;
    });

    // The previous file (a rejected one, or an abandoned upload) has no row pointing at it any more.
    if (previousKey) {
      await storage.delete(previousKey).catch(() => undefined);
    }

    await expiry.setEvent(uploadExpiryIdentifier(id), { date: new Date(expiresAt), event: { chargeId: id, key } }).catch(() => undefined);

    return { uploadUrl: await storage.uploadUrl(key, input.mime, input.size), expiresAt };
  }

  export const enum ObjectOutcome {
    Accepted = 'accepted',
    Invalid = 'invalid',
    Ignored = 'ignored'
  }

  /**
   * The bucket said an object landed under `proofs/`. When it is the slot the charge is waiting for, the
   * bytes are validated and the slot becomes a pending proof; anything else is dropped from the bucket.
   */
  export async function receiveObject(db: DbClient, storage: ProofStorage, key: string, now = Date.now()): Promise<ObjectOutcome> {
    const chargeId = KEY.exec(key)?.[1];
    const charge = chargeId ? await db.charges.findOne({ select: ChargeRepository.SELECT, where: { id: chargeId } }) : undefined;
    const proof = charge ? await currentProof(db, charge.id) : null;

    if (!charge || !awaits(proof, key)) {
      // A redelivered event for the file already attached must leave it alone; any other object is a stray.
      if (proof?.file?.key !== key) {
        await storage.delete(key).catch(() => undefined);
      }

      return ObjectOutcome.Ignored;
    }

    const declared = proof!.file!;
    const stamp = new Date(now).toISOString();

    let validated: ReturnType<typeof validateProof> | undefined;

    try {
      const bytes = await storage.read(key);

      validated = validateProof(bytes, declared.mime);

      if (validated.size !== declared.size) {
        throw new ProofSizeMismatchError();
      }
    } catch (failure) {
      // Storage hiccups retry through the bucket event; only a definitive file failure releases the slot.
      if (!(failure instanceof UnprocessableEntityError)) {
        throw failure;
      }

      await db.transaction(async (tx) => {
        const current = await currentProof(tx, charge.id, true);

        if (!awaits(current, key)) {
          return;
        }

        // Over a declaration only the file goes: the declaration stands as it was sent.
        if (declarationSlot(current)) {
          await tx.proofs.updateOne({ where: { id: current!.id }, data: { file: sqlNull, expires_at: sqlNull, updated_at: stamp } });
        } else {
          await clearProof(tx, charge.id);
        }

        await tx.charges.updateOne({ where: { id: charge.id }, data: { updated_at: stamp } });
        await EventRepository.record(tx, {
          type: 'proof.invalid',
          eventableType: EventableType.Charge,
          eventableId: charge.id,
          actorId: proof?.sender_user_id ?? null,
          payload: { name: declared.name, mime: declared.mime, size: declared.size, reason: failure.message },
          at: stamp
        });
      });

      await storage.delete(key).catch(() => undefined);

      return ObjectOutcome.Invalid;
    }

    const outcome = await db.transaction(async (tx): Promise<'accepted' | 'attached' | 'stray'> => {
      const current = await currentProof(tx, charge.id, true);

      if (!awaits(current, key)) {
        return current?.file?.key === key ? 'attached' : 'stray';
      }

      // The file replaces a declaration it was sent over.
      await tx.proofs.updateOne({
        where: { id: current!.id },
        data: {
          state: StoredProofState.Pending,
          kind: ProofKind.File,
          file: { ...declared, sha256: validated!.sha256 },
          expires_at: sqlNull,
          sent_at: stamp,
          updated_at: stamp
        }
      });
      await tx.charges.updateOne({ where: { id: charge.id }, data: { updated_at: stamp } });
      await EventRepository.record(tx, {
        type: 'proof.uploaded',
        eventableType: EventableType.Charge,
        eventableId: charge.id,
        actorId: proof?.sender_user_id ?? null,
        payload: { name: declared.name, mime: declared.mime, size: declared.size },
        at: stamp
      });

      return 'accepted';
    });

    if (outcome === 'stray') {
      await storage.delete(key).catch(() => undefined);
    }

    return outcome === 'accepted' ? ObjectOutcome.Accepted : ObjectOutcome.Ignored;
  }

  /**
   * The client says its PUT finished. It does the bucket event's work, so whichever arrives first attaches
   * the file and the other finds nothing to do; it also covers the local emulator, which never fires the event.
   */
  export async function completeUpload(
    db: DbClient,
    storage: ProofStorage,
    id: string,
    actor: Actor,
    now = Date.now()
  ): Promise<ChargeRepository.Row> {
    // Authorizes the actor against the charge; the proof itself is what the rest of this reads.
    await authorize(db, id, actor);

    const proof = await currentProof(db, id);
    const key = proof?.file?.key;

    if (!key || !ownsProof(proof, actor) || (proof!.state !== StoredProofState.Uploading && proof!.state !== StoredProofState.Pending)) {
      throw new UploadMissingError();
    }

    if (awaits(proof, key)) {
      if (!(await storage.exists(key))) {
        throw new UploadMissingError('O arquivo não chegou ao armazenamento. Envie novamente.');
      }

      if ((await receiveObject(db, storage, key, now)) === ObjectOutcome.Invalid) {
        throw new ProofInvalidFileError();
      }
    }

    const settled = await currentProof(db, id);

    if (settled?.state !== StoredProofState.Pending || settled.file?.key !== key || declarationSlot(settled)) {
      throw new UploadMissingError();
    }

    const current = await db.charges.findOne({ select: ChargeRepository.SELECT, where: { id } });

    if (!current) {
      throw new HttpNotFoundError();
    }

    return current;
  }

  /** Releases a reserved slot nobody filled; the scheduler calls it, and a retry finds nothing to do. */
  export async function expireUpload(db: DbClient, storage: ProofStorage, chargeId: string, key: string): Promise<boolean> {
    const outcome = await db.transaction(async (tx): Promise<'released' | 'attached' | 'stray'> => {
      const current = await currentProof(tx, chargeId, true);

      if (!awaits(current, key)) {
        // The bytes landed in time and the file is the charge's proof now: the schedule fires anyway, harmlessly.
        return current?.file?.key === key ? 'attached' : 'stray';
      }

      const stamp = new Date().toISOString();

      // Over a declaration only the file goes: the declaration stands as it was sent, still in review.
      if (declarationSlot(current)) {
        await tx.proofs.updateOne({ where: { id: current!.id }, data: { file: sqlNull, expires_at: sqlNull, updated_at: stamp } });
      } else {
        await clearProof(tx, chargeId);
      }

      await tx.charges.updateOne({ where: { id: chargeId }, data: { updated_at: stamp } });

      return 'released';
    });

    if (outcome !== 'attached') {
      await storage.delete(key).catch(() => undefined);
    }

    return outcome === 'released';
  }

  /** The sender takes back a file nobody reviewed yet; the row and the bytes go, so another one can go up. */
  export async function withdraw(db: DbClient, storage: ProofStorage, id: string, actor: Actor, now = Date.now()): Promise<void> {
    const key = await db.transaction(async (tx) => {
      const { row } = await authorize(tx, id, actor, true);
      const proof = await currentProof(tx, id, true);

      pending(row);

      if (!proof || !ownsProof(proof, actor)) {
        throw new HttpNotFoundError();
      }

      if (proof.state !== StoredProofState.Pending && proof.state !== StoredProofState.Uploading) {
        throw new ProofReviewedError();
      }

      const stamp = new Date(now).toISOString();

      await clearProof(tx, id);
      await tx.charges.updateOne({ where: { id }, data: { updated_at: stamp } });
      await EventRepository.record(tx, {
        type: 'proof.withdrawn',
        eventableType: EventableType.Charge,
        eventableId: id,
        actorId: userId(actor) ?? null,
        payload: { name: proof.file?.name, mime: proof.file?.mime, size: proof.file?.size },
        at: stamp
      });

      return proof.file?.key ?? null;
    });

    if (key) {
      await storage.delete(key).catch(() => undefined);
    }
  }

  /**
   * The paying side says it already paid, without a file: the charge waits in review for the other side. The
   * sender's own abandoned upload is dropped; anything under review, or someone else's live upload, refuses.
   */
  export async function declare(
    db: DbClient,
    storage: ProofStorage,
    id: string,
    actor: Actor,
    now = Date.now()
  ): Promise<ChargeRepository.Row> {
    const { declared, previousKey } = await db.transaction(async (tx) => {
      const { row, direction } = await authorize(tx, id, actor, true);
      const proof = await currentProof(tx, id, true);

      pending(row);

      // Whoever collects answers a declaration; they never send one.
      if (direction === Direction.Receivable) {
        throw new ProofDeclarationForbiddenError();
      }

      // The owner of a conta a pagar declares only to a payee who can confirm; otherwise the bill is settled by hand.
      if (ChargeRepository.ownerPays(row) && !(await ChargeRepository.confirmationRequired(tx, row))) {
        throw new ProofDeclarationForbiddenError();
      }

      if (proof?.state === StoredProofState.Pending || proof?.state === StoredProofState.Accepted) {
        throw new ChargeInReviewError();
      }

      const liveUpload = proof?.state === StoredProofState.Uploading && !!proof.expires_at && Date.parse(proof.expires_at) > now;

      if (liveUpload && !ownsProof(proof, actor)) {
        throw new UploadInProgressError();
      }

      const stamp = new Date(now).toISOString();

      await clearProof(tx, id);
      await tx.proofs.insertOne({
        data: {
          id: crypto.randomUUID(),
          charge: { id },
          state: StoredProofState.Pending,
          kind: ProofKind.Declaration,
          ...(userId(actor) ? { sender: { id: userId(actor)! } } : {}),
          actor_hash: actorHash(actor),
          sent_at: stamp,
          created_at: stamp,
          updated_at: stamp
        }
      });
      await tx.charges.updateOne({ where: { id }, data: { updated_at: stamp } });
      await EventRepository.record(tx, {
        type: 'proof.declared',
        eventableType: EventableType.Charge,
        eventableId: id,
        actorId: userId(actor) ?? null,
        at: stamp
      });

      const current = await tx.charges.findOne({ select: ChargeRepository.SELECT, where: { id } });

      if (!current) {
        throw new HttpNotFoundError();
      }

      // A rejected file or an abandoned slot has no row pointing at it any more.
      return { declared: current, previousKey: proof?.file?.key ?? null };
    });

    if (previousKey) {
      await storage.delete(previousKey).catch(() => undefined);
    }

    return declared;
  }

  /** The creditor answers the file under review: accepting settles the charge, rejecting explains why. */
  export async function review(
    db: DbClient,
    id: string,
    actorId: string,
    input: { decision: ProofState.Accepted | ProofState.Rejected; reason?: string },
    now = Date.now()
  ): Promise<ChargeDetail> {
    if (![ProofState.Accepted, ProofState.Rejected].includes(input.decision) || (input.reason?.length ?? 0) > 500) {
      throw new ProofReviewInvalidError();
    }

    return db.transaction(async (tx) => {
      const { row, direction } = await ChargeRepository.findForActor(tx, actorId, id, true);
      const proof = await currentProof(tx, id, true);

      if (direction !== Direction.Receivable) {
        throw new HttpForbiddenError();
      }

      pending(row);

      if (proof?.state !== StoredProofState.Pending) {
        throw new ProofMissingError();
      }

      const stamp = new Date(now).toISOString();
      const reason = input.reason?.trim() || undefined;
      const declaration = proof.kind === ProofKind.Declaration;

      await tx.proofs.updateOne({
        where: { id: proof.id },
        data: {
          state: input.decision === ProofState.Accepted ? StoredProofState.Accepted : StoredProofState.Rejected,
          reviewed_at: stamp,
          reason: reason ?? sqlNull,
          // A file still on its way over the answered declaration has nothing left to attach to: its bytes go as a stray.
          ...(declaration ? { file: sqlNull, expires_at: sqlNull } : {}),
          updated_at: stamp
        }
      });
      await tx.charges.updateOne({
        where: { id },
        data: {
          ...(input.decision === ProofState.Accepted ? { state: ChargeState.Paid, paid_at: stamp } : {}),
          updated_at: stamp
        }
      });
      await EventRepository.record(tx, {
        type: `proof.${input.decision}`,
        eventableType: EventableType.Charge,
        eventableId: id,
        actorId,
        payload: { name: declaration ? undefined : proof.file?.name, ...(reason ? { reason } : {}) },
        at: stamp
      });

      if (input.decision === ProofState.Accepted) {
        await EventRepository.record(tx, {
          type: 'charge.paid',
          eventableType: EventableType.Charge,
          eventableId: id,
          actorId,
          payload: { via: declaration ? 'declaration' : 'proof' },
          at: stamp
        });
      }

      const updated = await tx.charges.findOne({ select: ChargeRepository.SELECT, where: { id } });

      if (!updated) {
        throw new HttpNotFoundError();
      }

      return ChargeRepository.dto(tx, updated, actorId);
    });
  }

  /** A short-lived read URL: the creditor may open any file, the debtor only the one they sent. */
  export async function downloadUrl(
    db: DbClient,
    storage: ProofStorage,
    id: string,
    actorId: string
  ): Promise<{ url: string; expiresIn: number }> {
    const { direction } = await ChargeRepository.findForActor(db, actorId, id);
    const proof = await currentProof(db, id);

    if (!proof?.file || proof.state === StoredProofState.Uploading || declarationSlot(proof)) {
      throw new HttpNotFoundError();
    }

    if (direction === Direction.Payable && proof.sender_user_id !== actorId) {
      throw new HttpNotFoundError();
    }

    return { url: await storage.downloadUrl(proof.file.key, proof.file.mime), expiresIn: 60 };
  }

  /** What the public page may learn: the state of its own upload, nothing about anyone else's. */
  export async function publicState(db: DbClient, token: string, secret: string): Promise<PublicProofState> {
    const charge = await PublicLinkRepository.resolveCharge(db, token, secret);

    return stateView(await currentProof(db, charge.id), token, secret);
  }

  export function stateView(proof: ProofRow | null, token: string, secret: string): PublicProofState {
    if (!proof || proof.actor_hash !== actorHash({ token, secret })) {
      return { state: null, kind: null, reason: null, file: null };
    }

    // A file still on its way over the declaration is not the proof yet.
    const file = declarationSlot(proof) ? undefined : proof.file;

    return {
      state: proof.state === StoredProofState.Uploading ? 'uploading' : ChargeRepository.visibleProofState(proof),
      kind: ChargeRepository.proofKind(proof),
      reason: proof.reason ?? null,
      file: file ? { name: file.name, mime: file.mime, size: file.size } : null
    };
  }
}
