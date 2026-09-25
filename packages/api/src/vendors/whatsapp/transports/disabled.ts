import type { Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappProvider } from '../client';

/** Silent by design: nothing is sent, printed or logged. */
export declare class DisabledWhatsappService extends Factory.Service<WhatsappProvider> {
  handler: typeof createService;
}

export function createService(_context: Service.Context<DisabledWhatsappService>): WhatsappProvider {
  return {
    send: () => {
      return Promise.resolve({ status: 'disabled' });
    }
  };
}
