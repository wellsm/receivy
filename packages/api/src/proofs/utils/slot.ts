import { createHash } from 'node:crypto';
import { ChargeState, ProofKind, type PublicProofState } from '@receivy/common';
import type { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { proofKind, visibleProofState } from '../../charges/utils/proof';
import { ChargeClosedError } from '../../charges/errors';
import type { ProofRow } from '../repositories/proof';

/** Who is acting on the proof: a signed-in person, or the holder of a public payment link. */
export type ProofActor = { userId: string } | { token: string; secret: string };

/** How long a reserved upload slot waits for its bytes. */
export const UPLOAD_TTL_MS = 5 * 60_000;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** The fingerprint a proof keeps of whoever sent it, so a public link only ever sees its own upload. */
export function actorHash(actor: ProofActor): string {
  return hash('userId' in actor ? `user:${actor.userId}` : `public:${actor.token}`);
}

export function actorUserId(actor: ProofActor): string | undefined {
  return 'userId' in actor ? actor.userId : undefined;
}

export function ownsProof(proof: ProofRow | null, actor: ProofActor): boolean {
  return !!proof && proof.actor_hash === actorHash(actor);
}

/** A file on its way over the sender's own declaration: the declaration stays under review until the bytes land. */
export function declarationSlot(proof: ProofRow | null): boolean {
  return proof?.state === StoredProofState.Pending && proof.kind === ProofKind.Declaration && !!proof.file;
}

/** Whether the charge still waits for `key`: a reserved upload, or a file on its way over a declaration. */
export function awaitsKey(proof: ProofRow | null, key: string): boolean {
  if (proof?.file?.key !== key) {
    return false;
  }

  return proof.state === StoredProofState.Uploading || declarationSlot(proof);
}

/** An upload slot somebody else still holds. */
export function liveUploadOf(proof: ProofRow | null, now: number): boolean {
  return proof?.state === StoredProofState.Uploading && !!proof.expires_at && Date.parse(proof.expires_at) > now;
}

export function assertPending(row: ChargeRepository.Row): void {
  if (row.state !== ChargeState.Pending) {
    throw new ChargeClosedError();
  }
}

/** What the public page may learn: the state of its own upload, nothing about anyone else's. */
export function proofStateView(proof: ProofRow | null, token: string, secret: string): PublicProofState {
  if (!proof || proof.actor_hash !== actorHash({ token, secret })) {
    return { state: null, kind: null, reason: null, file: null };
  }

  // A file still on its way over the declaration is not the proof yet.
  const file = declarationSlot(proof) ? undefined : proof.file;

  return {
    state: proof.state === StoredProofState.Uploading ? 'uploading' : visibleProofState(proof),
    kind: proofKind(proof),
    reason: proof.reason ?? null,
    file: file ? { name: file.name, mime: file.mime, size: file.size } : null
  };
}
