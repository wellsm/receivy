import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { Object, String } from '@ez4/schema';
import { WhatsappInstanceRepository } from '../../notifications/repositories/whatsapp-instance';
import { WhatsappMessageRepository } from '../../notifications/repositories/whatsapp-message';
import { verifyEvolutionSecret } from '../../vendors/whatsapp/signature';
import { evolutionInstanceOf, parseEvolutionEvent } from '../../vendors/whatsapp/webhook';
import type { WebhookProvider } from '../provider';

declare class EvolutionWebhookRequest implements Http.Request {
  headers: { authorization?: String.Max<256> };
  body: Object.Any;
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

/**
 * Events of an owner's own instance. The instance named in the body must exist and the header must
 * carry the secret registered on it; anything else is 401, whatever the event says.
 */
export async function whatsappEvolutionWebhookHandler({ headers, body }: EvolutionWebhookRequest, { db, whatsappInstances }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  const name = evolutionInstanceOf(body);
  const instance = name ? await WhatsappInstanceRepository.byName(db, name) : null;

  if (!instance || !verifyEvolutionSecret(instance.webhook_secret, headers.authorization)) {
    throw new HttpUnauthorizedError();
  }

  const event = parseEvolutionEvent(body);

  if (!event) {
    return RECEIVED;
  }

  const now = new Date();

  if (event.kind === 'connection') {
    await whatsappInstances.applyConnection(event.instance, event.state, event.phone, now);
  } else if (event.kind === 'qr') {
    await whatsappInstances.applyQr(event.instance, event.qr, now);
  } else {
    await WhatsappMessageRepository.applyStatus(db, event.providerMessageId, event.status, undefined, now.toISOString());
  }

  return RECEIVED;
}
