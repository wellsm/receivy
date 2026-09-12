import { createHash } from 'node:crypto';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { ChargeDetail, ProofUploadInput, ProofUploadTicket, PublicProofState } from '@receivy/common';
import { ChargeClosedError } from '../../charges/errors';
import { CHARGE_SELECT, type ChargeRow, chargeDto, findChargeForActor } from '../../charges/repositories/charge';
import { UnprocessableEntityError } from '../../common/errors';
import { recordEvent } from '../../common/repositories/events';
import type { DbClient } from '../../database';
import { resolvePublicCharge } from '../../public/repositories/public-link';
import { lockAccountReferences } from '../../users/services/locking';
import {
  ProofInvalidFileError,
  ProofMissingError,
  ProofPendingError,
  ProofReviewedError,
  ProofReviewInvalidError,
  ProofSizeMismatchError,
  UploadInProgressError
} from '../errors';
import type { UploadExpiryClient } from '../schedulers/upload-expiry';
import { uploadExpiryIdentifier } from '../schedulers/upload-expiry';
import type { ProofStorage } from '../services/storage';
import { MAX_PROOF_BYTES, validateProof } from '../services/validation';

export type ProofActor = { userId: string } | { token: string; secret: string };

/** How long a reserved upload slot waits for its bytes. */
export const UPLOAD_TTL_MS = 5 * 60_000;

const KEY = /^proofs\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;
const sqlNull = null as unknown as undefined;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const actorHash = (actor: ProofActor) => hash('userId' in actor ? `user:${actor.userId}` : `public:${actor.token}`);

const userId = (actor: ProofActor) => ('userId' in actor ? actor.userId : undefined);

/** Every proof column back to "nothing attached". */
const CLEARED = {
  proof_state: sqlNull,
  proof_file: sqlNull,
  ...{ proof_sender_user_id: sqlNull },
  proof_actor_hash: sqlNull,
  proof_expires_at: sqlNull,
  proof_sent_at: sqlNull,
  proof_reviewed_at: sqlNull,
  proof_reason: sqlNull
} as const;

async function authorize(
  db: DbClient,
  id: string,
  actor: ProofActor,
  lock = false
): Promise<{ row: ChargeRow; direction: 'receivable' | 'payable' | 'public' }> {
  if ('userId' in actor) {
    return findChargeForActor(db, actor.userId, id, lock);
  }

  if (lock) {
    await lockAccountReferences(db, 'write');
  }

  const row = await db.charges.findOne({ select: CHARGE_SELECT, where: { id }, ...(lock ? { lock: true } : {}) });

  if (!row || (await resolvePublicCharge(db, actor.token, actor.secret)).id !== id) {
    throw new HttpNotFoundError();
  }

  return { row, direction: 'public' };
}

function pending(row: ChargeRow) {
  if (row.state !== 'pending') {
    throw new ChargeClosedError();
  }
}

function ownsProof(row: ChargeRow, actor: ProofActor): boolean {
  return row.proof_actor_hash === actorHash(actor);
}

/**
 * Reserves the charge's single proof slot and hands back a signed PUT. The bytes never touch the API:
 * the bucket event turns the slot into a pending proof once they land. A rejected file may be replaced;
 * a file under review may not, and another actor's live upload is not overridden.
 */
export async function startProofUpload(
  db: DbClient,
  storage: ProofStorage,
  expiry: UploadExpiryClient,
  id: string,
  actor: ProofActor,
  input: ProofUploadInput,
  now = Date.now()
): Promise<ProofUploadTicket> {
  if (
    !['image/jpeg', 'image/png', 'application/pdf'].includes(input.mime) ||
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

    pending(row);

    // Only the side that pays sends files: the debtor, the owner of a conta a pagar, or the public link.
    if (direction === 'receivable') {
      throw new HttpForbiddenError();
    }

    if (row.proof_state === 'pending' || row.proof_state === 'accepted') {
      throw new ProofPendingError();
    }

    const liveUpload = row.proof_state === 'uploading' && !!row.proof_expires_at && Date.parse(row.proof_expires_at) > now;

    if (liveUpload && !ownsProof(row, actor)) {
      throw new UploadInProgressError();
    }

    await tx.charges.updateOne({
      where: { id },
      data: {
        ...CLEARED,
        proof_state: 'uploading',
        proof_file: { key, name: input.filename.split(/[\\/]/).at(-1)!, mime: input.mime, size: input.size },
        ...(userId(actor) ? { proof_sender: { id: userId(actor)! } } : {}),
        proof_actor_hash: actorHash(actor),
        proof_expires_at: expiresAt,
        updated_at: stamp
      }
    });

    return row.proof_file?.key ?? null;
  });

  // The previous file (a rejected one, or an abandoned upload) has no row pointing at it any more.
  if (previousKey) {
    await storage.delete(previousKey).catch(() => undefined);
  }

  await expiry.setEvent(uploadExpiryIdentifier(id), { date: new Date(expiresAt), event: { chargeId: id, key } }).catch(() => undefined);

  return { uploadUrl: await storage.uploadUrl(key, input.mime, input.size), expiresAt };
}

export type ProofObjectOutcome = 'accepted' | 'invalid' | 'ignored';

/**
 * The bucket said an object landed under `proofs/`. When it is the slot the charge is waiting for, the
 * bytes are validated and the slot becomes a pending proof; anything else is dropped from the bucket.
 */
export async function receiveProofObject(db: DbClient, storage: ProofStorage, key: string, now = Date.now()): Promise<ProofObjectOutcome> {
  const chargeId = KEY.exec(key)?.[1];
  const charge = chargeId ? await db.charges.findOne({ select: CHARGE_SELECT, where: { id: chargeId } }) : undefined;

  if (charge?.proof_state !== 'uploading' || charge.proof_file?.key !== key) {
    // A redelivered event for the file already attached must leave it alone; any other object is a stray.
    if (charge?.proof_file?.key !== key) {
      await storage.delete(key).catch(() => undefined);
    }

    return 'ignored';
  }

  const declared = charge.proof_file;
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
      const current = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id: charge.id }, lock: true });

      if (current?.proof_state !== 'uploading' || current.proof_file?.key !== key) {
        return;
      }

      await tx.charges.updateOne({ where: { id: charge.id }, data: { ...CLEARED, updated_at: stamp } });
      await recordEvent(tx, {
        type: 'proof.invalid',
        eventableType: 'charge',
        eventableId: charge.id,
        actorId: charge.proof_sender_user_id ?? null,
        payload: { name: declared.name, mime: declared.mime, size: declared.size, reason: failure.message },
        at: stamp
      });
    });

    await storage.delete(key).catch(() => undefined);

    return 'invalid';
  }

  const outcome = await db.transaction(async (tx): Promise<'accepted' | 'attached' | 'stray'> => {
    const current = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id: charge.id }, lock: true });

    if (current?.proof_state !== 'uploading' || current.proof_file?.key !== key) {
      return current?.proof_file?.key === key ? 'attached' : 'stray';
    }

    await tx.charges.updateOne({
      where: { id: charge.id },
      data: {
        proof_state: 'pending',
        proof_file: { ...declared, sha256: validated!.sha256 },
        proof_expires_at: sqlNull,
        proof_sent_at: stamp,
        updated_at: stamp
      }
    });
    await recordEvent(tx, {
      type: 'proof.uploaded',
      eventableType: 'charge',
      eventableId: charge.id,
      actorId: charge.proof_sender_user_id ?? null,
      payload: { name: declared.name, mime: declared.mime, size: declared.size },
      at: stamp
    });

    return 'accepted';
  });

  if (outcome === 'stray') {
    await storage.delete(key).catch(() => undefined);
  }

  return outcome === 'accepted' ? 'accepted' : 'ignored';
}

/** Releases a reserved slot nobody filled; the scheduler calls it, and a retry finds nothing to do. */
export async function expireProofUpload(db: DbClient, storage: ProofStorage, chargeId: string, key: string): Promise<boolean> {
  const outcome = await db.transaction(async (tx): Promise<'released' | 'attached' | 'stray'> => {
    const current = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id: chargeId }, lock: true });

    if (current?.proof_state !== 'uploading' || current.proof_file?.key !== key) {
      // The bytes landed in time and the file is the charge's proof now: the schedule fires anyway, harmlessly.
      return current?.proof_file?.key === key ? 'attached' : 'stray';
    }

    await tx.charges.updateOne({ where: { id: chargeId }, data: { ...CLEARED, updated_at: new Date().toISOString() } });

    return 'released';
  });

  if (outcome !== 'attached') {
    await storage.delete(key).catch(() => undefined);
  }

  return outcome === 'released';
}

/** The sender takes back a file nobody reviewed yet; the row and the bytes go, so another one can go up. */
export async function withdrawProof(db: DbClient, storage: ProofStorage, id: string, actor: ProofActor, now = Date.now()): Promise<void> {
  const key = await db.transaction(async (tx) => {
    const { row } = await authorize(tx, id, actor, true);

    pending(row);

    if (!row.proof_state || !ownsProof(row, actor)) {
      throw new HttpNotFoundError();
    }

    if (row.proof_state !== 'pending' && row.proof_state !== 'uploading') {
      throw new ProofReviewedError();
    }

    const stamp = new Date(now).toISOString();

    await tx.charges.updateOne({ where: { id }, data: { ...CLEARED, updated_at: stamp } });
    await recordEvent(tx, {
      type: 'proof.withdrawn',
      eventableType: 'charge',
      eventableId: id,
      actorId: userId(actor) ?? null,
      payload: { name: row.proof_file?.name, mime: row.proof_file?.mime, size: row.proof_file?.size },
      at: stamp
    });

    return row.proof_file?.key ?? null;
  });

  if (key) {
    await storage.delete(key).catch(() => undefined);
  }
}

/** The creditor answers the file under review: accepting settles the charge, rejecting explains why. */
export async function reviewProof(
  db: DbClient,
  id: string,
  actorId: string,
  input: { decision: 'accepted' | 'rejected'; reason?: string },
  now = Date.now()
): Promise<ChargeDetail> {
  if (!['accepted', 'rejected'].includes(input.decision) || (input.reason?.length ?? 0) > 500) {
    throw new ProofReviewInvalidError();
  }

  return db.transaction(async (tx) => {
    const { row, direction } = await findChargeForActor(tx, actorId, id, true);

    if (direction !== 'receivable') {
      throw new HttpForbiddenError();
    }

    pending(row);

    if (row.proof_state !== 'pending') {
      throw new ProofMissingError();
    }

    const stamp = new Date(now).toISOString();
    const reason = input.reason?.trim() || undefined;

    await tx.charges.updateOne({
      where: { id },
      data: {
        proof_state: input.decision,
        proof_reviewed_at: stamp,
        proof_reason: reason ?? sqlNull,
        ...(input.decision === 'accepted' ? { state: 'paid', paid_at: stamp } : {}),
        updated_at: stamp
      }
    });
    await recordEvent(tx, {
      type: `proof.${input.decision}`,
      eventableType: 'charge',
      eventableId: id,
      actorId,
      payload: { name: row.proof_file?.name, ...(reason ? { reason } : {}) },
      at: stamp
    });

    if (input.decision === 'accepted') {
      await recordEvent(tx, {
        type: 'charge.paid',
        eventableType: 'charge',
        eventableId: id,
        actorId,
        payload: { via: 'proof' },
        at: stamp
      });
    }

    const updated = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id } });

    if (!updated) {
      throw new HttpNotFoundError();
    }

    return chargeDto(tx, updated, actorId);
  });
}

/** A short-lived read URL: the creditor may open any file, the debtor only the one they sent. */
export async function proofDownloadUrl(
  db: DbClient,
  storage: ProofStorage,
  id: string,
  actorId: string
): Promise<{ url: string; expiresIn: number }> {
  const { row, direction } = await findChargeForActor(db, actorId, id);

  if (!row.proof_file || !row.proof_state || row.proof_state === 'uploading') {
    throw new HttpNotFoundError();
  }

  if (direction === 'payable' && row.proof_sender_user_id !== actorId) {
    throw new HttpNotFoundError();
  }

  return { url: await storage.downloadUrl(row.proof_file.key, row.proof_file.mime), expiresIn: 60 };
}

/** What the public page may learn: the state of its own upload, nothing about anyone else's. */
export async function publicProofState(db: DbClient, token: string, secret: string): Promise<PublicProofState> {
  return proofStateView(await resolvePublicCharge(db, token, secret), token, secret);
}

export function proofStateView(charge: ChargeRow, token: string, secret: string): PublicProofState {
  if (!charge.proof_state || !charge.proof_file || charge.proof_actor_hash !== actorHash({ token, secret })) {
    return { state: null, reason: null, file: null };
  }

  return {
    state: charge.proof_state,
    reason: charge.proof_reason ?? null,
    file: { name: charge.proof_file.name, mime: charge.proof_file.mime, size: charge.proof_file.size }
  };
}
