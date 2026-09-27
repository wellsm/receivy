import { describe, expect, it } from 'vitest';
import { BillingDueRule, BillingFrequency, BillingRecurrence } from './billing';
import {
  dayMonth,
  directionLine,
  firstNoticeDate,
  firstNoticeSentence,
  joinNames,
  receiptSentence,
  reminderRowLabel,
  repetitionLabel,
  scheduleHint,
  splitCountLabel,
  splitFooterLine,
  splitModeBadge,
  splitSummaryLine
} from './billing-copy';
import { type BillingDraft, EMPTY_BILLING_DRAFT } from './billing-draft';
import { Direction, SplitMode } from './contracts';

/** `formatMoney` puts a no-break space after the sign. */
function nb(text: string): string {
  return text.replace(/R\$ /g, 'R$\u00a0');
}

const base: BillingDraft = {
  ...EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-25'),
  selected: ['u1', 'u2'],
  amount: '53,90',
  description: 'Youtube Premium',
  type: BillingRecurrence.Indefinite,
  frequency: BillingFrequency.Monthly
};

const keys = ['u1', 'u2', 'owner'];
const lines = [
  { name: 'Ed', amountCents: 2156 },
  { name: 'Gustavo', amountCents: 1078 },
  { name: 'Eu', amountCents: 2156, owner: true }
];

describe('billing copy', () => {
  it('abbreviates a date as day/month', () => {
    expect(dayMonth('2026-09-25')).toBe('25/set');
    expect(dayMonth('2026-01-05')).toBe('05/jan');
  });

  it('joins names the Portuguese way', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Ed'])).toBe('Ed');
    expect(joinNames(['Ed', 'Gustavo'])).toBe('Ed e Gustavo');
    expect(joinNames(['Ed', 'Gustavo', 'Eu'])).toBe('Ed, Gustavo e Eu');
  });

  it('labels the repetition row by type', () => {
    expect(repetitionLabel(base)).toBe('Mensal · próximo 25/set');
    expect(repetitionLabel({ ...base, frequency: BillingFrequency.Yearly })).toBe('Anual · próximo 25/set');
    expect(repetitionLabel({ ...base, type: BillingRecurrence.Once })).toBe('À vista · 25/set');
    expect(repetitionLabel({ ...base, type: BillingRecurrence.Until, occurrences: '3' })).toBe('Parcelado · 3x · 1ª em 25/set');
    expect(repetitionLabel({ ...base, type: BillingRecurrence.Until })).toBe('Parcelado · 1ª em 25/set');
  });

  it('explains the schedule under the fields', () => {
    expect(scheduleHint(base)).toBe('Todo dia 25, sem data de fim.');
    expect(scheduleHint({ ...base, dueRule: BillingDueRule.EndOfMonth, start: '2026-09-30' })).toBe('Todo fim de mês, sem data de fim.');
    expect(scheduleHint({ ...base, frequency: BillingFrequency.Yearly })).toBe('Todo ano em 25/set, sem data de fim.');
    expect(scheduleHint({ ...base, type: BillingRecurrence.Once })).toBe('Vence em 25/set.');
    expect(scheduleHint({ ...base, type: BillingRecurrence.Until, occurrences: '3', amount: '100,00' })).toBe(nb('3 parcelas de R$ 33,34, última em 25/nov.'));
    expect(scheduleHint({ ...base, type: BillingRecurrence.Until })).toBe('');
    expect(scheduleHint({ ...base, start: '' })).toBe('');
  });

  it('writes the direction line of the review card', () => {
    expect(directionLine(base)).toBe('A receber · mensal · dia 25');
    expect(directionLine({ ...base, dueRule: BillingDueRule.EndOfMonth })).toBe('A receber · mensal · fim do mês');
    expect(directionLine({ ...base, direction: Direction.Payable, type: BillingRecurrence.Once })).toBe('A pagar · à vista · 25/set');
    expect(directionLine({ ...base, type: BillingRecurrence.Until })).toBe('A receber · parcelado · dia 25');
    expect(directionLine({ ...base, settled: true })).toBe('A receber · já recebido');
    expect(directionLine({ ...base, start: '' })).toBe('A receber');
  });

  it('shows the total of the mode tab', () => {
    expect(splitModeBadge({ ...base, mode: SplitMode.Shares, values: { ...base.values, shares: { u1: '2', owner: '2' } } }, keys)).toBe('5');
    expect(splitModeBadge({ ...base, mode: SplitMode.Percentage, values: { ...base.values, percentage: { u1: '40', u2: '19,5', owner: '40' } } }, keys)).toBe('99,5');
    expect(splitModeBadge(base, keys)).toBeNull();
  });

  it('counts people and shares for the short split row', () => {
    expect(splitCountLabel(base, keys)).toBe('3 pessoas · iguais');
    expect(splitCountLabel({ ...base, mode: SplitMode.Shares, values: { ...base.values, shares: { u1: '2', owner: '2' } } }, keys)).toBe('3 pessoas · 5 cotas');
    expect(splitCountLabel({ ...base, mode: SplitMode.Percentage }, ['u1'])).toBe('1 pessoa · por %');
    expect(splitCountLabel({ ...base, mode: SplitMode.Fixed }, keys)).toBe('3 pessoas · valores fixos');
  });

  it('lists every amount on the long split row', () => {
    expect(splitSummaryLine(lines)).toBe('Ed 21,56 · Gustavo 10,78 · Eu 21,56');
  });

  it('sums the split footer by mode', () => {
    const amounts = { u1: 2156, u2: 1078, owner: 2156 };

    expect(splitFooterLine({ ...base, mode: SplitMode.Shares, values: { ...base.values, shares: { u1: '2', owner: '2' } } }, keys, amounts)).toBe(nb('5 cotas · R$ 10,78 cada'));
    expect(splitFooterLine(base, keys, { u1: 1797, u2: 1797, owner: 1796 })).toBe(nb('R$ 17,97 cada'));
    expect(splitFooterLine({ ...base, mode: SplitMode.Percentage }, keys, amounts)).toBe('3 pessoas');
    expect(splitFooterLine(base, keys, {})).toBe('');
  });

  it('writes the receipt sentence with the owner part', () => {
    expect(receiptSentence(base, lines, null)).toBe(nb('Você recebe R$ 21,56 de Ed e R$ 10,78 de Gustavo todo dia 25. Sua parte, R$ 21,56, fica com você.'));
    expect(receiptSentence({ ...base, type: BillingRecurrence.Once }, lines.slice(0, 2), null)).toBe(nb('Você recebe R$ 21,56 de Ed e R$ 10,78 de Gustavo em 25/set.'));
    expect(receiptSentence({ ...base, type: BillingRecurrence.Until }, lines.slice(0, 1), null)).toBe(nb('Você recebe R$ 21,56 de Ed por parcela.'));
    expect(receiptSentence(base, [lines[2]!], null)).toBe('');
  });

  it('writes the payment sentence of a conta a pagar', () => {
    expect(receiptSentence({ ...base, direction: Direction.Payable }, [{ name: 'Eu', amountCents: 5390, owner: true }], 'Ana')).toBe(nb('Você paga R$ 53,90 a Ana todo dia 25.'));
    expect(receiptSentence({ ...base, direction: Direction.Payable }, [], 'Ana')).toBe('');
  });

  it('finds the first notice from the earliest enabled rule', () => {
    const rules = [
      { offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } },
      { offsetDays: -3, enabled: true, channels: { email: true, whatsapp: false } },
      { offsetDays: -7, enabled: false, channels: { email: true, whatsapp: false } }
    ];

    expect(firstNoticeDate('2026-09-25', rules)).toBe('2026-09-22');
    expect(firstNoticeDate('2026-09-25', [])).toBeNull();
    expect(firstNoticeDate('', rules)).toBeNull();
    expect(firstNoticeSentence(['Ed', 'Gustavo'], '2026-09-22', true)).toBe('Ed e Gustavo recebem o primeiro aviso em 22/set, com o link para pagar.');
    expect(firstNoticeSentence(['Ed'], '2026-09-22', false)).toBe('Ed recebe o primeiro aviso em 22/set.');
    expect(firstNoticeSentence([], '2026-09-22', true)).toBe('');
  });

  it('labels the reminder row', () => {
    const rule = { offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } };

    expect(reminderRowLabel(true, [rule], 'no dia (e-mail)')).toBe('Padrão · no dia (e-mail)');
    expect(reminderRowLabel(true, [rule, { ...rule, offsetDays: -3 }, { ...rule, offsetDays: 2 }], 'x')).toBe('Padrão · 3 avisos');
    expect(reminderRowLabel(false, [rule], 'x')).toBe('Personalizado · 1 aviso');
  });
});
