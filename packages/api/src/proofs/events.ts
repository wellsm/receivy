import type { ChargeRow } from '../charges/repository';
import type { DbClient } from '../database';

export async function proofEvent(db: DbClient, row: ChargeRow, type: string, now: string, actorId?: string, proofId?: string) {
  const payload = JSON.stringify(proofId ? { proofId } : {});
  for (const subjectId of new Set([row.creditor_id, row.recipient_user_id].filter((id): id is string => !!id))) {
    await db.activity_events.insertOne({
      data: {
        id: crypto.randomUUID(),
        ...(actorId ? { actor_user: { id: actorId } } : {}),
        subject_user: { id: subjectId },
        type,
        aggregate_type: 'charge',
        aggregate_id: row.id,
        payload,
        created_at: now
      }
    });
  }
  const toCreditor = type === 'proof.submitted';
  await db.outbox_events.insertOne({
    data: {
      id: crypto.randomUUID(),
      type,
      aggregate_type: 'charge',
      aggregate_id: row.id,
      ...(toCreditor
        ? { recipient_user: { id: row.creditor_id } }
        : row.recipient_user_id
          ? { recipient_user: { id: row.recipient_user_id } }
          : {}),
      ...(!toCreditor && row.recipient_email_snapshot ? { recipient_email: row.recipient_email_snapshot } : {}),
      payload,
      state: 'pending',
      attempts: 0,
      available_at: now,
      created_at: now,
      updated_at: now
    }
  });
}

/** Call only inside the charge-locked transaction. Retain files and distinguish closure from file rejection. */
export async function closeProofs(db: DbClient, row: ChargeRow, actorId: string, action: 'paid' | 'cancelled', now: string) {
  const pending = await db.payment_proofs.findMany({ select: { id: true }, where: { charge_id: row.id, state: 'pending' } });
  for (const proof of pending.records) {
    await db.payment_proofs.updateOne({
      where: { id: proof.id },
      data: {
        state: 'rejected',
        closure_reason: action,
        reason: action === 'paid' ? 'Encerrado por pagamento manual da cobrança.' : 'Encerrado por cancelamento da cobrança.',
        reviewer: { id: actorId },
        reviewed_at: now
      }
    });
    await proofEvent(db, row, 'proof.closed', now, actorId, proof.id);
  }
  await db.upload_intents.updateMany({ where: { charge_id: row.id, state: 'pending' }, data: { state: 'expired' } });
}
