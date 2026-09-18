import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { type ChargeDetail, Direction, ProofKind, ProofMime, ProofState, type ProofUploadInput, type ProofUploadTicket, type PublicProofState } from '@receivy/common';
import { ChargeInReviewError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { chargeForActor, confirmationRequired } from '../../charges/services/access';
import { ownerPays } from '../../charges/utils/columns';
import { UnprocessableEntityError } from '../../common/errors';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { Db, DbClient } from '../../database';
import { resolvePublicCharge } from '../../public/services/public-link';
import type { ProofFiles } from '../../storage';
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
import { ProofRepository } from '../repositories/proof';
import type { UploadExpiryClient, UploadExpiryScheduler } from '../schedulers/upload-expiry';
import { uploadExpiryIdentifier } from '../utils/expiry';
import { actorHash, actorUserId, assertPending, awaitsKey, declarationSlot, liveUploadOf, ownsProof, type ProofActor, proofStateView, UPLOAD_TTL_MS } from '../utils/slot';
import { bucketProofStorage } from './bucket-storage';
import type { ProofStorage } from './storage';
import { MAX_PROOF_BYTES, validateProof } from './validation';

const KEY = /^proofs\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;

export const enum ObjectOutcome {
  Accepted = 'accepted',
  Invalid = 'invalid',
  Ignored = 'ignored'
}

export type ProofClient = {
  startUpload(actor: ProofActor, chargeId: string, input: ProofUploadInput): Promise<ProofUploadTicket>;
  completeUpload(actor: ProofActor, chargeId: string): Promise<ChargeRepository.Row>;
  withdraw(actor: ProofActor, chargeId: string): Promise<void>;
  declare(actor: ProofActor, chargeId: string): Promise<ChargeRepository.Row>;
  review(actorId: string, chargeId: string, input: { decision: ProofState.Accepted | ProofState.Rejected; reason?: string }): Promise<ChargeDetail>;
  downloadUrl(actorId: string, chargeId: string): Promise<{ url: string; expiresIn: number }>;
  /** What the public page may learn about its own upload. */
  publicState(chargeId: string, token: string): Promise<PublicProofState>;
  /** The public link itself, as an actor: what the public endpoints act as after resolving the token. */
  publicActor(token: string): ProofActor;
};

export declare class ProofService extends Factory.Service<ProofClient> {
  handler: typeof createService;

  variables: {
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
  };

  services: {
    db: Environment.Service<Db>;
    proofFiles: Environment.Service<ProofFiles>;
    uploadExpiryScheduler: Environment.Service<UploadExpiryScheduler>;
    variables: Environment.ServiceVariables;
  };
}

function record(db: DbClient, chargeId: string, type: string, actorId: string | null, at: string, payload?: Record<string, unknown>) {
  return EventRepository.record(db, { type, eventableType: EventableType.Charge, eventableId: chargeId, actorId, payload, at });
}

/** The charge as the actor may touch it: a person through their access, a public link through its token. */
async function authorize(db: DbClient, id: string, actor: ProofActor, lock = false): Promise<{ row: ChargeRepository.Row; direction: Direction | 'public' }> {
  if ('userId' in actor) {
    return chargeForActor(db, actor.userId, id, lock);
  }

  const row = await ChargeRepository.get(db, id, lock);

  if (!row || (await resolvePublicCharge(db, actor.token, actor.secret)).id !== id) {
    throw new HttpNotFoundError();
  }

  return { row, direction: 'public' };
}

function validUpload(input: ProofUploadInput): boolean {
  return (
    [ProofMime.Jpeg, ProofMime.Png, ProofMime.Pdf].includes(input.mime) &&
    Number.isSafeInteger(input.size) &&
    input.size > 0 &&
    input.size <= MAX_PROOF_BYTES &&
    !!input.filename.trim() &&
    input.filename.length <= 200 &&
    !/[\x00-\x1f\x7f]/.test(input.filename)
  );
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
  if (!validUpload(input)) {
    throw new ProofInvalidFileError('Envie JPG, PNG ou PDF de até 10 MB.');
  }

  const key = `proofs/${id}/${crypto.randomUUID()}`;
  const expiresAt = new Date(now + UPLOAD_TTL_MS).toISOString();
  const stamp = new Date(now).toISOString();
  const previousKey = await db.transaction(async (tx) => {
    const { row, direction } = await authorize(tx, id, actor, true);
    const proof = await ProofRepository.current(tx, id, true);

    assertPending(row);

    // Only the side that pays sends files: the debtor, the owner of a conta a pagar, or the public link.
    if (direction === Direction.Receivable) {
      throw new HttpForbiddenError();
    }

    // A file under review may not be replaced, except the sender's own declaration, which the file completes.
    const ownDeclaration = proof?.state === StoredProofState.Pending && proof.kind === ProofKind.Declaration && ownsProof(proof, actor);

    if (proof?.state === StoredProofState.Accepted || (proof?.state === StoredProofState.Pending && !ownDeclaration)) {
      throw new ProofPendingError();
    }

    if (liveUploadOf(proof, now) && !ownsProof(proof, actor)) {
      throw new UploadInProgressError();
    }

    const file = { key, name: input.filename.split(/[\\/]/).at(-1)!, mime: input.mime, size: input.size };

    // The declaration stays under review, sent time and all, until the file actually lands.
    if (ownDeclaration) {
      await ProofRepository.stageFile(tx, proof!.id, file, expiresAt, stamp);
      await ChargeRepository.touch(tx, id, stamp);

      return proof!.file?.key ?? null;
    }

    await ProofRepository.clear(tx, id);
    await ProofRepository.reserveUpload(tx, { chargeId: id, file, senderId: actorUserId(actor), actorHash: actorHash(actor), expiresAt, now: stamp });
    await ChargeRepository.touch(tx, id, stamp);

    return proof?.file?.key ?? null;
  });

  // The previous file (a rejected one, or an abandoned upload) has no row pointing at it any more.
  if (previousKey) {
    await storage.delete(previousKey).catch(() => undefined);
  }

  await expiry.setEvent(uploadExpiryIdentifier(id), { date: new Date(expiresAt), event: { chargeId: id, key } }).catch(() => undefined);

  return { uploadUrl: await storage.uploadUrl(key, input.mime, input.size), expiresAt };
}

/** A definitive file failure releases the slot; over a declaration only the file goes. */
async function releaseSlot(db: DbClient, chargeId: string, key: string, stamp: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await ProofRepository.current(tx, chargeId, true);

    if (!awaitsKey(current, key)) {
      return false;
    }

    if (declarationSlot(current)) {
      await ProofRepository.dropFile(tx, current!.id, stamp);
    } else {
      await ProofRepository.clear(tx, chargeId);
    }

    await ChargeRepository.touch(tx, chargeId, stamp);

    return true;
  });
}

/**
 * The bucket said an object landed under `proofs/`. When it is the slot the charge is waiting for, the
 * bytes are validated and the slot becomes a pending proof; anything else is dropped from the bucket.
 */
export async function receiveProofObject(db: DbClient, storage: ProofStorage, key: string, now = Date.now()): Promise<ObjectOutcome> {
  const chargeId = KEY.exec(key)?.[1];
  const charge = chargeId ? await ChargeRepository.get(db, chargeId) : null;
  const proof = charge ? await ProofRepository.current(db, charge.id) : null;

  if (!charge || !awaitsKey(proof, key)) {
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

    if (await releaseSlot(db, charge.id, key, stamp)) {
      await record(db, charge.id, 'proof.invalid', proof?.sender_user_id ?? null, stamp, {
        name: declared.name,
        mime: declared.mime,
        size: declared.size,
        reason: failure.message
      });
    }

    await storage.delete(key).catch(() => undefined);

    return ObjectOutcome.Invalid;
  }

  const outcome = await db.transaction(async (tx): Promise<'accepted' | 'attached' | 'stray'> => {
    const current = await ProofRepository.current(tx, charge.id, true);

    if (!awaitsKey(current, key)) {
      return current?.file?.key === key ? 'attached' : 'stray';
    }

    // The file replaces a declaration it was sent over.
    await ProofRepository.attachFile(tx, current!.id, { ...declared, sha256: validated!.sha256 }, stamp);
    await ChargeRepository.touch(tx, charge.id, stamp);
    await record(tx, charge.id, 'proof.uploaded', proof?.sender_user_id ?? null, stamp, { name: declared.name, mime: declared.mime, size: declared.size });

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
export async function completeProofUpload(db: DbClient, storage: ProofStorage, id: string, actor: ProofActor, now = Date.now()): Promise<ChargeRepository.Row> {
  // Authorizes the actor against the charge; the proof itself is what the rest of this reads.
  await authorize(db, id, actor);

  const proof = await ProofRepository.current(db, id);
  const key = proof?.file?.key;

  if (!key || !ownsProof(proof, actor) || (proof!.state !== StoredProofState.Uploading && proof!.state !== StoredProofState.Pending)) {
    throw new UploadMissingError();
  }

  if (awaitsKey(proof, key)) {
    if (!(await storage.exists(key))) {
      throw new UploadMissingError('O arquivo não chegou ao armazenamento. Envie novamente.');
    }

    if ((await receiveProofObject(db, storage, key, now)) === ObjectOutcome.Invalid) {
      throw new ProofInvalidFileError();
    }
  }

  const settled = await ProofRepository.current(db, id);

  if (settled?.state !== StoredProofState.Pending || settled.file?.key !== key || declarationSlot(settled)) {
    throw new UploadMissingError();
  }

  const current = await ChargeRepository.get(db, id);

  if (!current) {
    throw new HttpNotFoundError();
  }

  return current;
}

/** Releases a reserved slot nobody filled; the scheduler calls it, and a retry finds nothing to do. */
export async function expireProofUpload(db: DbClient, storage: ProofStorage, chargeId: string, key: string): Promise<boolean> {
  const attached = (await ProofRepository.current(db, chargeId))?.file?.key === key;
  const released = await releaseSlot(db, chargeId, key, new Date().toISOString());

  // The bytes landed in time and the file is the charge's proof now: the schedule fires anyway, harmlessly.
  if (released || !attached) {
    await storage.delete(key).catch(() => undefined);
  }

  return released;
}

/** The sender takes back a file nobody reviewed yet; the row and the bytes go, so another one can go up. */
export async function withdrawProof(db: DbClient, storage: ProofStorage, id: string, actor: ProofActor, now = Date.now()): Promise<void> {
  const key = await db.transaction(async (tx) => {
    const { row } = await authorize(tx, id, actor, true);
    const proof = await ProofRepository.current(tx, id, true);

    assertPending(row);

    if (!proof || !ownsProof(proof, actor)) {
      throw new HttpNotFoundError();
    }

    if (proof.state !== StoredProofState.Pending && proof.state !== StoredProofState.Uploading) {
      throw new ProofReviewedError();
    }

    const stamp = new Date(now).toISOString();

    await ProofRepository.clear(tx, id);
    await ChargeRepository.touch(tx, id, stamp);
    await record(tx, id, 'proof.withdrawn', actorUserId(actor) ?? null, stamp, { name: proof.file?.name, mime: proof.file?.mime, size: proof.file?.size });

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
export async function declarePayment(db: DbClient, storage: ProofStorage, id: string, actor: ProofActor, now = Date.now()): Promise<ChargeRepository.Row> {
  const { declared, previousKey } = await db.transaction(async (tx) => {
    const { row, direction } = await authorize(tx, id, actor, true);
    const proof = await ProofRepository.current(tx, id, true);

    assertPending(row);

    // Whoever collects answers a declaration; they never send one.
    if (direction === Direction.Receivable) {
      throw new ProofDeclarationForbiddenError();
    }

    // The owner of a conta a pagar declares only to a payee who can confirm; otherwise the bill is settled by hand.
    if (ownerPays(row) && !(await confirmationRequired(tx, row))) {
      throw new ProofDeclarationForbiddenError();
    }

    if (proof?.state === StoredProofState.Pending || proof?.state === StoredProofState.Accepted) {
      throw new ChargeInReviewError();
    }

    if (liveUploadOf(proof, now) && !ownsProof(proof, actor)) {
      throw new UploadInProgressError();
    }

    const stamp = new Date(now).toISOString();

    await ProofRepository.clear(tx, id);
    await ProofRepository.insertDeclaration(tx, { chargeId: id, senderId: actorUserId(actor), actorHash: actorHash(actor), now: stamp });
    await ChargeRepository.touch(tx, id, stamp);
    await record(tx, id, 'proof.declared', actorUserId(actor) ?? null, stamp);

    const current = await ChargeRepository.get(tx, id);

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
export async function reviewProof(
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
    const { row, direction } = await chargeForActor(tx, actorId, id, true);
    const proof = await ProofRepository.current(tx, id, true);

    if (direction !== Direction.Receivable) {
      throw new HttpForbiddenError();
    }

    assertPending(row);

    if (proof?.state !== StoredProofState.Pending) {
      throw new ProofMissingError();
    }

    const stamp = new Date(now).toISOString();
    const reason = input.reason?.trim() || undefined;
    const declaration = proof.kind === ProofKind.Declaration;
    const accepted = input.decision === ProofState.Accepted;

    // A file still on its way over the answered declaration has nothing left to attach to: its bytes go as a stray.
    await ProofRepository.answer(tx, proof.id, { state: accepted ? StoredProofState.Accepted : StoredProofState.Rejected, reason, dropFile: declaration }, stamp);

    if (accepted) {
      await ChargeRepository.markPaid(tx, id, stamp, stamp);
    } else {
      await ChargeRepository.touch(tx, id, stamp);
    }

    await record(tx, id, `proof.${input.decision}`, actorId, stamp, { name: declaration ? undefined : proof.file?.name, ...(reason ? { reason } : {}) });

    if (accepted) {
      await record(tx, id, 'charge.paid', actorId, stamp, { via: declaration ? 'declaration' : 'proof' });
    }

    return ChargeRepository.dto(tx, row, actorId);
  });
}

/** A short-lived read URL: the creditor may open any file, the debtor only the one they sent. */
export async function proofDownloadUrl(db: DbClient, storage: ProofStorage, id: string, actorId: string): Promise<{ url: string; expiresIn: number }> {
  const { direction } = await chargeForActor(db, actorId, id);
  const proof = await ProofRepository.current(db, id);

  if (!proof?.file || proof.state === StoredProofState.Uploading || declarationSlot(proof)) {
    throw new HttpNotFoundError();
  }

  if (direction === Direction.Payable && proof.sender_user_id !== actorId) {
    throw new HttpNotFoundError();
  }

  return { url: await storage.downloadUrl(proof.file.key, proof.file.mime), expiresIn: 60 };
}

/** What the public page may learn: the state of its own upload, nothing about anyone else's. */
export async function publicProofState(db: DbClient, token: string, secret: string): Promise<PublicProofState> {
  const charge = await resolvePublicCharge(db, token, secret);

  return proofStateView(await ProofRepository.current(db, charge.id), token, secret);
}

export function createService({ db, proofFiles, uploadExpiryScheduler, variables }: Service.Context<ProofService>): ProofClient {
  const storage = bucketProofStorage(proofFiles);
  const secret = variables.PUBLIC_LINK_HMAC_SECRET;

  return {
    startUpload: (actor, chargeId, input) => startProofUpload(db, storage, uploadExpiryScheduler, chargeId, actor, input),
    completeUpload: (actor, chargeId) => completeProofUpload(db, storage, chargeId, actor),
    withdraw: (actor, chargeId) => withdrawProof(db, storage, chargeId, actor),
    declare: (actor, chargeId) => declarePayment(db, storage, chargeId, actor),
    review: (actorId, chargeId, input) => reviewProof(db, chargeId, actorId, input),
    downloadUrl: (actorId, chargeId) => proofDownloadUrl(db, storage, chargeId, actorId),
    publicState: async (chargeId, token) => proofStateView(await ProofRepository.current(db, chargeId), token, secret),
    publicActor: (token) => ({ token, secret })
  };
}
