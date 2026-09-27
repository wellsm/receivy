import { BillingDueRule, BillingFrequency, BillingRecurrence } from './billing';
import type { BillingDraft } from './billing-draft';
import { untilInstallmentPreview } from './billing-draft';
import { shiftDays } from './calendar-labels';
import { Direction, SplitMode } from './contracts';
import { formatMoney } from './money';
import type { ReminderRule } from './reminders';

/** One participant as the review copy names them: `amountCents` is what the split gives them. */
export type SplitLine = { name: string; amountCents: number; owner?: boolean };

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const FREQUENCY_LABELS: Record<BillingFrequency, string> = { monthly: 'Mensal', yearly: 'Anual' };

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: 'BRL' });
}

/** `R$ 21,56` without the currency sign, for lines that already say it is money. */
function bare(amountCents: number): string {
  return money(amountCents).replace(/[^\d,.]/g, '');
}

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

/** `25/set` for a calendar date (`YYYY-MM-DD`), the way the review rows abbreviate a date. */
export function dayMonth(iso: string): string {
  const month = Number(iso.slice(5, 7));

  return `${iso.slice(8, 10)}/${MONTHS[month - 1] ?? ''}`;
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** "Ed e Gustavo", "Ed, Gustavo e Eu". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }

  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** The review row of step 1: "Mensal · próximo 25/set", "À vista · 25/set", "Parcelado · 3x · 25/set". */
export function repetitionLabel(draft: BillingDraft): string {
  const date = isDate(draft.start) ? dayMonth(draft.start) : '—';

  if (draft.type === BillingRecurrence.Once) {
    return `À vista · ${date}`;
  }

  if (draft.type === BillingRecurrence.Until) {
    const count = untilInstallmentPreview(draft)?.count;

    return count ? `Parcelado · ${count}x · 1ª em ${date}` : `Parcelado · 1ª em ${date}`;
  }

  return `${FREQUENCY_LABELS[draft.frequency]} · próximo ${date}`;
}

/** The sentence under the schedule fields: what the picked repetition does with the due date. */
export function scheduleHint(draft: BillingDraft): string {
  if (!isDate(draft.start)) {
    return '';
  }

  if (draft.type === BillingRecurrence.Once) {
    return `Vence em ${dayMonth(draft.start)}.`;
  }

  if (draft.type === BillingRecurrence.Until) {
    const preview = untilInstallmentPreview(draft);

    if (!preview) {
      return '';
    }

    const last = draft.end || (preview.count > 1 ? shiftMonths(draft.start, preview.count - 1) : draft.start);

    return `${preview.count} parcelas de ${money(preview.perInstallmentCents)}, última em ${dayMonth(last)}.`;
  }

  if (draft.frequency === BillingFrequency.Yearly) {
    return `Todo ano em ${dayMonth(draft.start)}, sem data de fim.`;
  }

  if (draft.dueRule === BillingDueRule.EndOfMonth) {
    return 'Todo fim de mês, sem data de fim.';
  }

  return `Todo dia ${dayOf(draft.start)}, sem data de fim.`;
}

/** Same calendar day `months` ahead, clamped to the month end, read in UTC so the day never shifts. */
function shiftMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, month! - 1 + months + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year!, month! - 1 + months, Math.min(day!, lastDay))).toISOString().slice(0, 10);
}

/** The subtitle of the review card: "A receber · mensal · dia 25", "A pagar · à vista · 25/set". */
export function directionLine(draft: BillingDraft): string {
  const direction = draft.direction === Direction.Payable ? 'A pagar' : 'A receber';

  if (draft.settled) {
    return `${direction} · ${draft.direction === Direction.Payable ? 'já pago' : 'já recebido'}`;
  }

  if (!isDate(draft.start)) {
    return direction;
  }

  if (draft.type === BillingRecurrence.Once) {
    return `${direction} · à vista · ${dayMonth(draft.start)}`;
  }

  if (draft.type === BillingRecurrence.Until) {
    return `${direction} · parcelado · dia ${dayOf(draft.start)}`;
  }

  if (draft.frequency === BillingFrequency.Yearly) {
    return `${direction} · anual · ${dayMonth(draft.start)}`;
  }

  return `${direction} · mensal · ${draft.dueRule === BillingDueRule.EndOfMonth ? 'fim do mês' : `dia ${dayOf(draft.start)}`}`;
}

/** What the mode tab shows beside its name: the shares in play, the percent typed, nothing otherwise. */
export function splitModeBadge(draft: BillingDraft, keys: string[]): string | null {
  if (draft.mode === SplitMode.Shares) {
    return String(keys.reduce((sum, key) => sum + (Number(draft.values.shares[key]) || 1), 0));
  }

  if (draft.mode === SplitMode.Percentage) {
    const percent = keys.reduce((sum, key) => sum + (Number((draft.values.percentage[key] ?? '').replace(',', '.')) || 0), 0);

    return String(Math.round(percent * 100) / 100).replace('.', ',');
  }

  return null;
}

/** The review row of step 2 in short: "3 pessoas · 5 cotas", "2 pessoas · iguais". */
export function splitCountLabel(draft: BillingDraft, keys: string[]): string {
  const people = keys.length;
  const count = `${people} pessoa${people === 1 ? '' : 's'}`;

  if (draft.mode === SplitMode.Shares) {
    const shares = splitModeBadge(draft, keys);

    return `${count} · ${shares} cota${shares === '1' ? '' : 's'}`;
  }

  if (draft.mode === SplitMode.Percentage) {
    return `${count} · por %`;
  }

  if (draft.mode === SplitMode.Fixed) {
    return `${count} · valores fixos`;
  }

  return `${count} · iguais`;
}

/** The review row of step 2 in full: "Ed 21,56 · Gustavo 10,78 · Eu 21,56". */
export function splitSummaryLine(lines: SplitLine[]): string {
  return lines.map((line) => `${line.name} ${bare(line.amountCents)}`).join(' · ');
}

/** The line under the split rows: "5 cotas · R$ 10,78 cada", "R$ 17,97 cada", "40% + 19% + 40%". */
export function splitFooterLine(draft: BillingDraft, keys: string[], amounts: Record<string, number>): string {
  const values = keys.map((key) => amounts[key]).filter((cents): cents is number => cents !== undefined);

  if (!values.length) {
    return '';
  }

  if (draft.mode === SplitMode.Shares) {
    const shares = Number(splitModeBadge(draft, keys));
    const total = values.reduce((sum, cents) => sum + cents, 0);

    return shares ? `${shares} cota${shares === 1 ? '' : 's'} · ${money(Math.floor(total / shares))} cada` : '';
  }

  if (draft.mode === SplitMode.Equal) {
    return `${money(values[0]!)} cada`;
  }

  return `${keys.length} pessoa${keys.length === 1 ? '' : 's'}`;
}

/**
 * The summary box of the edit screen and the third web column: "Você recebe R$ 21,56 de Ed e R$ 10,78
 * de Gustavo todo dia 25. Sua parte, R$ 21,56, fica com você." A conta a pagar names who receives it.
 */
export function receiptSentence(draft: BillingDraft, lines: SplitLine[], counterpart: string | null): string {
  const when = cadence(draft);

  if (draft.direction === Direction.Payable) {
    const total = lines.reduce((sum, line) => sum + line.amountCents, 0);

    if (!total) {
      return '';
    }

    return `Você paga ${money(total)}${counterpart ? ` a ${counterpart}` : ''}${when}.`;
  }

  const others = lines.filter((line) => !line.owner && line.amountCents > 0);
  const own = lines.find((line) => line.owner);

  if (!others.length) {
    return '';
  }

  const parts = others.map((line) => `${money(line.amountCents)} de ${line.name}`);
  const receive = `Você recebe ${joinNames(parts)}${when}.`;

  if (!own || own.amountCents <= 0) {
    return receive;
  }

  return `${receive} Sua parte, ${money(own.amountCents)}, fica com você.`;
}

/** " todo dia 25", " todo fim de mês", " em 25/set", " a cada parcela". */
function cadence(draft: BillingDraft): string {
  if (!isDate(draft.start)) {
    return '';
  }

  if (draft.type === BillingRecurrence.Once) {
    return ` em ${dayMonth(draft.start)}`;
  }

  if (draft.type === BillingRecurrence.Until) {
    return ' por parcela';
  }

  if (draft.frequency === BillingFrequency.Yearly) {
    return ` todo ano em ${dayMonth(draft.start)}`;
  }

  return draft.dueRule === BillingDueRule.EndOfMonth ? ' todo fim de mês' : ` todo dia ${dayOf(draft.start)}`;
}

/** The calendar date of the first automatic notice for `dueDate`, or null when no rule is on. */
export function firstNoticeDate(dueDate: string, reminders: ReminderRule[]): string | null {
  const offsets = reminders.filter((rule) => rule.enabled).map((rule) => rule.offsetDays);

  if (!offsets.length || !isDate(dueDate)) {
    return null;
  }

  return shiftDays(dueDate, Math.min(...offsets));
}

/** "Ed e Gustavo recebem o primeiro aviso em 22/set, com o link para pagar." */
export function firstNoticeSentence(names: string[], noticeDate: string | null, withLink: boolean): string {
  if (!names.length || !noticeDate) {
    return '';
  }

  const verb = names.length === 1 ? 'recebe' : 'recebem';
  const link = withLink ? ', com o link para pagar' : '';

  return `${joinNames(names)} ${verb} o primeiro aviso em ${dayMonth(noticeDate)}${link}.`;
}

/** The one-line reminder row: "Padrão · no dia, por e-mail" or "Personalizado · 3 avisos". */
export function reminderRowLabel(inherited: boolean, rules: ReminderRule[], summary: string): string {
  const enabled = rules.filter((rule) => rule.enabled).length;

  if (!inherited) {
    return `Personalizado · ${enabled} aviso${enabled === 1 ? '' : 's'}`;
  }

  return enabled <= 1 ? `Padrão · ${summary}` : `Padrão · ${enabled} avisos`;
}

/** Under the split when a group is picked: why the bells went quiet and who sees what. */
export function groupNoticeNote(name: string): string {
  return `O aviso vai pelo grupo ${name}. Todos no grupo veem o valor de cada pessoa.`;
}

/** The review line of a billing notified in a group. */
export function groupFirstNoticeSentence(name: string, noticeDate: string | null): string {
  if (!noticeDate) {
    return '';
  }

  return `O grupo ${name} recebe o primeiro aviso em ${dayMonth(noticeDate)}, com o link de cada pessoa.`;
}

/** The subtitle of a group in the picker. */
export function groupSizeLabel(size: number): string {
  return `${size} participante${size === 1 ? '' : 's'}`;
}
