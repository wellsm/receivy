import { describe, expect, it } from 'vitest';
import { NoticeTemplate, type RenderInputs, renderNotice } from './render';

const input: RenderInputs = {
  email: 'fixture@example.com',
  name: 'Fixture',
  description: 'Serviço prestado',
  cents: 12345,
  dueDate: '2026-09-20',
  publicId: 'public-id',
  expires: 1893456000,
  origin: 'https://receivy.app',
  from: 'Receivy <test@example.com>'
};

describe('renderNotice', () => {
  it('writes the due date the Brazilian way, not the stored ISO day', () => {
    const notice = renderNotice(input, NoticeTemplate.Initial, 'fixture-secret');
    expect(notice.text).toContain('com vencimento em 20/09/2026');
    expect(notice.text).not.toContain('2026-09-20');
  });

  it('ships an HTML alternative that repeats the text and the same payment link', () => {
    const notice = renderNotice(input, NoticeTemplate.Initial, 'fixture-secret');

    expect(notice.html?.startsWith('<!doctype html>')).toBe(true);
    expect(notice.html).toContain('Serviço prestado');
    expect(notice.html).toContain('R$ 123,45');
    expect(notice.html).toContain('20/09/2026');
    expect(notice.html).toContain(notice.url);
    expect(notice.html).toContain('O Receivy não movimenta dinheiro.');
  });

  it('escapes the description instead of letting it close a tag', () => {
    const notice = renderNotice({ ...input, description: 'Pizza <b>&</b> refri' }, NoticeTemplate.Initial, 'fixture-secret');

    expect(notice.html).toContain('Pizza &lt;b&gt;&amp;&lt;/b&gt; refri');
    expect(notice.html).not.toContain('<b>');
    expect(notice.text).toContain('Pizza <b>&</b> refri');
  });

  it('renders manual exactly like reminder', () => {
    const secret = 'fixture-secret';
    const reminder = renderNotice(input, NoticeTemplate.Reminder, secret);
    const manual = renderNotice(input, NoticeTemplate.Manual, secret);
    expect(manual.subject).toBe(reminder.subject);
    expect(manual.text).toBe(reminder.text);
    expect(manual.html).toBe(reminder.html);
    expect(manual.url).toBe(reminder.url);
  });
});

describe('renderNotice for the owner of a conta a pagar', () => {
  it('speaks to the owner about their own bill and issues no public link', () => {
    const notice = renderNotice({ ...input, email: undefined, self: true }, NoticeTemplate.Reminder, 'fixture-secret');
    expect(notice.subject).toBe('Lembrete da sua conta no Receivy');
    expect(notice.text).toContain('Sua conta «Serviço prestado» de R$ 123,45 vence em 20/09/2026');
    expect(notice.text).not.toContain('/pay/');
    expect(notice.url).toBe('');
    // It only ever leaves as a push, so there is no HTML body to render.
    expect(notice.html).toBeUndefined();
  });
});
