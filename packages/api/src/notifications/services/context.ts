import { checkoutClients } from '../../charges/services/payment-link';
import type { EmailClient } from '../../common/services/email/client';
import { type NotificationVariables, notificationConfigFrom } from './planner';
import type { NoticeContext } from './send';
import { notificationTransport } from './transport';

type ProducerContext = {
  email: EmailClient;
  variables: NotificationVariables & Record<string, string | undefined>;
};

/** Notice context for HTTP handlers: rendering settings and the transport. */
export function noticeContext({ variables, email }: ProducerContext): NoticeContext {
  return {
    config: notificationConfigFrom(variables),
    transport: notificationTransport(variables, globalThis.fetch, email),
    links: checkoutClients(variables)
  };
}
