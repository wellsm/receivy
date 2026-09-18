import { chargeDateText, PaymentProvider } from '@receivy/common';
import { buttonRow, chargeRow, emailDocument, noticeRow } from '../../common/services/email/layout';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../public/services/capability';

/** Declared here, not in `send.ts`, so rendering never imports the sender back (a runtime cycle). */
export const enum NoticeTemplate {
  Initial = 'initial',
  Reminder = 'reminder',
  Manual = 'manual'
}

const CLOSING = 'Se já pagou, envie o comprovante para revisão. O Receivy não movimenta dinheiro.';

export interface RenderInputs {
  email?: string;
  name: string;
  description: string;
  cents: number;
  dueDate: string;
  publicId: string;
  expires: number;
  origin: string;
  from: string;
  /** A conta a pagar reminding its own owner: no public link, no "you received a charge" framing. */
  self?: boolean;
  /** Changes the footnote: an InfinitePay charge is paid through its checkout link, not Pix directly. */
  provider?: PaymentProvider;
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

    return { subject, text, url: '' };
  }

  const token = issuePublicChargeToken({
    publicId: input.publicId,
    expiresAtSeconds: input.expires,
    secret,
    purpose: PublicTokenPurpose.Charge
  });

  const url = `${input.origin}/pay/${token}`;
  const initial = template === NoticeTemplate.Initial;
  const subject = initial ? 'Uma nova cobrança no Receivy' : 'Lembrete de cobrança no Receivy';
  const opening = `${input.name}, ${initial ? 'você recebeu uma cobrança' : 'há uma cobrança pendente'} de R$ ${amount}, com vencimento em ${due}.`;
  const text = `${opening}\n${input.description}\nConfira os detalhes: ${url}\n${CLOSING}`;

  const html = emailDocument({
    eyebrow: initial ? 'Nova cobrança' : 'Lembrete de pagamento',
    heading: opening,
    lead: initial ? 'Abra o link para ver os detalhes e pagar.' : 'Nada mudou desde o último aviso. O link de pagamento continua o mesmo.',
    body: [chargeRow(input.description, `R$ ${amount}`, due), buttonRow(url, 'Confira os detalhes'), noticeRow(CLOSING)].join(''),
    footnote:
      input.provider === PaymentProvider.InfinitePay
        ? 'O pagamento acontece pelo link da InfinitePay de quem cobra.'
        : 'O pagamento acontece direto entre vocês, pela chave Pix de quem cobra.',
    preheader: opening
  });

  return { subject, text, html, url };
}
