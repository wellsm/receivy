import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappProvider } from '../client';

export declare class WhapWhatsappService extends Factory.Service<WhatsappProvider> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    WHAP_API_URL: Environment.VariableOrValue<'WHAP_API_URL', 'http://127.0.0.1:3011'>;
    WHAP_PHONE_NUMBER_ID: Environment.VariableOrValue<'WHAP_PHONE_NUMBER_ID', '000000000000000'>;
    WHATSAPP_API_VERSION: Environment.VariableOrValue<'WHATSAPP_API_VERSION', 'v21.0'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService(_context: Service.Context<WhapWhatsappService>, _request: typeof fetch = globalThis.fetch): WhatsappProvider {
  return { send: async () => ({ status: 'permanent' }) };
}
