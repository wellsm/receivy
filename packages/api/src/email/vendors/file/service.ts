import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { EmailInputs, EmailProvider } from '../../client';

/**
 * EZ4 keeps its local state under `.ez4/`, so local mail lands in `.ez4/emails/`.
 */
export const DEFAULT_EMAIL_FILE_DIRECTORY = '.ez4/emails';

/**
 * Local development only: writes each message as an `.eml` file instead of sending it.
 */
export declare class FileEmailService extends Factory.Service<EmailProvider> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    EMAIL_FILE_DIRECTORY: Environment.VariableOrValue<'EMAIL_FILE_DIRECTORY', '.ez4/emails'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService(context: Service.Context<FileEmailService>): EmailProvider {
  const { APP_STAGE, EMAIL_FILE_DIRECTORY } = context.variables;

  if (APP_STAGE !== 'local') {
    throw new Error(`Email transport 'file' is only allowed when APP_STAGE=local.`);
  }

  const directory = resolve(process.cwd(), EMAIL_FILE_DIRECTORY ?? DEFAULT_EMAIL_FILE_DIRECTORY);

  return {
    send: async (message: EmailInputs.Message) => {
      const id = getFileName(message.subject);

      try {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, id), renderMessage(message), { encoding: 'utf8', flag: 'wx' });

        return { status: 'accepted', id };
      } catch {
        return { status: 'transient' };
      }
    }
  };
}

const getFileName = (subject: string) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(3).toString('hex');
  const slug = getSlug(subject) || 'email';

  return `${stamp}-${slug}-${suffix}.eml`;
};

const getSlug = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
};

const renderMessage = (message: EmailInputs.Message) => {
  const headers = [`From: ${message.from}`, `To: ${message.to}`, `Subject: ${message.subject}`, `Date: ${new Date().toUTCString()}`];

  if (message.key) {
    headers.push(`X-Receivy-Key: ${message.key}`);
  }

  return [...headers, '', message.text, ''].join('\n');
};
