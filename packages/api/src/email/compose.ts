import type { Service } from '@ez4/common';
import type { EmailClient } from './client';
import type { EmailService } from './service';
import { createService } from './service';
import type { DisabledEmailService } from './vendors/disabled/service';
import { createService as createDisabledService } from './vendors/disabled/service';
import type { FileEmailService } from './vendors/file/service';
import { createService as createFileService } from './vendors/file/service';
import type { ResendEmailService } from './vendors/resend/service';
import { createService as createResendService } from './vendors/resend/service';

export type EmailEnvironment = {
  APP_STAGE?: string;
  RESEND_API_KEY?: string;
  EMAIL_FILE_DIRECTORY?: string;
};

/**
 * Builds the email client outside the EZ4 runtime (tests, scripts) from the same
 * vendor services the factory links in production. The `file` vendor is only
 * constructed when the stage is local, mirroring its fail-closed guard.
 */
export const createEmailClient = (env: EmailEnvironment, request?: typeof fetch): EmailClient => {
  const variables = { ...env };

  // Resolved per call so test doubles installed on globalThis after composition still apply.
  const fetchLazily: typeof fetch = (input, init) => (request ?? globalThis.fetch)(input, init);

  const context = {
    disabled: createDisabledService({ variables } as Service.Context<DisabledEmailService>),
    resend: createResendService({ variables } as Service.Context<ResendEmailService>, fetchLazily),
    get file() {
      return createFileService({ variables } as Service.Context<FileEmailService>);
    }
  };

  return createService(context as Service.Context<EmailService>);
};
