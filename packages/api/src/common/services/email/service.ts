import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { EmailClient, EmailInputs, EmailTransport } from './client';
import { isEmailTransport } from './client';
import type { DisabledEmailService } from './vendors/disabled/service';
import type { FileEmailService } from './vendors/file/service';
import type { ResendEmailService } from './vendors/resend/service';

/**
 * Email factory: the transport name selects the vendor service that actually
 * delivers the message. Login codes use `EMAIL_TRANSPORT`; notifications use
 * `NOTIFICATION_EMAIL_TRANSPORT`. Vendor-specific variables live in each vendor.
 */
export declare class EmailService extends Factory.Service<EmailClient> {
  handler: typeof createService;

  services: {
    disabled: Environment.Service<DisabledEmailService>;
    file: Environment.Service<FileEmailService>;
    resend: Environment.Service<ResendEmailService>;
  };
}

export function createService(context: Service.Context<EmailService>): EmailClient {
  return {
    send: (transport: EmailTransport, message: EmailInputs.Message) => {
      if (!isEmailTransport(transport)) {
        throw new Error(`Unknown email transport '${String(transport)}'.`);
      }

      return context[transport].send(message);
    }
  };
}
