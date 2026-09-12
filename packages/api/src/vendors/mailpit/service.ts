import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { EmailInputs, EmailOutputs, EmailProvider } from '../../common/services/email/client';

/**
 * Mailpit runs from `packages/api/docker-compose.yml` and serves both the mailbox
 * UI and the REST API on the same port.
 */
export const DEFAULT_MAILPIT_API_URL = 'http://127.0.0.1:8025';

const SEND_PATH = '/api/v1/send';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Local and test only: delivers through the Mailpit HTTP API so every message stays
 * inside the local mailbox. Never reachable from a deployed stage.
 */
export declare class MailpitEmailService extends Factory.Service<EmailProvider> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    MAILPIT_API_URL: Environment.VariableOrValue<'MAILPIT_API_URL', 'http://127.0.0.1:8025'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService(context: Service.Context<MailpitEmailService>, request: typeof fetch = globalThis.fetch): EmailProvider {
  const { APP_STAGE, MAILPIT_API_URL } = context.variables;

  if (APP_STAGE !== 'local' && APP_STAGE !== 'test') {
    throw new Error(`Email transport 'mailpit' is only allowed when APP_STAGE is local or test.`);
  }

  const endpoint = `${getBaseUrl(MAILPIT_API_URL)}${SEND_PATH}`;

  return {
    send: async (message: EmailInputs.Message) => {
      try {
        const response = await request(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getPayload(message)),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (!response.ok) {
          return { status: getFailureStatus(response.status) };
        }

        const body = (await response.json().catch(() => ({}))) as { ID?: unknown };

        if (typeof body.ID !== 'string') {
          return { status: 'uncertain' };
        }

        return { status: 'accepted', id: body.ID };
      } catch {
        return { status: 'uncertain' };
      }
    }
  };
}

export const getBaseUrl = (url?: string) => {
  return (url || DEFAULT_MAILPIT_API_URL).replace(/\/+$/, '');
};

const getPayload = (message: EmailInputs.Message) => {
  return {
    from: getAddress(message.from),
    to: [getAddress(message.to)],
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(message.key ? { headers: { 'X-Receivy-Key': message.key } } : {})
  };
};

/**
 * Senders travel as `Name <address>` across the project, Mailpit wants them split.
 */
const getAddress = (value: string) => {
  const match = value.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);

  if (!match) {
    return { email: value.trim() };
  }

  const [, name, email] = match;

  if (!name) {
    return { email };
  }

  return { name, email };
};

const getFailureStatus = (status: number): EmailOutputs.Rejected['status'] => {
  if (status === 429 || status >= 500) {
    return 'transient';
  }

  return 'permanent';
};
