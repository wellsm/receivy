import { PaymentProvider } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { NoticeTemplate, type RenderInputs, renderGroupNotice, renderGroupReminder, renderNotice } from './render';

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

describe('renderNotice links', () => {
  it('prints the short link in the text and keeps the signed one for the button, the push and the template', () => {
    const notice = renderNotice({ ...input, shortCode: 'K7m2xQ9aB' }, NoticeTemplate.Reminder, 'fixture-secret');

    expect(notice.text).toContain('Confira os detalhes: https://receivy.app/p/K7m2xQ9aB');
    expect(notice.text).not.toContain('/pay/');
    expect(notice.url).toBe(`https://receivy.app/pay/${notice.token}`);
    expect(notice.token.startsWith('public-id.')).toBe(true);
    expect(notice.html).toContain(notice.url);
  });

  it('falls back to the signed url when the link has no short code', () => {
    const notice = renderNotice(input, NoticeTemplate.Initial, 'fixture-secret');

    expect(notice.text).toContain(`Confira os detalhes: ${notice.url}`);
  });
});

describe('renderNotice footnote by provider', () => {
  it('mentions the Pix key by default, with no provider set', () => {
    const notice = renderNotice(input, NoticeTemplate.Initial, 'fixture-secret');

    expect(notice.html).toContain('O pagamento acontece direto entre vocês, pela chave Pix de quem cobra.');
  });

  it('mentions the InfinitePay checkout link for an InfinitePay charge', () => {
    const notice = renderNotice({ ...input, provider: PaymentProvider.InfinitePay }, NoticeTemplate.Initial, 'fixture-secret');

    expect(notice.html).toContain('O pagamento acontece pelo link da InfinitePay de quem cobra.');
  });

  it('mentions the PagBank checkout link for a PagSeguro charge', () => {
    const notice = renderNotice({ ...input, provider: PaymentProvider.PagSeguro }, NoticeTemplate.Initial, 'fixture-secret');

    expect(notice.html).toContain('O pagamento acontece pelo link do PagBank de quem cobra.');
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

describe('group notices', () => {
  const ed = { name: 'Ed', cents: 2156, url: 'https://receivy.app/p/AAAAAAAAA' };
  const gustavo = { name: 'Gustavo', cents: 1078, url: 'https://receivy.app/p/BBBBBBBBB' };

  it('gives a single payer one line and their link', () => {
    expect(renderGroupNotice({ description: 'Creche Pet', dueDate: '2026-09-25', lines: [{ ...ed, cents: 30000 }] }, NoticeTemplate.Initial)).toBe(
      'Nova cobrança · Creche Pet: R$ 300,00 vence em 25/set.\nPague em https://receivy.app/p/AAAAAAAAA'
    );
  });

  it('lists several payers with one link each and leaves out whoever owes nothing', () => {
    const text = renderGroupNotice({ description: 'Youtube Premium', dueDate: '2026-09-25', lines: [ed, gustavo, { name: 'Eu', cents: 0, url: 'x' }] }, NoticeTemplate.Reminder);

    expect(text).toBe('Lembrete · Youtube Premium vence em 25/set:\n• Ed R$ 21,56 https://receivy.app/p/AAAAAAAAA\n• Gustavo R$ 10,78 https://receivy.app/p/BBBBBBBBB');
  });

  it('groups the thousands of a large amount', () => {
    expect(renderGroupNotice({ description: 'Aluguel', dueDate: '2026-10-05', lines: [{ ...ed, cents: 250000 }] }, NoticeTemplate.Reminder)).toContain('R$ 2.500,00');
  });

  it('names the person a manual reminder is for', () => {
    expect(renderGroupReminder({ description: 'Youtube Premium', line: gustavo })).toBe('Gustavo, falta R$ 10,78 de Youtube Premium: https://receivy.app/p/BBBBBBBBB');
  });
});

