import { checkoutClients } from '../../charges/services/payment-link';
import type { EmailClient } from '../../common/services/email/client';
import type { WhatsappClient } from '../../vendors/whatsapp/client';
import { type NotificationVariables, notificationConfigFrom } from './planner';
import type { NoticeContext } from './send';
import { notificationTransport } from './transport';

type ProducerContext = {
  email: EmailClient;
  // Optional: producers that do not send WhatsApp yet (billing, invites, public links) fall
  // back to notificationTransport's own default, built straight from `variables`.
  whatsapp?: WhatsappClient;
  variables: NotificationVariables & Record<string, string | undefined>;
};

/** Notice context for HTTP handlers: rendering settings and the transport. */
export function noticeContext({ variables, email, whatsapp }: ProducerContext): NoticeContext {
  return {
    config: notificationConfigFrom(variables),
    transport: notificationTransport(variables, globalThis.fetch, email, whatsapp),
    links: checkoutClients(variables)
  };
}
