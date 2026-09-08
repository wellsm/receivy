import type { EmailTransport as LoginCodeMailer } from '../auth/email-login';
import type { EmailClient } from './client';

import { isEmailTransport } from './client';

const LOGIN_CODE_SUBJECT = 'Seu código de acesso ao Receivy';

/**
 * Login-code adapter over the email factory client. The transport comes straight
 * from `EMAIL_TRANSPORT`, so an unknown value fails here, before any code is issued.
 */
export function createLoginCodeMailer(client: EmailClient, transport: string, from: string): LoginCodeMailer {
  if (!isEmailTransport(transport)) {
    throw new Error(`Unknown email transport '${transport}'.`);
  }

  return {
    sendLoginCode: async ({ code, email }) => {
      const result = await client.send(transport, {
        from,
        to: email,
        subject: LOGIN_CODE_SUBJECT,
        text: `Seu código de acesso é ${code}. Ele expira em 10 minutos.`
      });

      if (result.status === 'accepted' || result.status === 'disabled') {
        return;
      }

      throw new Error('Email delivery failed');
    }
  };
}
