import type { Service } from '@ez4/common';
import { HttpUnauthorizedError } from '@ez4/gateway';
import { WhatsappInstanceState, WhatsappMessageStatus } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import type { WebhookProvider } from '../provider';
import { whatsappEvolutionWebhookHandler } from './whatsapp-evolution';

function fakeContext() {
  const calls: unknown[] = [];
  const instance = { id: 'i-1', owner_id: 'o-1', name: 'rcv_o-1', token: 't', webhook_secret: 'hook-secret', state: WhatsappInstanceState.Pending };
  const db = {
    whatsapp_instances: { findOne: async ({ where }: { where: { name?: string } }) => (where.name === instance.name ? instance : undefined) },
    whatsapp_messages: {
      findMany: async () => ({ records: [{ id: 'row-1', status: WhatsappMessageStatus.Sent }] }),
      updateOne: async ({ data }: { data: { status: WhatsappMessageStatus } }) => {
        calls.push({ status: data.status });
      }
    }
  };
  const whatsappInstances = {
    applyConnection: async (name: string, state: string, phone?: string) => {
      calls.push({ connection: [name, state, phone] });
    },
    applyQr: async (name: string, qr: string) => {
      calls.push({ qr: [name, qr] });
    }
  };
  const context = { db, whatsappInstances, variables: {} } as unknown as Service.Context<WebhookProvider>;

  return { context, calls };
}

describe('POST /webhooks/whatsapp/evolution', () => {
  it('refuses an unknown instance or a wrong secret, and routes each event', async () => {
    const { context, calls } = fakeContext();
    const headers = { authorization: 'hook-secret' };

    await expect(whatsappEvolutionWebhookHandler({ headers, body: { event: 'connection.update', instance: 'rcv_other', data: { state: 'open' } } }, context)).rejects.toBeInstanceOf(HttpUnauthorizedError);
    await expect(whatsappEvolutionWebhookHandler({ headers: { authorization: 'wrong' }, body: { event: 'connection.update', instance: 'rcv_o-1', data: { state: 'open' } } }, context)).rejects.toBeInstanceOf(
      HttpUnauthorizedError
    );

    expect(await whatsappEvolutionWebhookHandler({ headers, body: { event: 'connection.update', instance: 'rcv_o-1', data: { state: 'open', wuid: '5511988887777@s.whatsapp.net' } } }, context)).toEqual({
      status: 200,
      body: { received: true }
    });
    expect(await whatsappEvolutionWebhookHandler({ headers, body: { event: 'qrcode.updated', instance: 'rcv_o-1', data: { qrcode: { base64: 'QR' } } } }, context)).toEqual({ status: 200, body: { received: true } });
    expect(await whatsappEvolutionWebhookHandler({ headers, body: { event: 'messages.update', instance: 'rcv_o-1', data: { keyId: 'BAE5', status: 'READ' } } }, context)).toEqual({ status: 200, body: { received: true } });
    expect(await whatsappEvolutionWebhookHandler({ headers, body: { event: 'contacts.upsert', instance: 'rcv_o-1', data: {} } }, context)).toEqual({ status: 200, body: { received: true } });

    expect(calls).toEqual([{ connection: ['rcv_o-1', 'open', '5511988887777'] }, { qr: ['rcv_o-1', 'QR'] }, { status: WhatsappMessageStatus.Read }]);
  });
});
