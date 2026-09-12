import type { Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { EmailProvider } from '../../client';

/**
 * Silent by design: nothing is sent, printed or logged.
 */
export declare class DisabledEmailService extends Factory.Service<EmailProvider> {
  handler: typeof createService;
}

export function createService(_context: Service.Context<DisabledEmailService>): EmailProvider {
  return {
    send: () => {
      return Promise.resolve({ status: 'disabled' });
    }
  };
}
