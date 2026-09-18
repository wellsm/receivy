import { describe, expect, it } from 'vitest';
import { BillingDueRule, BillingFrequency, type BillingInput, BillingKind, BillingRecurrence, DEFAULT_BILLING_REMINDERS, SplitPartKind } from './billing';
import {
  addCalendarDays,
  billingDates,
  billingDueDates,
  civilHour,
  endOfMonth,
  materializationDate,
  materializationHorizon,
  normalizeBillingInput,
  zonedInstant
} from './billing-calendar';
import { Direction, SplitMode } from './contracts';
import type { BillingSplit } from './split';

const split = { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'ana' }] } satisfies BillingSplit;

describe('billing calendar', () => {
  it('clamps monthly dates to the last day without drifting', () => {
    expect(billingDates({ frequency: BillingFrequency.Monthly, startDate: '2026-01-31' }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ]);
  });

  it('lands every month on its last day with an end_of_month rule', () => {
    expect(
      billingDates(
        { frequency: BillingFrequency.Monthly, startDate: '2026-09-30', dueRule: BillingDueRule.EndOfMonth },
        '2026-09-01',
        '2027-02-28'
      )
    ).toEqual(['2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
    expect(
      billingDates(
        { frequency: BillingFrequency.Monthly, startDate: '2028-01-31', dueRule: BillingDueRule.EndOfMonth },
        '2028-02-01',
        '2028-02-29'
      )
    ).toEqual(['2028-02-29']);
    // A fixed rule keeps the start day: the bug end_of_month fixes.
    expect(billingDates({ frequency: BillingFrequency.Monthly, startDate: '2026-09-30' }, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-30'
    ]);
  });

  it('finds the last day of a month', () => {
    expect(endOfMonth('2026-09-12')).toBe('2026-09-30');
    expect(endOfMonth('2028-02-01')).toBe('2028-02-29');
    expect(() => endOfMonth('31/01/2026')).toThrow(RangeError);
  });

  it('accepts end_of_month only on the last day of monthly or once billings', () => {
    const base = {
      recurrence: BillingRecurrence.Until,
      frequency: BillingFrequency.Monthly,
      totalCents: 1_000,
      startDate: '2026-09-30',
      endDate: '2026-11-30',
      timezone: 'America/Sao_Paulo',
      split,
      dueRule: BillingDueRule.EndOfMonth
    };

    expect(normalizeBillingInput(base).dueRule).toBe('end_of_month');
    expect(billingDueDates(base)).toEqual(['2026-09-30', '2026-10-31', '2026-11-30']);
    expect(() => normalizeBillingInput({ ...base, startDate: '2026-09-29' })).toThrow(
      'Com final do mês, o vencimento deve ser o último dia do mês.'
    );
    expect(() =>
      normalizeBillingInput({ ...base, recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Yearly, endDate: undefined })
    ).toThrow('Final do mês só vale para cobranças mensais.');
    expect(normalizeBillingInput({ ...base, recurrence: BillingRecurrence.Once, frequency: undefined, endDate: undefined }).dueRule).toBe(
      BillingDueRule.EndOfMonth
    );
  });

  it('reads day and month from the start date for yearly rules and restores leap day', () => {
    expect(billingDates({ frequency: BillingFrequency.Yearly, startDate: '2024-02-29' }, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29'
    ]);
  });

  it('honors inclusive bounds and the limit', () => {
    expect(
      billingDates({ frequency: BillingFrequency.Monthly, startDate: '2026-01-15', endDate: '2026-03-15' }, '2026-02-01', '2026-12-31')
    ).toEqual(['2026-02-15', '2026-03-15']);
    expect(billingDates({ frequency: BillingFrequency.Monthly, startDate: '2000-01-01' }, '2000-01-01', '2010-01-01', 3)).toHaveLength(3);
  });

  it('expands finite billings into due dates and caps them at 120', () => {
    expect(billingDueDates({ recurrence: BillingRecurrence.Once, startDate: '2026-05-10' })).toEqual(['2026-05-10']);
    expect(
      billingDueDates({ recurrence: BillingRecurrence.Until, frequency: BillingFrequency.Monthly, startDate: '2026-01-31', endDate: '2026-03-31' })
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(() =>
      billingDueDates({ recurrence: BillingRecurrence.Until, frequency: BillingFrequency.Monthly, startDate: '2026-01-01', endDate: '2040-01-01' })
    ).toThrow(/120/);
    expect(() => billingDueDates({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-01-01' })).toThrow(
      /sem fim/i
    );
  });

  it('materializes an occurrence on the first day of its month, or earlier for a reminder that crosses the month', () => {
    expect(
      materializationDate('2026-03-10', [
        { offsetDays: -3, enabled: true },
        { offsetDays: 2, enabled: true }
      ])
    ).toBe('2026-03-01');
    expect(materializationDate('2026-03-03', [{ offsetDays: -5, enabled: true }])).toBe('2026-02-26');
    expect(materializationDate('2026-03-10', [{ offsetDays: -3, enabled: false }])).toBe('2026-03-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('reaches the month end, or further when an early reminder needs next month charges', () => {
    expect(materializationHorizon('2026-03-05', [{ offsetDays: 0, enabled: true }])).toBe('2026-03-31');
    expect(materializationHorizon('2026-03-28', [{ offsetDays: -5, enabled: true }])).toBe('2026-04-02');
    expect(materializationHorizon('2026-03-05', [])).toBe('2026-03-31');
    expect(materializationHorizon('2026-02-10', [{ offsetDays: 3, enabled: true }])).toBe('2026-02-28');
  });

  it('normalizes input per type and rejects incompatible fields', () => {
    const once = normalizeBillingInput({
      recurrence: BillingRecurrence.Once,
      totalCents: 100,
      startDate: '2026-01-31',
      timezone: 'America/Sao_Paulo',
      split
    });

    expect(once.description).toBe('Conta');
    expect(once.frequency).toBeUndefined();
    expect(once.reminders).toBeUndefined();

    const until = normalizeBillingInput({
      recurrence: BillingRecurrence.Until,
      frequency: BillingFrequency.Monthly,
      totalCents: 100,
      startDate: '2026-01-31',
      endDate: '2026-03-31',
      timezone: 'America/Sao_Paulo',
      split,
      reminders: [
        { offsetDays: 2, enabled: true },
        { offsetDays: -3, enabled: false }
      ]
    });

    expect(until.reminders).toEqual([
      { offsetDays: -3, enabled: false },
      { offsetDays: 2, enabled: true }
    ]);
    expect(() =>
      normalizeBillingInput({ recurrence: BillingRecurrence.Until, totalCents: 100, startDate: '2026-01-31', timezone: 'UTC', split })
    ).toThrow(/frequência/i);
    expect(() =>
      normalizeBillingInput({
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        totalCents: 100,
        startDate: '2026-01-31',
        timezone: 'UTC',
        split
      })
    ).toThrow(/data final/i);
    expect(() =>
      normalizeBillingInput({
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        totalCents: 100,
        startDate: '2026-01-31',
        endDate: '2026-02-01',
        timezone: 'UTC',
        split
      })
    ).toThrow(/sem fim/i);
    expect(() =>
      normalizeBillingInput({
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        totalCents: 100,
        startDate: '2026-03-31',
        endDate: '2026-01-31',
        timezone: 'UTC',
        split
      })
    ).toThrow(/anterior/i);
    expect(() =>
      normalizeBillingInput({ recurrence: BillingRecurrence.Once, totalCents: 100, startDate: '2026-01-31', timezone: 'Mars/Olympus', split })
    ).toThrow();
    expect(() =>
      normalizeBillingInput({
        recurrence: BillingRecurrence.Once,
        totalCents: 100,
        startDate: '2026-01-31',
        timezone: 'UTC',
        split,
        reminders: [{ offsetDays: 91, enabled: true }]
      })
    ).toThrow(/lembretes/i);
  });
});

describe('registros', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const registro: BillingInput = {
    recurrence: BillingRecurrence.Once,
    totalCents: 500_000,
    startDate: '2026-08-05',
    timezone: 'America/Sao_Paulo',
    kind: BillingKind.Record,
    split
  };

  it('keeps who pays the owner and accepts a past date on a single registro', () => {
    const normalized = normalizeBillingInput(registro, now);

    expect(normalized.split).toEqual({ mode: 'equal', parts: [{ kind: 'user', userId: 'ana' }] });
    expect(normalized.type).toBe('receivable');
    expect(normalized.kind).toBe(BillingKind.Record);
    expect(normalized.startDate).toBe('2026-08-05');
    expect(normalized.reminders).toBeUndefined();
  });

  it('names a registro a pagar by its receiving contact and leaves the owner alone in the split', () => {
    const normalized = normalizeBillingInput({ ...registro, split: undefined, contactId: 'contact-1' }, now);

    expect(normalized.type).toBe(Direction.Payable);
    expect(normalized.contactId).toBe('contact-1');
    expect(normalized.split.parts).toEqual([{ kind: SplitPartKind.Owner }]);
  });

  it('takes one payer and refuses a second one', () => {
    const one = normalizeBillingInput(registro, now);
    const crowd = { mode: SplitMode.Equal, parts: [...split.parts, { kind: SplitPartKind.User, userId: 'bruno' }] } satisfies BillingSplit;
    const two: BillingInput = { ...registro, split: crowd };

    expect(one.split.parts).toHaveLength(1);
    expect(() => normalizeBillingInput(two, now)).toThrow('Registro a receber tem um pagador só.');
  });

  it('refuses a wallet key, a key of the receiving contact and reminders', () => {
    const message = 'Registro não tem avisos nem Pix.';

    expect(() => normalizeBillingInput({ ...registro, paymentMethodId: 'pix-1' }, now)).toThrow(message);
    expect(() =>
      normalizeBillingInput({ ...registro, split: undefined, contactId: 'contact-1', paymentMethodId: 'method-1' }, now)
    ).toThrow(message);
    expect(() => normalizeBillingInput({ ...registro, reminders: [{ offsetDays: 0, enabled: true }] }, now)).toThrow(message);
  });

  it('starts a recorrente registro today or later, checked only when a clock is given', () => {
    const monthly: BillingInput = { ...registro, recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly };

    expect(() => normalizeBillingInput(monthly, now)).toThrow('Registro recorrente começa hoje ou depois.');
    expect(() => normalizeBillingInput({ ...monthly, recurrence: BillingRecurrence.Until, endDate: '2026-12-05' }, now)).toThrow(
      'Registro recorrente começa hoje ou depois.'
    );
    expect(normalizeBillingInput({ ...monthly, startDate: '2026-09-15' }, now).startDate).toBe('2026-09-15');
    // Edits normalize without a clock, so an old recorrente registro stays editable.
    expect(normalizeBillingInput(monthly).kind).toBe(BillingKind.Record);
  });

  it('still refuses a conta a receber without a contact when it is not a registro', () => {
    expect(() => normalizeBillingInput({ ...registro, kind: undefined, split: undefined })).toThrow('Selecione ao menos um contato.');
    expect(() =>
      normalizeBillingInput({ ...registro, kind: BillingKind.Live, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] } })
    ).toThrow('Selecione ao menos um contato.');
  });
});

describe('zonedInstant', () => {
  it('converts a local wall-clock time to the UTC instant of that zone', () => {
    expect(zonedInstant('2026-09-10', '09:00', 'America/Sao_Paulo')).toBe('2026-09-10T12:00:00.000Z');
    expect(zonedInstant('2026-09-10', '09:00', 'America/Manaus')).toBe('2026-09-10T13:00:00.000Z');
    expect(zonedInstant('2026-09-10', '09:00', 'UTC')).toBe('2026-09-10T09:00:00.000Z');
  });
});

describe('civilHour', () => {
  it('returns the local hour of the zone', () => {
    expect(civilHour(Date.parse('2026-09-10T11:59:00Z'), 'America/Sao_Paulo')).toBe(8);
    expect(civilHour(Date.parse('2026-09-10T12:00:00Z'), 'America/Sao_Paulo')).toBe(9);
  });
});

describe('DEFAULT_BILLING_REMINDERS', () => {
  it('reminds only on the due date', () => {
    expect(DEFAULT_BILLING_REMINDERS).toEqual([{ offsetDays: 0, enabled: true }]);
  });
});

describe('block 9 direction', () => {
  const base: BillingInput = { recurrence: BillingRecurrence.Once, totalCents: 1000, startDate: '2026-09-20', timezone: 'America/Sao_Paulo' };

  it('derives payable from the receiving contact and settles the split on the owner', () => {
    const normalized = normalizeBillingInput({ ...base, contactId: 'contact-1' });

    expect(normalized.type).toBe(Direction.Payable);
    expect(normalized.contactId).toBe('contact-1');
    expect(normalized.split.parts).toEqual([{ kind: SplitPartKind.Owner }]);
  });

  it('is receivable without a contact and keeps the payers the split names', () => {
    const normalized = normalizeBillingInput({ ...base, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u1' }] } });

    expect(normalized.type).toBe(Direction.Receivable);
    expect(normalized.contactId).toBeUndefined();
  });

  it('lets a receivable registro name its payer and a payable registro its contact', () => {
    const paid = normalizeBillingInput({ ...base, kind: BillingKind.Record, contactId: 'contact-1' });
    const received = normalizeBillingInput({
      ...base,
      kind: BillingKind.Record,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u1' }] }
    });

    expect(paid.type).toBe(Direction.Payable);
    expect(received.split.parts).toEqual([{ kind: SplitPartKind.User, userId: 'u1' }]);
  });

  it('lets a conta a pagar point at one of the receiving contact keys', () => {
    const normalized = normalizeBillingInput({ ...base, contactId: 'contact-1', paymentMethodId: 'method-1' });

    expect(normalized.type).toBe(Direction.Payable);
    expect(normalized.paymentMethodId).toBe('method-1');
  });
});
