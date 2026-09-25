import { WhatsappInstanceState } from '@receivy/common';
import type { DbClient } from '../../database';

const sqlNull = null as unknown as undefined;

export namespace WhatsappInstanceRepository {
  export type Row = {
    id: string;
    owner_id: string;
    name: string;
    token: string;
    webhook_secret: string;
    state: WhatsappInstanceState;
    phone?: string;
    qr?: string;
    pairing_code?: string;
    connected_at?: string;
    disconnected_at?: string;
  };

  const SELECT = {
    id: true,
    owner_id: true,
    name: true,
    token: true,
    webhook_secret: true,
    state: true,
    phone: true,
    qr: true,
    pairing_code: true,
    connected_at: true,
    disconnected_at: true
  } as const;

  export async function byOwner(db: DbClient, ownerId: string): Promise<Row | null> {
    const row = await db.whatsapp_instances.findOne({ select: SELECT, where: { owner_id: ownerId } });

    return row ?? null;
  }

  export async function byName(db: DbClient, name: string): Promise<Row | null> {
    const row = await db.whatsapp_instances.findOne({ select: SELECT, where: { name } });

    return row ?? null;
  }

  export async function insert(
    db: DbClient,
    input: { ownerId: string; name: string; token: string; webhookSecret: string; qr?: string; phone?: string; pairingCode?: string; now: string }
  ): Promise<Row> {
    return db.whatsapp_instances.insertOne({
      select: SELECT,
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        name: input.name,
        token: input.token,
        webhook_secret: input.webhookSecret,
        state: WhatsappInstanceState.Pending,
        ...(input.qr ? { qr: input.qr } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.pairingCode ? { pairing_code: input.pairingCode } : {}),
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  export type StatePatch = {
    state?: WhatsappInstanceState;
    phone?: string | null;
    qr?: string | null;
    pairingCode?: string | null;
    connectedAt?: string | null;
    disconnectedAt?: string | null;
  };

  export async function setState(db: DbClient, id: string, patch: StatePatch, now: string): Promise<void> {
    await db.whatsapp_instances.updateOne({
      select: { id: true },
      where: { id },
      data: {
        ...(patch.state ? { state: patch.state } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone ?? sqlNull } : {}),
        ...(patch.qr !== undefined ? { qr: patch.qr ?? sqlNull } : {}),
        ...(patch.pairingCode !== undefined ? { pairing_code: patch.pairingCode ?? sqlNull } : {}),
        ...(patch.connectedAt !== undefined ? { connected_at: patch.connectedAt ?? sqlNull } : {}),
        ...(patch.disconnectedAt !== undefined ? { disconnected_at: patch.disconnectedAt ?? sqlNull } : {}),
        updated_at: now
      }
    });
  }

  export async function remove(db: DbClient, id: string): Promise<void> {
    await db.whatsapp_instances.deleteOne({ select: { id: true }, where: { id } });
  }
}
