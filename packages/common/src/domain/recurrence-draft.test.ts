import { describe, expect, it } from 'vitest';
import { buildRecurrenceInput, type RecurrenceDraft } from './recurrence-draft';

const draft: RecurrenceDraft = {
  selected: ['p2', 'p1'],
  owner: true,
  amount: '100,01',
  description: ' Internet ',
  frequency: 'monthly',
  day: '31',
  month: '2',
  start: '2026-09-07',
  end: '',
  timezone: 'America/Sao_Paulo',
  pix: '',
  mode: 'equal',
  values: {},
  reminders: [{ offsetDays: '-3', enabled: true, channel: 'auto' }]
};
describe('recurrence draft review', () => {
  it('builds normalized domain input preserving selected party order and exact cents', () => {
    expect(buildRecurrenceInput(draft)).toMatchObject({
      totalCents: 10001,
      description: 'Internet',
      day: 31,
      split: {
        mode: 'equal',
        parts: [{ kind: 'person', personId: 'p2' }, { kind: 'person', personId: 'p1' }, { kind: 'owner' }]
      },
      reminders: [{ offsetDays: -3, enabled: true, channel: 'auto' }]
    });
  });
  it('parses fixed money and percentage values once at the review boundary', () => {
    expect(
      buildRecurrenceInput({
        ...draft,
        mode: 'fixed',
        values: { p2: '10,01', p1: '40,00' }
      }).split
    ).toEqual({
      mode: 'fixed',
      parts: [
        { kind: 'person', personId: 'p2', amountCents: 1001 },
        { kind: 'person', personId: 'p1', amountCents: 4000 }
      ]
    });
    expect(
      buildRecurrenceInput({
        ...draft,
        mode: 'percentage',
        values: { p2: '33,33', p1: '33,33', owner: '33,34' }
      }).split
    ).toEqual({
      mode: 'percentage',
      parts: [
        { kind: 'person', personId: 'p2', basisPoints: 3333 },
        { kind: 'person', personId: 'p1', basisPoints: 3333 },
        { kind: 'owner', basisPoints: 3334 }
      ]
    });
  });
  it.each(['', '-', '1.5', '1e1', ' 3', '--3'])('rejects unfinished or malformed reminder %j instead of coercing it', (offsetDays) => {
    expect(() =>
      buildRecurrenceInput({
        ...draft,
        reminders: [{ offsetDays, channel: 'auto', enabled: true }]
      })
    ).toThrow();
  });
  it('rejects duplicate offsets, invalid allocations and empty participant selection', () => {
    expect(() =>
      buildRecurrenceInput({
        ...draft,
        reminders: [...draft.reminders, ...draft.reminders]
      })
    ).toThrow();
    expect(() =>
      buildRecurrenceInput({
        ...draft,
        mode: 'percentage',
        values: { p2: '1', p1: '1', owner: '1' }
      })
    ).toThrow();
    expect(() => buildRecurrenceInput({ ...draft, selected: [] })).toThrow();
  });
});
