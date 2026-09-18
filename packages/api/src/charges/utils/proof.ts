import { type ChargeProof, ProofKind, ProofState } from '@receivy/common';
import type { ProofRow } from '../../proofs/repositories/proof';
import { StoredProofState } from '../schemas/charge';

/** Readers of a proof row as a viewer may see it; no database access, so any layer can call them. */

/** The stored proof state as anyone may see it: a reserved slot (`uploading`) is nobody's business yet. */
export function visibleProofState(proof: Pick<ProofRow, 'state'> | null): ProofState | null {
  switch (proof?.state) {
    case StoredProofState.Pending:
      return ProofState.Pending;

    case StoredProofState.Accepted:
      return ProofState.Accepted;

    case StoredProofState.Rejected:
      return ProofState.Rejected;

    default:
      return null;
  }
}

/** What is under review, when anything is. Rows written before declarations existed carry files. */
export function proofKind(proof: Pick<ProofRow, 'kind'> | null): ProofKind | null {
  return proof ? (proof.kind ?? ProofKind.File) : null;
}

/** The attached proof as the viewer may see it: a reserved slot is nobody's business yet, and a declaration has no file. */
export function proofOf(proof: ProofRow | null, viewerId: string): ChargeProof | null {
  const state = visibleProofState(proof);
  const kind = proof?.kind ?? ProofKind.File;
  // A declaration has no file, not even one still on its way over it.
  const file = kind === ProofKind.File ? proof?.file : undefined;

  if (!proof || !state || !proof.sent_at || (kind === ProofKind.File && !file)) {
    return null;
  }

  return {
    state,
    kind,
    file: file ? { name: file.name, mime: file.mime, size: file.size } : null,
    sentAt: proof.sent_at,
    reviewedAt: proof.reviewed_at ?? null,
    reason: proof.reason ?? null,
    sentByViewer: proof.sender_user_id === viewerId
  };
}
