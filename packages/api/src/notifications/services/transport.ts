import type { EmailClient } from '../../common/services/email/client';
import { EmailTransport, isEmailTransport } from '../../common/services/email/client';
import { createEmailClient } from '../../common/services/email/compose';
import { createExpoPushClient } from '../../vendors/expo/client';

export type SendResult =
  | { status: 'accepted'; id: string }
  | {
      status: 'disabled' | 'transient' | 'permanent' | 'device_unregistered' | 'uncertain';
    };
export type ReceiptResult = {
  status: 'observation_failed' | 'delivered' | 'pending' | 'transient' | 'permanent' | 'device_unregistered' | 'disabled';
};
export interface EmailNotice {
  to: string;
  key: string;
  subject: string;
  text: string;
  /** The HTML alternative, absent on a notice that has none. */
  html?: string;
  from: string;
}
export interface NotificationTransport {
  email(input: EmailNotice): Promise<SendResult>;
  push(input: { token: string; title: string; body: string; url: string }): Promise<SendResult>;
  receipt(ticket: string): Promise<ReceiptResult>;
}

export function notificationTransport(
  env: Record<string, string | undefined>,
  request: typeof fetch = globalThis.fetch,
  email: EmailClient = createEmailClient(env, request)
): NotificationTransport {
  const emailTransport = env.EMAIL_TRANSPORT;
  const expo = createExpoPushClient(env, request);

  return {
    async email(input) {
      if (!isEmailTransport(emailTransport) || emailTransport === EmailTransport.Disabled) {
        return { status: 'disabled' };
      }

      if (!input.from || input.from === 'disabled') {
        return { status: 'permanent' };
      }

      return email.send(emailTransport, input);
    },
    async push(input) {
      if (env.NOTIFICATION_PUSH_TRANSPORT !== 'expo') {
        return { status: 'disabled' };
      }

      return expo.send(input);
    },
    async receipt(ticket) {
      if (env.NOTIFICATION_PUSH_TRANSPORT !== 'expo') {
        return { status: 'disabled' };
      }

      return expo.receipt(ticket);
    }
  };
}
