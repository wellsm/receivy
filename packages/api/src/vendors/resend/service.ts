import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { EmailInputs, EmailOutputs, EmailProvider } from '../../common/services/email/client';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Provider bodies and errors never escape this boundary or enter logs.
 */
export declare class ResendEmailService extends Factory.Service<EmailProvider> {
  handler: typeof createService;

  variables: {
    RESEND_API_KEY: Environment.Variable<'RESEND_API_KEY'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService({ variables }: Service.Context<ResendEmailService>, request: typeof fetch = globalThis.fetch): EmailProvider {
  const { RESEND_API_KEY } = variables;

  return {
    send: async (message: EmailInputs.Message) => {
      if (!RESEND_API_KEY || RESEND_API_KEY === 'disabled') {
        return { status: 'permanent' };
      }

      try {
        const response = await request(RESEND_ENDPOINT, {
          method: 'POST',
          headers: getHeaders(RESEND_API_KEY, message.key),
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
            ...(message.headers ? { headers: message.headers } : {})
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (!response.ok) {
          return { status: getFailureStatus(response.status) };
        }

        const body = (await response.json().catch(() => ({}))) as { id?: unknown };

        if (typeof body.id !== 'string') {
          return { status: 'uncertain' };
        }

        return { status: 'accepted', id: body.id };
      } catch {
        return { status: 'uncertain' };
      }
    }
  };
}

const getHeaders = (apiKey: string, key?: string) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  if (key) {
    headers['Idempotency-Key'] = key;
  }

  return headers;
};

const getFailureStatus = (status: number): EmailOutputs.Rejected['status'] => {
  if (status === 429 || status >= 500) {
    return 'transient';
  }

  return 'permanent';
};
