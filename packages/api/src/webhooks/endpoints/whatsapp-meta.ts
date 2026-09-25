import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { WhatsappMessageRepository } from '../../notifications/repositories/whatsapp-message';
import { verifyMetaSignature } from '../../vendors/whatsapp/signature';
import { parseMetaStatuses } from '../../vendors/whatsapp/webhook';
import type { WebhookProvider } from '../provider';

declare class MetaWebhookRequest implements Http.Request {
  headers: { 'x-hub-signature-256'?: String.Max<128> };
  /** Raw, as Stripe's: the signature covers the bytes that arrived, not a re-serialised body. */
  body: string;
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

/** Delivery statuses of the Receivy number. Always 200 once the signature holds: Meta retries anything else for days. */
export async function whatsappMetaWebhookHandler({ headers, body }: MetaWebhookRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  if (!verifyMetaSignature(variables.WHATSAPP_APP_SECRET ?? '', body, headers['x-hub-signature-256'])) {
    throw new HttpUnauthorizedError();
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return RECEIVED;
  }

  const now = new Date().toISOString();

  for (const update of parseMetaStatuses(payload)) {
    await WhatsappMessageRepository.applyStatus(db, update.providerMessageId, update.status, update.error, now);
  }

  return RECEIVED;
}
