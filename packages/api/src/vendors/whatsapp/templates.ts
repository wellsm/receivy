import { chargeDateText } from '@receivy/common';
import { NoticeTemplate } from '../../notifications/services/render';
import type { WhatsappTemplateComponent, WhatsappTemplatePayload, WhatsappTextParameter } from './client';

export type TemplateNames = Record<NoticeTemplate, string>;

export const DEFAULT_TEMPLATE_NAMES: TemplateNames = {
  [NoticeTemplate.Initial]: 'receivy_charge_initial',
  [NoticeTemplate.Reminder]: 'receivy_charge_reminder',
  [NoticeTemplate.Manual]: 'receivy_charge_manual'
};

export type TemplateVariables = { WHATSAPP_TEMPLATE_INITIAL?: string; WHATSAPP_TEMPLATE_REMINDER?: string; WHATSAPP_TEMPLATE_MANUAL?: string };

/** The names registered on the WABA; a new version is a variable change, not a deploy. */
export function templateNamesFrom(variables: TemplateVariables): TemplateNames {
  return {
    [NoticeTemplate.Initial]: variables.WHATSAPP_TEMPLATE_INITIAL || DEFAULT_TEMPLATE_NAMES[NoticeTemplate.Initial],
    [NoticeTemplate.Reminder]: variables.WHATSAPP_TEMPLATE_REMINDER || DEFAULT_TEMPLATE_NAMES[NoticeTemplate.Reminder],
    [NoticeTemplate.Manual]: variables.WHATSAPP_TEMPLATE_MANUAL || DEFAULT_TEMPLATE_NAMES[NoticeTemplate.Manual]
  };
}

export type ChargeTemplateInput = {
  template: NoticeTemplate;
  /** The recipient's name; only the first word goes in the message. */
  name: string;
  creditor: string;
  cents: number;
  dueDate: string;
  description: string;
  /** The signed public token: the suffix of the dynamic button `https://<web>/pay/{{1}}`. */
  token: string;
};

/** `620,00`: the amount without the currency sign, as the templates were registered. */
export function amountText(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

const text = (value: string): WhatsappTextParameter => ({ type: 'text', text: value });

/** Meta refuses newlines and more than four consecutive spaces inside a parameter. */
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

function bodyParameters(input: ChargeTemplateInput): WhatsappTextParameter[] {
  const first = clean(input.name).split(' ')[0] || 'Olá';
  const amount = amountText(input.cents);
  const due = chargeDateText(input.dueDate);
  const description = clean(input.description);

  if (input.template === NoticeTemplate.Initial) {
    return [text(first), text(amount), text(due), text(description), text(clean(input.creditor))];
  }

  if (input.template === NoticeTemplate.Manual) {
    return [text(first), text(clean(input.creditor)), text(amount), text(description), text(due)];
  }

  return [text(first), text(amount), text(due), text(description)];
}

/** One payload per notice shape, positional parameters in the order the WABA templates declare them. */
export function buildChargeTemplate(input: ChargeTemplateInput, names: TemplateNames = DEFAULT_TEMPLATE_NAMES): WhatsappTemplatePayload {
  const components: WhatsappTemplateComponent[] = [
    { type: 'body', parameters: bodyParameters(input) },
    { type: 'button', sub_type: 'url', index: '0', parameters: [text(input.token)] }
  ];

  return { name: names[input.template], language: { code: 'pt_BR' }, components };
}
