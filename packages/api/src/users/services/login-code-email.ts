import type { EmailClient } from '../../common/services/email/client';
import { isEmailTransport } from '../../common/services/email/client';
import { emailDocument, noticeRow, panelRow } from '../../common/services/email/layout';
import type { EmailTransport as LoginCodeMailer } from './email-login';

const LOGIN_CODE_SUBJECT = 'Seu código de acesso ao Receivy';

const EXPIRY = 'Expira em 10 minutos';

const SAFETY = 'Não pediu este código? Ignore esta mensagem. Ninguém entra na sua conta sem ele.';

const FOOTNOTE = 'O Receivy nunca pede sua senha, seu código ou sua chave Pix por telefone, WhatsApp ou redes sociais.';

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
      const text = `Seu código de acesso é ${code}. Ele expira em 10 minutos.`;

      const result = await client.send(transport, {
        from,
        to: email,
        subject: LOGIN_CODE_SUBJECT,
        text,
        html: emailDocument({
          eyebrow: 'Verificação de acesso',
          heading: 'Use este código para entrar',
          lead: 'Ele vale para uma única entrada, no aparelho que pediu o acesso.',
          body: [panelRow('Seu código', code, EXPIRY), noticeRow(SAFETY)].join(''),
          footnote: FOOTNOTE,
          preheader: text
        })
      });

      if (result.status === 'accepted' || result.status === 'disabled') {
        return;
      }

      throw new Error('Email delivery failed');
    }
  };
}
