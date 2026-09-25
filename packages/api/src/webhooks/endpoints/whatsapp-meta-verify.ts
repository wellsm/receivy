import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpForbiddenError } from '@ez4/gateway';
import type { Object } from '@ez4/schema';
import type { WebhookProvider } from '../provider';

declare class VerifyRequest implements Http.Request {
  /** `hub.mode`, `hub.verify_token`, `hub.challenge`: dotted names, so the query stays an open object. */
  query: Object.Any;
}

declare class VerifyResponse implements Http.Response {
  status: 200;
  headers: { 'content-type': string };
  body: string;
}

/** Meta's subscription handshake: public on purpose, protected by the verify token typed the same in the dashboard. */
export async function verifyWhatsappWebhookHandler({ query }: VerifyRequest, { variables }: Service.Context<WebhookProvider>): Promise<VerifyResponse> {
  const expected = variables.WHATSAPP_VERIFY_TOKEN;
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (!expected || expected === 'disabled' || query['hub.mode'] !== 'subscribe' || token !== expected || typeof challenge !== 'string') {
    throw new HttpForbiddenError();
  }

  return { status: 200, headers: { 'content-type': 'text/plain' }, body: challenge };
}
