import { chargeDateText, dayMonth, PaymentProvider } from '@receivy/common';
import { buttonRow, chargeRow, emailDocument, linkRow, noticeRow } from '../../common/services/email/layout';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../public/services/capability';
import { shortLinkUrl } from '../../public/services/links';

/** Declared here, not in `send.ts`, so rendering never imports the sender back (a runtime cycle). */
export const enum NoticeTemplate {
  Initial = 'initial',
  Reminder = 'reminder',
  Manual = 'manual'
}

const CLOSING = 'Se já pagou, envie o comprovante para revisão. O Receivy não movimenta dinheiro.';

/** The footnote changes with how the charge is paid: a checkout link per provider, or a direct Pix key. */
function footnoteOf(provider?: PaymentProvider): string {
  if (provider === PaymentProvider.InfinitePay) {
    return 'O pagamento acontece pelo link da InfinitePay de quem cobra.';
  }

  if (provider === PaymentProvider.PagSeguro) {
    return 'O pagamento acontece pelo link do PagBank de quem cobra.';
  }

  return 'O pagamento acontece direto entre vocês, pela chave Pix de quem cobra.';
}

export interface RenderInputs {
  email?: string;
  name: string;
  description: string;
  cents: number;
  dueDate: string;
  publicId: string;
  expires: number;
  /** The link's short code: the text versions print `/p/<code>` instead of the long signed url. */
  shortCode?: string;
  origin: string;
  from: string;
  /** A conta a pagar reminding its own owner: no public link, no "you received a charge" framing. */
  self?: boolean;
  /** Changes the footnote: a checkout-provider charge (InfinitePay, PagBank) is paid through its checkout link, not Pix directly. */
  provider?: PaymentProvider;
  /** Where the recipient stops receiving charge notices by e-mail; absent on the owner's own copy. */
  optOutUrl?: string;
}

/**
 * One notice, three shapes: the subject titles the push, the text is the mail alternative every
 * client can read, and the HTML is what a mail client renders. A conta a pagar reminding its own
 * owner never leaves as e-mail, so it renders no HTML.
 */
export function renderNotice(input: RenderInputs, template: NoticeTemplate, secret: string) {
  const amount = `${Math.floor(input.cents / 100)},${String(input.cents % 100).padStart(2, '0')}`;
  const due = chargeDateText(input.dueDate);

  if (input.self) {
    const subject = 'Lembrete da sua conta no Receivy';
    const text = `Sua conta «${input.description}» de R$ ${amount} vence em ${due}.\nAbra o Receivy para pagar e marcar como paga.`;

    return { subject, text, url: '', token: '' };
  }

  const token = issuePublicChargeToken({
    publicId: input.publicId,
    expiresAtSeconds: input.expires,
    secret,
    purpose: PublicTokenPurpose.Charge
  });

  // The push opens the app by the signed url and the Meta button is registered as `/pay/{{1}}`, so both
  // keep the token; what people read (the mail text, a free-text WhatsApp) gets the short link.
  const url = `${input.origin}/pay/${token}`;
  const readable = input.shortCode ? shortLinkUrl(input.origin, input.shortCode) : url;
  const initial = template === NoticeTemplate.Initial;
  const subject = initial ? 'Uma nova cobrança no Receivy' : 'Lembrete de cobrança no Receivy';
  const opening = `${input.name}, ${initial ? 'você recebeu uma cobrança' : 'há uma cobrança pendente'} de R$ ${amount}, com vencimento em ${due}.`;
  const optOut = input.optOutUrl ? `\nPara parar de receber avisos de cobrança do Receivy: ${input.optOutUrl}` : '';
  const text = `${opening}\n${input.description}\nConfira os detalhes: ${readable}\n${CLOSING}${optOut}`;

  const html = emailDocument({
    eyebrow: initial ? 'Nova cobrança' : 'Lembrete de pagamento',
    heading: opening,
    lead: initial ? 'Abra o link para ver os detalhes e pagar.' : 'Nada mudou desde o último aviso. O link de pagamento continua o mesmo.',
    body: [
      chargeRow(input.description, `R$ ${amount}`, due),
      buttonRow(url, 'Confira os detalhes'),
      noticeRow(CLOSING),
      ...(input.optOutUrl ? [linkRow(input.optOutUrl, 'Parar de receber avisos de cobrança')] : [])
    ].join(''),
    footnote: footnoteOf(input.provider),
    preheader: opening
  });

  return { subject, text, html, url, token, optOutUrl: input.optOutUrl };
}

/** One person on a group notice: their name as the owner knows them, what they owe and their short link. */
export type GroupNoticeLine = { name: string; cents: number; url: string };

export type GroupNoticeInput = { description: string; dueDate: string; lines: GroupNoticeLine[] };

function brl(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString('pt-BR');

  return `R$ ${whole},${String(cents % 100).padStart(2, '0')}`;
}

/**
 * The message a WhatsApp group reads for one due date: a single person owing gets one line and their
 * link; several get a list, one link each. Nobody who owes nothing ever shows up.
 */
export function renderGroupNotice(input: GroupNoticeInput, template: NoticeTemplate): string {
  const lines = input.lines.filter((line) => line.cents > 0);
  const opening = template === NoticeTemplate.Initial ? 'Nova cobrança' : 'Lembrete';
  const due = dayMonth(input.dueDate);

  if (lines.length === 1) {
    const [line] = lines;

    return `${opening} · ${input.description}: ${brl(line!.cents)} vence em ${due}.\nPague em ${line!.url}`;
  }

  const list = lines.map((line) => `• ${line.name} ${brl(line.cents)} ${line.url}`).join('\n');

  return `${opening} · ${input.description} vence em ${due}:\n${list}`;
}

/** The manual reminder in a group names who it is for: everyone else in the group reads it too. */
export function renderGroupReminder(input: { description: string; line: GroupNoticeLine }): string {
  return `${input.line.name}, falta ${brl(input.line.cents)} de ${input.description}: ${input.line.url}`;
}
