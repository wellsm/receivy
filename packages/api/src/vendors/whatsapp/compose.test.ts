import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWhatsappClient } from './compose';

const message = {
  to: '5511999999999',
  key: 'charge-1:reminder:0',
  text: 'Olá',
  template: { name: 'receivy_charge_reminder', language: { code: 'pt_BR' as const }, components: [] }
};

describe('createWhatsappClient', () => {
  it('answers disabled without touching the network', async () => {
    const request = vi.fn<typeof fetch>();
    const client = createWhatsappClient({ APP_STAGE: 'test' }, request);

    expect(await client.send('disabled', message)).toEqual({ status: 'disabled' });
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a transport name it does not know', async () => {
    const client = createWhatsappClient({ APP_STAGE: 'test' });

    await expect(client.send('cloud', message)).rejects.toThrow("Unknown WhatsApp transport 'cloud'.");
  });

  it('refuses the file transport in production and writes the message anywhere else', async () => {
    const directory = await mkdtemp(join('/private/tmp', 'receivy-whatsapp-'));

    try {
      await expect(createWhatsappClient({ APP_STAGE: 'prd', WHATSAPP_FILE_DIRECTORY: directory }).send('file', message)).rejects.toThrow(
        "WhatsApp transport 'file' is forbidden when APP_STAGE=prd."
      );

      const result = await createWhatsappClient({ APP_STAGE: 'local', WHATSAPP_FILE_DIRECTORY: directory }).send('file', message);

      expect(result.status).toBe('accepted');
      expect(await readdir(directory)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
