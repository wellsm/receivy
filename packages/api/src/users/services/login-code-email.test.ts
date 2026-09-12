import { describe, expect, it, vi } from 'vitest';
import type { EmailClient } from '../../common/services/email/client';

import { createLoginCodeMailer } from './login-code-email';

const createClient = (status: string): EmailClient => {
  return { send: vi.fn().mockResolvedValue({ status, id: 'email-1' }) };
};

describe('login code mailer', () => {
  it('sends the code through the configured transport with the sender address', async () => {
    const client = createClient('accepted');
    const mailer = createLoginCodeMailer(client, 'resend', 'Receivy <login@example.com>');

    await mailer.sendLoginCode({ email: 'ana@example.com', code: '123456' });

    expect(client.send).toHaveBeenCalledWith('resend', {
      from: 'Receivy <login@example.com>',
      to: 'ana@example.com',
      subject: 'Seu código de acesso ao Receivy',
      text: 'Seu código de acesso é 123456. Ele expira em 10 minutos.',
      html: expect.any(String)
    });
  });

  it('carries an HTML alternative holding the same code', async () => {
    const client = createClient('accepted');
    const mailer = createLoginCodeMailer(client, 'resend', 'Receivy <login@example.com>');

    await mailer.sendLoginCode({ email: 'ana@example.com', code: '481502' });

    const [, message] = (client.send as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { html: string; text: string }];

    expect(message.html).toContain('481502');
    expect(message.html).toContain('Expira em 10 minutos');
    // The preheader is the text alternative, so both parts always say the same thing.
    expect(message.html).toContain(message.text);
    expect(message.html.startsWith('<!doctype html>')).toBe(true);
  });

  it('treats disabled as delivered and every failure as an error', async () => {
    const disabled = createLoginCodeMailer(createClient('disabled'), 'disabled', 'disabled');

    await expect(disabled.sendLoginCode({ email: 'ana@example.com', code: '123456' })).resolves.toBeUndefined();

    for (const status of ['transient', 'permanent', 'uncertain']) {
      const failing = createLoginCodeMailer(createClient(status), 'resend', 'Receivy <login@example.com>');

      await expect(failing.sendLoginCode({ email: 'ana@example.com', code: '123456' })).rejects.toThrow('Email delivery failed');
    }
  });
});
