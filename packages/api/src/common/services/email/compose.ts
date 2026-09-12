import type { Service } from '@ez4/common';
import type { MailpitEmailService } from '../../../vendors/mailpit/service';
import { createService as createMailpitService } from '../../../vendors/mailpit/service';
import type { ResendEmailService } from '../../../vendors/resend/service';
import { createService as createResendService } from '../../../vendors/resend/service';
import type { EmailClient } from './client';
import type { EmailService } from './service';
import { createService } from './service';
import type { DisabledEmailService } from './transports/disabled';
import { createService as createDisabledService } from './transports/disabled';
import type { FileEmailService } from './transports/file';
import { createService as createFileService } from './transports/file';

export type EmailEnvironment = {
  APP_STAGE?: string;
  RESEND_API_KEY?: string;
  EMAIL_FILE_DIRECTORY?: string;
  MAILPIT_API_URL?: string;
};

/**
 * Builds the email client outside the EZ4 runtime (tests, scripts) from the same
 * vendor services the factory links in production. The `file` and `mailpit` vendors
 * are only constructed when the stage allows them, mirroring their fail-closed guards.
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
    },
    get mailpit() {
      return createMailpitService({ variables } as Service.Context<MailpitEmailService>, fetchLazily);
    }
  };

  return createService(context as Service.Context<EmailService>);
};
