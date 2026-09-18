import { ProofKind } from '@receivy/common';
import { type ProofFileSchema, StoredProofState } from '../../charges/schemas/charge';
import type { DbClient } from '../../database';

const sqlNull = null as unknown as undefined;

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

export namespace ProofRepository {
  /** The one live proof of a charge, or null when nothing is attached; `lock` takes it for the caller's transaction. */
  export async function current(db: DbClient, chargeId: string, lock = false): Promise<ProofRow | null> {
    // `charge_id` is a secondary index, so findOne (which wants a primary or unique one) cannot be used here.
    // No `take`: at most one proof is alive per charge, and pairing it with `lock` is a combination the
    // project uses nowhere else.
    const { records } = await db.proofs.findMany({
      select: {
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
      },
      where: { charge_id: chargeId },
      ...(lock ? { lock: true } : {})
    });

    return records[0] ?? null;
  }

  /** The live proofs of many charges at once, by charge id: the list reads never go one query per row. */
  export async function byCharges(db: DbClient, chargeIds: string[]): Promise<Map<string, ProofRow>> {
    if (!chargeIds.length) {
      return new Map();
    }

    const { records } = await db.proofs.findMany({
      select: {
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
      },
      where: { charge_id: { isIn: chargeIds } }
    });

    return new Map(records.map((row) => [row.charge_id, row]));
  }

  /** Charges carrying a proof this person sent; erasing an account reaches them through here. */
  export async function chargeIdsSentBy(db: DbClient, senderUserId: string): Promise<string[]> {
    const { records } = await db.proofs.findMany({ select: { charge_id: true }, where: { sender_user_id: senderUserId } });

    return records.map((row) => row.charge_id);
  }

  /** "Nothing attached" is the absence of the row; what was there lives on in `events`. */
  export async function clear(db: DbClient, chargeId: string): Promise<void> {
    await db.proofs.deleteMany({ where: { charge_id: chargeId } });
  }

  export async function removeByCharge(db: DbClient, chargeId: string): Promise<void> {
    await db.proofs.deleteMany({ where: { charge_id: chargeId } });
  }

  /** A slot waiting for its bytes: the file is declared, the state says nothing landed yet. */
  export async function reserveUpload(
    db: DbClient,
    input: { chargeId: string; file: ProofFileSchema; senderId?: string; actorHash: string; expiresAt: string; now: string }
  ): Promise<void> {
    await db.proofs.insertOne({
      data: {
        id: crypto.randomUUID(),
        charge: { id: input.chargeId },
        state: StoredProofState.Uploading,
        kind: ProofKind.File,
        file: input.file,
        ...(input.senderId ? { sender: { id: input.senderId } } : {}),
        actor_hash: input.actorHash,
        expires_at: input.expiresAt,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  /** A payment declared without a file, under review from the moment it is sent. */
  export async function insertDeclaration(db: DbClient, input: { chargeId: string; senderId?: string; actorHash: string; now: string }): Promise<void> {
    await db.proofs.insertOne({
      data: {
        id: crypto.randomUUID(),
        charge: { id: input.chargeId },
        state: StoredProofState.Pending,
        kind: ProofKind.Declaration,
        ...(input.senderId ? { sender: { id: input.senderId } } : {}),
        actor_hash: input.actorHash,
        sent_at: input.now,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  /** A file on its way over a declaration: the slot is filed on the row, the declaration stays as it was sent. */
  export async function stageFile(db: DbClient, id: string, file: ProofFileSchema, expiresAt: string, now: string): Promise<void> {
    await db.proofs.updateOne({ where: { id }, data: { file, expires_at: expiresAt, updated_at: now } });
  }

  /** Only the staged file goes; whatever the row was before it stands. */
  export async function dropFile(db: DbClient, id: string, now: string): Promise<void> {
    await db.proofs.updateOne({ where: { id }, data: { file: sqlNull, expires_at: sqlNull, updated_at: now } });
  }

  /** The bytes landed and passed: the row is a file under review from now. */
  export async function attachFile(db: DbClient, id: string, file: ProofFileSchema, now: string): Promise<void> {
    await db.proofs.updateOne({
      where: { id },
      data: { state: StoredProofState.Pending, kind: ProofKind.File, file, expires_at: sqlNull, sent_at: now, updated_at: now }
    });
  }

  /**
   * The creditor's answer to what was under review. `dropFile` clears a file still on its way over an answered
   * declaration: its bytes have nothing left to attach to.
   */
  export async function answer(
    db: DbClient,
    id: string,
    input: { state: StoredProofState.Accepted | StoredProofState.Rejected; reason?: string; dropFile: boolean },
    now: string
  ): Promise<void> {
    await db.proofs.updateOne({
      where: { id },
      data: {
        state: input.state,
        reviewed_at: now,
        reason: input.reason ?? sqlNull,
        ...(input.dropFile ? { file: sqlNull, expires_at: sqlNull } : {}),
        updated_at: now
      }
    });
  }

  /** Back under review, as if never answered. */
  export async function reopen(db: DbClient, id: string, now: string): Promise<void> {
    await db.proofs.updateOne({ where: { id }, data: { state: StoredProofState.Pending, reviewed_at: sqlNull, reason: sqlNull, updated_at: now } });
  }

  /** Every proof `from` sent now reads as sent by `to`. */
  export async function reassignSender(db: DbClient, from: string, to: string): Promise<void> {
    await db.proofs.updateMany({ where: { sender_user_id: from }, data: { sender: { id: to } } });
  }
}
