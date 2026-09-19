import type { PaymentProvider } from '@receivy/common';
import type { DbClient } from '../../database';
import type { IntegrationCredentialsSchema } from '../schemas/integration';

const sqlNull = null as unknown as undefined;

export namespace IntegrationRepository {
  export type Row = {
    id: string;
    owner_id: string;
    provider: PaymentProvider;
    credentials: IntegrationCredentialsSchema;
    label: string;
    revoked_at?: string;
    created_at: string;
    updated_at: string;
  };

  export async function get(db: DbClient, id: string): Promise<Row | null> {
    const row = await db.integrations.findOne({
      select: { id: true, owner_id: true, provider: true, credentials: true, label: true, revoked_at: true, created_at: true, updated_at: true },
      where: { id }
    });

    return row ?? null;
  }

  /** The owner's account at one provider, revoked or not: there is at most one. */
  export async function byOwner(db: DbClient, ownerId: string, provider: PaymentProvider): Promise<Row | null> {
    const row = await db.integrations.findOne({
      select: { id: true, owner_id: true, provider: true, credentials: true, label: true, revoked_at: true, created_at: true, updated_at: true },
      where: { owner_id: ownerId, provider }
    });

    return row ?? null;
  }

  /** Connects (or reconnects) the owner's account at a provider with fresh credentials; a revoked row comes back to life. */
  export async function upsert(
    db: DbClient,
    input: { ownerId: string; provider: PaymentProvider; credentials: IntegrationCredentialsSchema; label: string; now: string }
  ): Promise<Row> {
    const existing = await byOwner(db, input.ownerId, input.provider);

    if (existing) {
      await db.integrations.updateOne({
        select: { id: true },
        where: { id: existing.id },
        data: { credentials: input.credentials, label: input.label, revoked_at: sqlNull, updated_at: input.now }
      });

      return (await get(db, existing.id))!;
    }

    return db.integrations.insertOne({
      select: { id: true, owner_id: true, provider: true, credentials: true, label: true, revoked_at: true, created_at: true, updated_at: true },
      data: { id: crypto.randomUUID(), owner: { id: input.ownerId }, provider: input.provider, credentials: input.credentials, label: input.label, created_at: input.now, updated_at: input.now }
    });
  }

  export async function revoke(db: DbClient, id: string, now: string): Promise<void> {
    await db.integrations.updateOne({ select: { id: true }, where: { id }, data: { revoked_at: now, updated_at: now } });
  }
}
