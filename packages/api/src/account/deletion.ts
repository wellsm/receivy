import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import { detachAppleCredentials, type ProviderRevocation } from '../auth/apple-credentials';
import type { DbClient } from '../database';
import { enqueueStorageDeletion } from '../proofs/cleanup';
import { lockAccountReferences } from './locking';
import { disableSessionDevices } from './sessions';

// EZ4 scalar nullable boundary: relation objects cannot express SQL NULL.
const sqlNull = null as unknown as undefined;

export async function eraseAccount(
  db: DbClient,
  userId: string,
  confirmation: string
): Promise<{ deleted: boolean; providerRevocation: ProviderRevocation }> {
  if (confirmation !== 'EXCLUIR') throw new HttpBadRequestError('Confirme digitando EXCLUIR.');
  return db.transaction(async (tx) => {
    await lockAccountReferences(tx, 'erase');
    const user = await tx.users.findOne({ select: { id: true, email: true, deleted_at: true }, where: { id: userId }, lock: true });
    if (!user) throw new HttpUnauthorizedError();
    if (user.deleted_at) return { deleted: true, providerRevocation: 'unknown' as const };
    const stamp = Date.now();
    const now = new Date(stamp).toISOString();
    const providerRevocation = await detachAppleCredentials(tx, userId, now);
    await tx.session_families.updateMany({ where: { user_id: userId }, data: { revoked_at: now, device_name: sqlNull } });
    const families = await tx.session_families.findMany({ select: { id: true }, where: { user_id: userId } });
    if (families.records.length) await tx.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map((x) => x.id) } } });
    // Stop future generation before touching historical records. Existing amounts/state stay unchanged.
    const billings = await tx.billings.findMany({ select: { id: true }, where: { owner_id: userId }, lock: true });
    for (const billing of billings.records) {
      await tx.billings.updateOne({
        where: { id: billing.id },
        data: {
          state: 'ended',
          description: 'Registro de conta excluída',
          payment_method: { id: sqlNull },
          reminders: sqlNull,
          updated_at: now
        }
      });
    }
    const charges = await tx.charges.findMany({
      select: { id: true, creditor_id: true, recipient_user_id: true, recipient_email_snapshot: true },
      where: { OR: [{ creditor_id: userId }, { recipient_user_id: userId }, { recipient_email_snapshot: user.email }] },
      lock: true
    });
    // Delivery worker lock order is charge -> delivery -> device.
    await disableSessionDevices(tx, userId);
    const ownedProofs = await tx.payment_proofs.findMany({ select: { charge_id: true }, where: { sender_user_id: userId } });
    const ownedIntents = await tx.upload_intents.findMany({ select: { charge_id: true }, where: { sender_user_id: userId } });
    const affected = new Set([
      ...charges.records.map((x) => x.id),
      ...ownedProofs.records.map((x) => x.charge_id),
      ...ownedIntents.records.map((x) => x.charge_id)
    ]);
    for (const chargeId of [...affected].sort()) {
      const charge = await tx.charges.findOne({
        select: { id: true, creditor_id: true, recipient_user_id: true, recipient_email_snapshot: true },
        where: { id: chargeId },
        lock: true
      });
      if (!charge) continue;
      const recipientDeleted = charge.recipient_user_id === userId || charge.recipient_email_snapshot === user.email;
      const creditorDeleted = charge.creditor_id === userId;
      if (recipientDeleted || creditorDeleted) {
        await tx.charges.updateOne({
          where: { id: chargeId },
          data: {
            ...(recipientDeleted
              ? { recipient_user_id: sqlNull, recipient_email_snapshot: sqlNull, recipient_name_snapshot: 'Conta excluída' }
              : {}),
            ...(creditorDeleted ? { pix_key_snapshot: sqlNull, pix_key_type_snapshot: sqlNull, pix_label_snapshot: sqlNull } : {}),
            updated_at: now
          }
        });
        // Keep link tombstones so initial notification expansion cannot mint replacement capability.
        await tx.public_links.updateMany({ where: { charge_id: chargeId }, data: { revoked_at: now } });
        await tx.outbox_events.updateMany({
          where: { aggregate_id: chargeId },
          data: { state: 'failed', ...{ recipient_user_id: sqlNull }, recipient_email: sqlNull, payload: '{}', updated_at: now }
        });
        await tx.notification_deliveries.updateMany({
          where: { charge_id: chargeId, state: 'pending' },
          data: { state: 'suppressed', reason: 'account_deleted', updated_at: now }
        });
        await tx.notification_deliveries.updateMany({
          where: { charge_id: chargeId },
          data: { render_inputs: '{}', recipient_key: 'deleted', recipient_user_id: sqlNull, updated_at: now }
        });
      }
      const proofs = await tx.payment_proofs.findMany({
        select: { id: true, object_key: true },
        where: { charge_id: chargeId, sender_user_id: userId }
      });
      for (const proof of proofs.records) {
        await tx.payments.updateMany({ where: { proof_id: proof.id }, data: { ...{ proof_id: sqlNull }, currency: 'BRL' } });
        await tx.payment_proofs.deleteOne({ where: { id: proof.id } });
        await enqueueStorageDeletion(tx, { key: proof.object_key, chargeId, purpose: 'account' }, stamp);
      }
      const intents = await tx.upload_intents.findMany({
        select: { id: true, object_key: true },
        where: { charge_id: chargeId, sender_user_id: userId }
      });
      for (const intent of intents.records) {
        await tx.upload_intents.deleteOne({ where: { id: intent.id } });
        await enqueueStorageDeletion(tx, { key: intent.object_key, chargeId, purpose: 'account' }, stamp);
      }
      await tx.payment_proofs.updateMany({
        where: { charge_id: chargeId, reviewer_id: userId },
        data: { ...{ reviewer_id: sqlNull }, reason: sqlNull }
      });
    }
    const people = await tx.people.findMany({
      select: { id: true, owner_id: true },
      where: { OR: [{ owner_id: userId }, { linked_user_id: userId }, { active_email: user.email }] }
    });
    for (const person of people.records) {
      await tx.person_contacts.deleteMany({ where: { person_id: person.id } });
      const referenced =
        (await tx.charges.count({ where: { debtor_person_id: person.id } })) +
        (await tx.allocations.count({ where: { person_id: person.id } }));
      if (person.owner_id === userId && !referenced) await tx.people.deleteOne({ where: { id: person.id } });
      else
        await tx.people.updateOne({
          where: { id: person.id },
          data: { name: 'Conta excluída', active_email: sqlNull, ...{ linked_user_id: sqlNull }, archived_at: now, updated_at: now }
        });
    }
    for (const billing of billings.records)
      if (!(await tx.charges.count({ where: { billing_id: billing.id } }))) {
        await tx.allocations.deleteMany({ where: { billing_id: billing.id } });
        await tx.billings.deleteOne({ where: { id: billing.id } });
      }
    await tx.payment_methods.deleteMany({ where: { owner_id: userId } });
    await tx.auth_identities.deleteMany({ where: { user_id: userId } });
    await tx.oauth_grants.deleteMany({ where: { user_id: userId } });
    await tx.login_codes.deleteMany({ where: { email: user.email } });
    await tx.activity_events.deleteMany({ where: { subject_user_id: userId } });
    await tx.activity_events.updateMany({ where: { actor_user_id: userId }, data: { ...{ actor_user_id: sqlNull }, payload: '{}' } });
    await tx.outbox_events.updateMany({
      where: {
        OR: [
          { recipient_user_id: userId },
          { recipient_email: user.email },
          { aggregate_id: { isIn: [userId, ...billings.records.map((x) => x.id)] } }
        ]
      },
      data: { state: 'failed', ...{ recipient_user_id: sqlNull }, recipient_email: sqlNull, payload: '{}', updated_at: now }
    });
    await tx.users.updateOne({
      where: { id: userId },
      data: {
        email: `${userId}@deleted.invalid`,
        verified_email: sqlNull,
        name: 'Conta excluída',
        avatar_url: sqlNull,
        timezone: 'UTC',
        deleted_at: now,
        updated_at: now
      }
    });
    await tx.activity_events.insertOne({
      data: {
        id: crypto.randomUUID(),
        type: 'account.deleted',
        aggregate_type: 'account',
        aggregate_id: userId,
        payload: '{}',
        created_at: now
      }
    });
    return { deleted: true, providerRevocation };
  });
}
