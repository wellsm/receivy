import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type Environment, Runtime, type Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappInputs, WhatsappProvider } from '../client';

export const DEFAULT_WHATSAPP_FILE_DIRECTORY = '.ez4/whatsapp';

/** Local development only: writes each message as a JSON file instead of sending it. */
export declare class FileWhatsappService extends Factory.Service<WhatsappProvider> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    WHATSAPP_FILE_DIRECTORY: Environment.VariableOrValue<'WHATSAPP_FILE_DIRECTORY', '.ez4/whatsapp'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

export function createService({ variables }: Service.Context<FileWhatsappService>): WhatsappProvider {
  const { APP_STAGE, WHATSAPP_FILE_DIRECTORY } = variables;

  if (APP_STAGE !== 'dev' && Runtime.isLocal()) {
    throw new Error(`WhatsApp transport 'file' is only allowed when APP_STAGE=dev and local.`);
  }

  const directory = resolve(process.cwd(), WHATSAPP_FILE_DIRECTORY ?? DEFAULT_WHATSAPP_FILE_DIRECTORY);

  return {
    send: async (message: WhatsappInputs.Message) => {
      const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${message.key.replace(/[^a-z0-9]+/gi, '-')}.json`;
      const body = { to: message.to, key: message.key, template: message.template, text: message.text };

      try {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, id), JSON.stringify(body, null, 2), { encoding: 'utf8', flag: 'wx' });

        return { status: 'accepted', id };
      } catch {
        return { status: 'transient' };
      }
    }
  };
}
