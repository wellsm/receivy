import type { EmailClient } from '../../common/services/email/client';
import { type NotificationVariables, notificationConfigFrom } from './planner';
import type { NoticeContext, NotifyScheduler } from './send';
import { notificationTransport } from './transport';

type ProducerContext = {
  chargeNotifyScheduler: NotifyScheduler;
  email: EmailClient;
  variables: NotificationVariables & Record<string, string | undefined>;
};

/** Notice context for HTTP handlers: rendering settings, the transport and the reminder scheduler. */
export function noticeContext({ variables, email, chargeNotifyScheduler }: ProducerContext): NoticeContext {
  return {
    config: notificationConfigFrom(variables),
    transport: notificationTransport(variables, globalThis.fetch, email),
    notify: chargeNotifyScheduler
  };
}
