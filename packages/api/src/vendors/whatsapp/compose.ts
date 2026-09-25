import type { Service } from '@ez4/common';
import type { WhatsappClient } from './client';
import type { WhatsappService } from './service';
import { createService } from './service';
import type { DisabledWhatsappService } from './transports/disabled';
import { createService as createDisabledService } from './transports/disabled';
import type { EvolutionWhatsappService } from './transports/evolution';
import { createService as createEvolutionService } from './transports/evolution';
import type { FileWhatsappService } from './transports/file';
import { createService as createFileService } from './transports/file';
import type { MetaWhatsappService } from './transports/meta';
import { createService as createMetaService } from './transports/meta';
import type { WhapWhatsappService } from './transports/whap';
import { createService as createWhapService } from './transports/whap';

export type WhatsappEnvironment = {
  APP_STAGE?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_API_VERSION?: string;
  WHATSAPP_FILE_DIRECTORY?: string;
  WHAP_API_URL?: string;
  WHAP_PHONE_NUMBER_ID?: string;
  EVOLUTION_API_URL?: string;
};

/**
 * Builds the WhatsApp client outside the EZ4 runtime (tests, scripts) from the same vendor
 * services the factory links in production. `file` and `whap` are only constructed when asked
 * for, mirroring their fail-closed stage guards.
 */
export const createWhatsappClient = (env: WhatsappEnvironment, request?: typeof fetch): WhatsappClient => {
  const variables = { ...env };

  // Resolved per call so test doubles installed on globalThis after composition still apply.
  const fetchLazily: typeof fetch = (input, init) => (request ?? globalThis.fetch)(input, init);

  const context = {
    disabled: createDisabledService({ variables } as Service.Context<DisabledWhatsappService>),
    meta: createMetaService({ variables } as Service.Context<MetaWhatsappService>, fetchLazily),
    evolution: createEvolutionService({ variables } as Service.Context<EvolutionWhatsappService>, fetchLazily),
    get file() {
      return createFileService({ variables } as Service.Context<FileWhatsappService>);
    },
    get whap() {
      return createWhapService({ variables } as Service.Context<WhapWhatsappService>, fetchLazily);
    }
  };

  return createService(context as Service.Context<WhatsappService>);
};
