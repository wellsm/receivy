import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappProvider } from '../client';

export declare class EvolutionWhatsappService extends Factory.Service<WhatsappProvider> {
  handler: typeof createService;

  variables: {
    EVOLUTION_API_URL: Environment.VariableOrValue<'EVOLUTION_API_URL', 'http://127.0.0.1:8080'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService(_context: Service.Context<EvolutionWhatsappService>, _request: typeof fetch = globalThis.fetch): WhatsappProvider {
  return { send: async () => ({ status: 'permanent' }) };
}
