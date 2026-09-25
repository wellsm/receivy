import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappProvider } from '../client';

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

export function createService(_context: Service.Context<MetaWhatsappService>, _request: typeof fetch = globalThis.fetch): WhatsappProvider {
  return { send: async () => ({ status: 'permanent' }) };
}
