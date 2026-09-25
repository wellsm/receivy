import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappInputs, WhatsappProvider } from '../client';

const REQUEST_TIMEOUT_MS = 15_000;

type EvolutionSendBody = { key?: { id?: unknown } };

/**
 * The owner's own number through an Evolution API instance (Baileys). Free text: no template
 * approval, and no promise of delivery either. The global API key never comes here; each
 * instance carries its own token and that is the only credential this transport sees.
 */
export declare class EvolutionWhatsappService extends Factory.Service<WhatsappProvider> {
  handler: typeof createService;

  variables: {
    EVOLUTION_API_URL: Environment.VariableOrValue<'EVOLUTION_API_URL', 'http://127.0.0.1:8080'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService({ variables }: Service.Context<EvolutionWhatsappService>, request: typeof fetch = globalThis.fetch): WhatsappProvider {
  const base = (variables.EVOLUTION_API_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');

  return {
    send: async (message: WhatsappInputs.Message) => {
      // No instance means the owner never paired a number: sending again will not change that.
      if (!message.instance) {
        return { status: 'permanent' };
      }

      try {
        const response = await request(`${base}/message/sendText/${encodeURIComponent(message.instance.name)}`, {
          method: 'POST',
          headers: { apikey: message.instance.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: message.to, text: message.text }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (!response.ok) {
          // 4xx is the instance (missing, closed, bad number): the webhook already told us or will; retrying now does not help.
          return { status: response.status < 500 && response.status !== 429 ? 'permanent' : 'transient' };
        }

        const body = (await response.json().catch(() => ({}))) as EvolutionSendBody;
        const id = body.key?.id;

        if (typeof id !== 'string' || !id) {
          return { status: 'transient' };
        }

        return { status: 'accepted', id };
      } catch {
        return { status: 'transient' };
      }
    }
  };
}
