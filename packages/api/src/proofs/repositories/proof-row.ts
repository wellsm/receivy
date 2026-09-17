import type { ProofKind } from '@receivy/common';
import type { ProofFileSchema, StoredProofState } from '../../charges/schemas/charge';
import type { DbClient } from '../../database';

/**
 * The proof row on its own, with no charge knowledge. It lives apart from `ProofRepository` so the charge
 * repository can read a proof without importing the proofs module, which would close an import cycle and
 * take `ez4 serve` down with it.
 */
export const PROOF_SELECT = {
  id: true,
  charge_id: true,
  state: true,
  kind: true,
  file: true,
  sender_user_id: true,
  actor_hash: true,
  expires_at: true,
  sent_at: true,
  reviewed_at: true,
  reason: true,
  created_at: true,
  updated_at: true
} as const;

export type ProofRow = {
  id: string;
  charge_id: string;
  state: StoredProofState;
  kind: ProofKind;
  file?: ProofFileSchema;
  sender_user_id?: string;
  actor_hash: string;
  expires_at?: string;
  sent_at?: string;
  reviewed_at?: string;
  reason?: string;
  created_at: string;
  updated_at: string;
};

/** The one live proof of a charge, or null when nothing is attached. */
export async function currentProof(db: DbClient, chargeId: string, lock = false): Promise<ProofRow | null> {
  // `charge_id` is a secondary index, so findOne (which wants a primary or unique one) cannot be used here.
  // No `take`: at most one proof is alive per charge, and pairing it with `lock` is a combination the
  // project uses nowhere else.
  const { records } = await db.proofs.findMany({
    select: PROOF_SELECT,
    where: { charge_id: chargeId },
    ...(lock ? { lock: true } : {})
  });

  return records[0] ?? null;
}

/** Charges carrying a proof this person sent; erasing an account reaches them through here. */
export async function chargeIdsWithProofFrom(db: DbClient, senderUserId: string): Promise<string[]> {
  const { records } = await db.proofs.findMany({ select: { charge_id: true }, where: { sender_user_id: senderUserId } });

  return records.map((row) => row.charge_id);
}

/** The live proofs of many charges at once, by charge id: the list reads never go one query per row. */
export async function proofsByCharge(db: DbClient, chargeIds: string[]): Promise<Map<string, ProofRow>> {
  if (!chargeIds.length) {
    return new Map();
  }

  const { records } = await db.proofs.findMany({ select: PROOF_SELECT, where: { charge_id: { isIn: chargeIds } } });

  return new Map(records.map((row) => [row.charge_id, row]));
}
