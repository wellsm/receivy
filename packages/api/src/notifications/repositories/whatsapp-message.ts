import { WhatsappMessageStatus, WhatsappSender } from '@receivy/common';
import type { DbClient } from '../../database';
import type { NoticeTemplate } from '../services/render';

/** Statuses only move forward; `failed` outranks everything, so a late `sent` never revives a `read`. */
const RANK: Record<WhatsappMessageStatus, number> = {
  [WhatsappMessageStatus.Queued]: 0,
  [WhatsappMessageStatus.Sent]: 1,
  [WhatsappMessageStatus.Delivered]: 2,
  [WhatsappMessageStatus.Read]: 3,
  [WhatsappMessageStatus.Failed]: 4
};

export namespace WhatsappMessageRepository {
  export type Input = { ownerId: string; chargeId: string; to: string; sender: WhatsappSender; template: NoticeTemplate; now: string };

  export async function insert(db: DbClient, input: Input): Promise<{ id: string }> {
    const id = crypto.randomUUID();

    await db.whatsapp_messages.insertOne({
      data: {
        id,
        owner: { id: input.ownerId },
        charge: { id: input.chargeId },
        to: input.to,
        sender: input.sender,
        template: input.template,
        status: WhatsappMessageStatus.Queued,
        created_at: input.now,
        updated_at: input.now
      }
    });

    return { id };
  }

  export async function markSent(db: DbClient, id: string, providerMessageId: string, now: string): Promise<void> {
    await db.whatsapp_messages.updateOne({ select: { id: true }, where: { id }, data: { status: WhatsappMessageStatus.Sent, provider_message_id: providerMessageId, updated_at: now } });
  }

  export async function markFailed(db: DbClient, id: string, error: string, now: string): Promise<void> {
    await db.whatsapp_messages.updateOne({ select: { id: true }, where: { id }, data: { status: WhatsappMessageStatus.Failed, error: error.slice(0, 512), updated_at: now } });
  }

  /** A provider status for a message we sent; false when the id is unknown or the status would move backwards. */
  export async function applyStatus(db: DbClient, providerMessageId: string, status: WhatsappMessageStatus, error: string | undefined, now: string): Promise<boolean> {
    const { records } = await db.whatsapp_messages.findMany({ select: { id: true, status: true }, where: { provider_message_id: providerMessageId }, take: 1 });
    const row = records[0];

    if (!row || RANK[status] <= RANK[row.status]) {
      return false;
    }

    await db.whatsapp_messages.updateOne({
      select: { id: true },
      where: { id: row.id },
      data: { status, ...(error ? { error: error.slice(0, 512) } : {}), updated_at: now }
    });

    return true;
  }

  /** Messages the Receivy number carried for the owner inside `[from, to)`; failed ones cost nothing. */
  export async function countInCycle(db: DbClient, ownerId: string, from: string, to: string): Promise<number> {
    return db.whatsapp_messages.count({
      where: { owner_id: ownerId, sender: WhatsappSender.Receivy, status: { not: WhatsappMessageStatus.Failed }, created_at: { gte: from, lt: to } }
    });
  }
}
