import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Service } from '@ez4/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmailClient } from './compose';
import type { EmailService } from './service';
import { createService } from './service';

const message = {
  from: 'Receivy <login@receivy.local>',
  to: 'ana@example.com',
  subject: 'Seu código de acesso ao Receivy',
  text: 'Seu código de acesso é 123456.'
};

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createTempDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'receivy-emails-'));

  directories.push(directory);

  return directory;
};

describe('email factory service', () => {
  it('dispatches to the vendor named by the transport', async () => {
    const send = vi.fn().mockResolvedValue({ status: 'accepted', id: 'vendor-1' });

    const client = createService({
      disabled: { send: vi.fn() },
      file: { send: vi.fn() },
      resend: { send }
    } as unknown as Service.Context<EmailService>);

    expect(await client.send('resend', message)).toEqual({ status: 'accepted', id: 'vendor-1' });
    expect(send).toHaveBeenCalledWith(message);
  });

  it('refuses an unknown transport instead of guessing a vendor', () => {
    const client = createService({} as Service.Context<EmailService>);

    expect(() => client.send('smtp' as never, message)).toThrow(/Unknown email transport/);
  });

  it('drops mail silently on the disabled vendor', async () => {
    const client = createEmailClient({ APP_STAGE: 'local' });

    expect(await client.send('disabled', message)).toEqual({ status: 'disabled' });
  });

  it('writes an .eml file on the file vendor, only for the local stage', async () => {
    const directory = createTempDirectory();
    const client = createEmailClient({ APP_STAGE: 'local', EMAIL_FILE_DIRECTORY: directory });

    const result = await client.send('file', { ...message, key: 'delivery-1' });

    expect(result.status).toBe('accepted');

    const [file] = readdirSync(directory);
    const content = readFileSync(join(directory, file!), 'utf8');

    expect(file).toMatch(/^\d{4}-\d{2}-\d{2}T.*-seu-codigo-de-acesso-ao-receivy-[a-f0-9]{6}\.eml$/);
    expect(content).toContain('To: ana@example.com');
    expect(content).toContain('Subject: Seu código de acesso ao Receivy');
    expect(content).toContain('X-Receivy-Key: delivery-1');
    expect(content.endsWith('Seu código de acesso é 123456.\n')).toBe(true);

    for (const stage of ['dev', 'prd', 'test', undefined]) {
      const remote = createEmailClient({ APP_STAGE: stage, EMAIL_FILE_DIRECTORY: directory });

      expect(() => remote.send('file', message)).toThrow(/APP_STAGE=local/);
    }
  });

  it('maps Resend outcomes without exposing provider bodies', async () => {
    const outcomes: [Response, string][] = [
      [Response.json({ id: 'abc' }), 'accepted'],
      [Response.json({}), 'uncertain'],
      [new Response('rate limited', { status: 429 }), 'transient'],
      [new Response('bad request detail', { status: 422 }), 'permanent']
    ];

    for (const [response, status] of outcomes) {
      const client = createEmailClient({ APP_STAGE: 'dev', RESEND_API_KEY: 'key' }, vi.fn().mockResolvedValue(response));

      expect((await client.send('resend', message)).status).toBe(status);
    }

    const offline = createEmailClient({ APP_STAGE: 'dev', RESEND_API_KEY: 'key' }, vi.fn().mockRejectedValue(new Error('offline')));

    expect(await offline.send('resend', message)).toEqual({ status: 'uncertain' });

    const unconfigured = createEmailClient({ APP_STAGE: 'dev', RESEND_API_KEY: 'disabled' }, vi.fn());

    expect(await unconfigured.send('resend', message)).toEqual({ status: 'permanent' });
  });

  it('sends the idempotency key and the authorization header to Resend without logging', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ id: 'email-1' }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = createEmailClient({ APP_STAGE: 'dev', RESEND_API_KEY: 'resend-key' }, request);

    await client.send('resend', { ...message, key: 'stable-key' });

    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('https://api.resend.com/emails');
    expect(headers.Authorization).toBe('Bearer resend-key');
    expect(headers['Idempotency-Key']).toBe('stable-key');
    expect(JSON.parse(String(init.body))).toMatchObject({ from: message.from, to: [message.to] });
    expect(log).not.toHaveBeenCalled();

    log.mockRestore();
  });
});
