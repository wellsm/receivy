import { createHmac } from 'node:crypto';
import type { Service } from '@ez4/common';
import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';
import { WhatsappMessageStatus } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import type { WebhookProvider } from '../provider';
import { whatsappMetaWebhookHandler } from './whatsapp-meta';
import { verifyWhatsappWebhookHandler } from './whatsapp-meta-verify';

const SECRET = 'app-secret';
const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')}`;

/** A database with one sent message; `applied` records every status the handler tried to apply. */
function fakeContext() {
  const applied: { id: string; status: WhatsappMessageStatus; error?: string }[] = [];
  const rows = new Map([['wamid.1', { id: 'row-1', status: WhatsappMessageStatus.Sent }]]);
  const db = {
    whatsapp_messages: {
      findMany: async ({ where }: { where: { provider_message_id: string } }) => ({ records: rows.has(where.provider_message_id) ? [rows.get(where.provider_message_id)] : [] }),
      updateOne: async ({ data }: { data: { status: WhatsappMessageStatus; error?: string } }) => {
        applied.push({ id: 'row-1', status: data.status, ...(data.error ? { error: data.error } : {}) });
        rows.set('wamid.1', { id: 'row-1', status: data.status });
      }
    }
  };
  const context = { db, variables: { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'verify-me' } } as unknown as Service.Context<WebhookProvider>;

  return { context, applied };
}

describe('GET /webhooks/whatsapp/meta', () => {
  it('echoes the challenge for the right verify token and refuses the rest', async () => {
    const { context } = fakeContext();

    expect(await verifyWhatsappWebhookHandler({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '42' } }, context)).toEqual({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: '42'
    });
    await expect(verifyWhatsappWebhookHandler({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' } }, context)).rejects.toBeInstanceOf(HttpForbiddenError);
  });
});

describe('POST /webhooks/whatsapp/meta', () => {
  const payload = (statuses: unknown[]) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses } }] }] });

  it('refuses a bad signature and applies statuses in order, never backwards', async () => {
    const { context, applied } = fakeContext();
    const body = payload([
      { id: 'wamid.1', status: 'read' },
      { id: 'wamid.1', status: 'delivered' },
      { id: 'wamid.unknown', status: 'delivered' }
    ]);

    await expect(whatsappMetaWebhookHandler({ headers: { 'x-hub-signature-256': 'sha256=00' }, body }, context)).rejects.toBeInstanceOf(HttpUnauthorizedError);
    expect(await whatsappMetaWebhookHandler({ headers: { 'x-hub-signature-256': sign(body) }, body }, context)).toEqual({ status: 200, body: { received: true } });
    expect(applied).toEqual([{ id: 'row-1', status: WhatsappMessageStatus.Read }]);
  });

  it('records the failure reason and answers 200 to a body it cannot parse', async () => {
    const { context, applied } = fakeContext();
    const body = payload([{ id: 'wamid.1', status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] }]);

    expect(await whatsappMetaWebhookHandler({ headers: { 'x-hub-signature-256': sign(body) }, body }, context)).toEqual({ status: 200, body: { received: true } });
    expect(applied).toEqual([{ id: 'row-1', status: WhatsappMessageStatus.Failed, error: '131026: Undeliverable' }]);
    expect(await whatsappMetaWebhookHandler({ headers: { 'x-hub-signature-256': sign('not json') }, body: 'not json' }, context)).toEqual({ status: 200, body: { received: true } });
  });
});
