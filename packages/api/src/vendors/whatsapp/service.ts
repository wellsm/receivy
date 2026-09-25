import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappClient, WhatsappInputs } from './client';
import { isWhatsappTransport } from './client';
import type { DisabledWhatsappService } from './transports/disabled';
import type { EvolutionWhatsappService } from './transports/evolution';
import type { FileWhatsappService } from './transports/file';
import type { MetaWhatsappService } from './transports/meta';
import type { WhapWhatsappService } from './transports/whap';

/**
 * WhatsApp factory: the transport name selects the vendor service that delivers. The notice
 * pipeline reads `WHATSAPP_TRANSPORT` for the Receivy number and always names `evolution` for
 * an owner's own number. Vendor-specific variables live in each transport.
 */
export declare class WhatsappService extends Factory.Service<WhatsappClient> {
  handler: typeof createService;

  services: {
    disabled: Environment.Service<DisabledWhatsappService>;
    file: Environment.Service<FileWhatsappService>;
    whap: Environment.Service<WhapWhatsappService>;
    meta: Environment.Service<MetaWhatsappService>;
    evolution: Environment.Service<EvolutionWhatsappService>;
  };
}

export function createService(context: Service.Context<WhatsappService>): WhatsappClient {
  return {
    send: async (transport: string, message: WhatsappInputs.Message) => {
      // A typo in WHATSAPP_TRANSPORT must not fall through to Meta: every delivery there is billed.
      if (!isWhatsappTransport(transport)) {
        throw new Error(`Unknown WhatsApp transport '${String(transport)}'.`);
      }

      return context[transport].send(message);
    }
  };
}
