import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappInputs, WhatsappOutputs, WhatsappProvider } from '../client';

const META_ENDPOINT = 'https://graph.facebook.com';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Permanent is what a retry does not fix: the number is not on WhatsApp (131026), the person is
 * outside the re-engagement window or Meta chose not to deliver (131047, 131049, 131050), the
 * payload is ours and wrong (100), or the template is missing, paused or mismatched (132000–132015).
 * Everything else (throttle 130429, spam rate 131048, 5xx, network) is transient.
 */
const PERMANENT_ERROR_CODES = new Set([100, 131026, 131047, 131049, 131050]);

const TEMPLATE_ERROR_MIN = 132000;
const TEMPLATE_ERROR_MAX = 132015;

export function isPermanentMetaError(code: number): boolean {
  if (code >= TEMPLATE_ERROR_MIN && code <= TEMPLATE_ERROR_MAX) {
    return true;
  }

  return PERMANENT_ERROR_CODES.has(code);
}

export type MetaConfig = {
  baseUrl?: string;
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
};

type MetaResponseBody = {
  messages?: { id?: unknown }[];
  error?: { code?: unknown; message?: unknown };
};

/** One call to the Cloud API. Never throws: a network failure is a transient result like any other. */
export async function postMetaMessage(config: MetaConfig, message: WhatsappInputs.Message, request: typeof fetch): Promise<WhatsappOutputs.Result> {
  const base = (config.baseUrl ?? META_ENDPOINT).replace(/\/+$/, '');
  const url = `${base}/${config.apiVersion}/${config.phoneNumberId}/messages`;

  try {
    const response = await request(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: message.to, type: 'template', template: message.template }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    let body: MetaResponseBody;

    try {
      body = (await response.json()) as MetaResponseBody;
    } catch {
      return { status: 'transient' };
    }

    if (response.ok) {
      const id = body.messages?.[0]?.id;

      // Accepted without a wamid: nothing to match a status to, so it is tried again later.
      if (typeof id !== 'string' || !id) {
        return { status: 'transient' };
      }

      return { status: 'accepted', id };
    }

    const code = body.error?.code;

    if (typeof code === 'number') {
      return { status: isPermanentMetaError(code) ? 'permanent' : 'transient' };
    }

    // No code in the body: the status range decides, 4xx is ours, 5xx and 429 are theirs.
    return { status: response.status < 500 && response.status !== 429 ? 'permanent' : 'transient' };
  } catch {
    return { status: 'transient' };
  }
}

/** The real Cloud API. Every delivery is billed by Meta. Provider bodies and errors never enter logs. */
export declare class MetaWhatsappService extends Factory.Service<WhatsappProvider> {
  handler: typeof createService;

  variables: {
    WHATSAPP_ACCESS_TOKEN: Environment.Variable<'WHATSAPP_ACCESS_TOKEN'>;
    WHATSAPP_PHONE_NUMBER_ID: Environment.Variable<'WHATSAPP_PHONE_NUMBER_ID'>;
    WHATSAPP_API_VERSION: Environment.VariableOrValue<'WHATSAPP_API_VERSION', 'v21.0'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService({ variables }: Service.Context<MetaWhatsappService>, request: typeof fetch = globalThis.fetch): WhatsappProvider {
  const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION } = variables;

  return {
    send: async (message: WhatsappInputs.Message) => {
      if (!WHATSAPP_ACCESS_TOKEN || WHATSAPP_ACCESS_TOKEN === 'disabled' || !WHATSAPP_PHONE_NUMBER_ID) {
        return { status: 'permanent' };
      }

      return postMetaMessage({ accessToken: WHATSAPP_ACCESS_TOKEN, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, apiVersion: WHATSAPP_API_VERSION ?? 'v21.0' }, message, request);
    }
  };
}
