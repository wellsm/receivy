# Vencimento no final do mês Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Billings (Única, Mensal parcelado, Mensal recorrente) can fall on the last day of every month via `due_rule = end_of_month`.

**Architecture:** One calendar rule field (`dueRule`) flows from the draft through `normalizeBillingInput` into `billings.due_rule`; `billingDates` reads it, so creation, previews and materialization follow without extra branches. Web and mobile swap the date input for a month picker while the mode is on.

**Tech Stack:** TypeScript, Vitest (common/web), node:test + EZ4 (api), Jest + RNTL (mobile), Next 16, Expo Router, Tailwind/Uniwind.

**Spec:** `docs/superpowers/specs/2026-09-12-vencimento-final-do-mes-design.md`

## Global Constraints

- Never commit, push, run migrations or deploy (user rule). The user runs `ALTER TABLE billings ADD COLUMN due_rule text;`.
- No new dependency.
- Copy: "Final do mês", "Mês do vencimento", "vence dd/mm", "· final do mês", errors `Final do mês só vale para cobranças mensais.` and `Com final do mês, o vencimento deve ser o último dia do mês.`
- `dueRule` is optional on `BillingSummary`/`BillingDetail` (API always fills it; clients read `?? 'fixed'`).
- Month picker: current month + 12 (13 options).
- Lint + typecheck + tests per package before claiming done; API integration tests are left to the user (they reset the test DB).

---

### Task 1: Calendar rule in `@receivy/common`

**Files:**
- Modify: `packages/common/src/domain/billing.ts` (types)
- Modify: `packages/common/src/domain/billing-calendar.ts` (`BillingCalendarRule`, `endOfMonth`, `billingDates`, `billingDueDates`, `normalizeBillingInput`)
- Modify: `packages/common/src/domain/calendar-labels.ts` (`endOfMonthOptions`)
- Modify: `packages/common/src/domain/billing-draft.ts` (`dueRule`, `endDateFor`, `buildBillingInput`)
- Test: `billing-calendar.test.ts`, `calendar-labels.test.ts`, `billing-draft.test.ts`

**Interfaces — Produces:**
- `type BillingDueRule = 'fixed' | 'end_of_month'`
- `BillingInput.dueRule?`, `BillingPatch.dueRule?`, `BillingSummary.dueRule?`, `BillingDetail.dueRule?`, `BillingDraft.dueRule`
- `endOfMonth(value: string): string`
- `endOfMonthOptions(today: string, count?: number): { value: string; label: string; dueLabel: string }[]`

- [ ] **Step 1: Failing tests**

```ts
// billing-calendar.test.ts
it('lands every month on its last day with an end_of_month rule', () => {
  expect(billingDates({ frequency: 'monthly', startDate: '2026-09-30', dueRule: 'end_of_month' }, '2026-09-01', '2027-02-28')).toEqual([
    '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'
  ]);
  expect(billingDates({ frequency: 'monthly', startDate: '2028-01-31', dueRule: 'end_of_month' }, '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  // A fixed rule keeps the start day: the bug end_of_month fixes.
  expect(billingDates({ frequency: 'monthly', startDate: '2026-09-30' }, '2026-10-01', '2026-10-31')).toEqual(['2026-10-30']);
});

it('finds the last day of a month', () => {
  expect(endOfMonth('2026-09-12')).toBe('2026-09-30');
  expect(endOfMonth('2028-02-01')).toBe('2028-02-29');
  expect(() => endOfMonth('31/01/2026')).toThrow(RangeError);
});

it('accepts end_of_month only on the last day of monthly or once billings', () => {
  const base = { type: 'until' as const, frequency: 'monthly' as const, totalCents: 1_000, startDate: '2026-09-30', endDate: '2026-11-30', timezone: 'America/Sao_Paulo', split, dueRule: 'end_of_month' as const };

  expect(normalizeBillingInput(base).dueRule).toBe('end_of_month');
  expect(billingDueDates(base)).toEqual(['2026-09-30', '2026-10-31', '2026-11-30']);
  expect(() => normalizeBillingInput({ ...base, startDate: '2026-09-29' })).toThrow('Com final do mês, o vencimento deve ser o último dia do mês.');
  expect(() => normalizeBillingInput({ ...base, type: 'indefinite', frequency: 'yearly', endDate: undefined })).toThrow('Final do mês só vale para cobranças mensais.');
  expect(normalizeBillingInput({ ...base, type: 'once', frequency: undefined, endDate: undefined }).dueRule).toBe('end_of_month');
});

// calendar-labels.test.ts
it('lists month ends for the month picker from the current month', () => {
  expect(endOfMonthOptions('2026-09-12', 3)).toEqual([
    { value: '2026-09-30', label: 'Setembro de 2026', dueLabel: 'vence 30/09' },
    { value: '2026-10-31', label: 'Outubro de 2026', dueLabel: 'vence 31/10' },
    { value: '2026-11-30', label: 'Novembro de 2026', dueLabel: 'vence 30/11' }
  ]);
});

// billing-draft.test.ts
it('counts "N vezes" on month ends with an end_of_month rule', () => {
  expect(buildBillingInput({ ...base, type: 'until', start: '2026-09-30', occurrences: '3', dueRule: 'end_of_month' })).toMatchObject({ endDate: '2026-11-30', dueRule: 'end_of_month' });
});
```

- [ ] **Step 2: Run** `pnpm --filter @receivy/common test` → FAIL (`endOfMonth` not exported, `dueRule` ignored).

- [ ] **Step 3: Implement**

```ts
// billing.ts
export type BillingDueRule = 'fixed' | 'end_of_month';
// BillingInput
  /** 'end_of_month' lands every occurrence on the last day of its month (monthly or once). Absent means 'fixed'. */
  dueRule?: BillingDueRule;
// BillingPatch
  /** Recorrente only, sent with startDate: a fixed day or the last day of each month. */
  dueRule?: BillingDueRule;
// BillingSummary and BillingDetail
  /** Always sent by the API; absent on older payloads, read as 'fixed'. */
  dueRule?: BillingDueRule;

// billing-calendar.ts
export type BillingCalendarRule = { frequency: BillingFrequency; startDate: string; endDate?: string; dueRule?: BillingDueRule };

/** Last day of the month `value` falls in; only year and month are read. */
export function endOfMonth(value: string): string {
  const month = Number(value.slice(5, 7));

  if (!ISO_DATE.test(value) || month < 1 || month > 12) {
    throw new RangeError('Data inválida.');
  }

  const day = new Date(Date.UTC(Number(value.slice(0, 4)), month, 0)).getUTCDate();

  return `${value.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}
// billingDates: const day = rule.dueRule === 'end_of_month' ? 31 : Number(rule.startDate.slice(8, 10));
// billingDueDates: Pick adds 'dueRule'; the rule passes dueRule: input.dueRule
// normalizeBillingInput, after the frequency check:
  const dueRule = input.dueRule ?? 'fixed';

  if (dueRule === 'end_of_month' && recurring && input.frequency !== 'monthly') {
    throw new RangeError('Final do mês só vale para cobranças mensais.');
  }

  if (dueRule === 'end_of_month' && input.startDate !== endOfMonth(input.startDate)) {
    throw new RangeError('Com final do mês, o vencimento deve ser o último dia do mês.');
  }
// return adds: dueRule,

// calendar-labels.ts
export type MonthEndOption = { value: string; label: string; dueLabel: string };

/** The last day of `count` months from the month of `today`, labelled for the month picker. */
export function endOfMonthOptions(today: string, count = 13): MonthEndOption[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const names = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return Array.from({ length: count }, (_, index) => {
    const first = new Date(Date.UTC(year, month + index, 1));
    const value = endOfMonth(first.toISOString().slice(0, 10));
    const name = names.format(first);

    return { value, label: `${name.charAt(0).toUpperCase()}${name.slice(1)}`, dueLabel: `vence ${shortDayMonth(value)}` };
  });
}

// billing-draft.ts
//   BillingDraft: dueRule: BillingDueRule;   EMPTY_BILLING_DRAFT: dueRule: 'fixed'
//   endDateFor: billingDates({ frequency: draft.frequency, startDate: draft.start, dueRule: draft.dueRule }, ...)
//   buildBillingInput base:
    // Yearly never keeps a month-end rule, whatever the draft remembers.
    dueRule: draft.dueRule === 'end_of_month' && (draft.type === 'once' || draft.frequency === 'monthly') ? 'end_of_month' : undefined,
```

- [ ] **Step 4: Run** `pnpm --filter @receivy/common test && pnpm --filter @receivy/common lint` → PASS.

### Task 2: API

**Files:** `api/src/billings/schemas/billing.ts`, `api/src/billings/utils/body.ts`, `api/src/billings/services/request.ts`, `api/src/billings/repositories/billing.ts`, `api/test/billings/billings.spec.ts`, `docs/api-oas.yml`

**Interfaces — Consumes:** Task 1 types, `normalizeBillingInput`, `billingDueDates` with `dueRule`.

- [ ] **Step 1: Failing integration test** (in `billings.spec.ts`)

```ts
it('lands until and indefinite occurrences on the last day of each month with an end_of_month rule', async () => {
  const until = await createBilling(db, OWNER, 'month-end-until', { ...once({ description: 'Aluguel' }), type: 'until', frequency: 'monthly', startDate: '2026-09-30', endDate: '2026-11-30', dueRule: 'end_of_month' }, date('2026-09-01'));
  equal(until.dueRule, 'end_of_month');
  deepEqual(until.charges.map((charge) => charge.dueDate), ['2026-09-30', '2026-10-31', '2026-11-30']);
  await rejects(() => patchBilling(db, OWNER, until.id, { dueRule: 'fixed' }), ApiError);
  await rejects(() => createBilling(db, OWNER, 'month-end-yearly', { ...once(), type: 'indefinite', frequency: 'yearly', startDate: '2026-09-30', dueRule: 'end_of_month' }, date('2026-09-01')), RangeError);
  await rejects(() => createBilling(db, OWNER, 'month-end-wrong-day', { ...once(), startDate: '2026-10-30', dueRule: 'end_of_month' }), RangeError);

  const rent = await createBilling(db, OWNER, 'month-end-rent', { ...once({ description: 'Aluguel' }), type: 'indefinite', frequency: 'monthly', startDate: '2026-09-15' }, date('2026-09-01'));
  equal(rent.dueRule, 'fixed');
  await materializeNextOccurrence(db, rent.id, date('2026-09-15'));

  const switched = await patchBilling(db, OWNER, rent.id, { dueRule: 'end_of_month', startDate: '2026-09-30' }, date('2026-09-16'));
  equal(switched.dueRule, 'end_of_month');
  deepEqual(switched.previews.map((preview) => preview.occurrenceDate).slice(0, 3), ['2026-09-30', '2026-10-31', '2026-11-30']);
  equal(switched.charges[0]!.dueDate, '2026-09-15', 'generated charges keep their date');
  await rejects(() => patchBilling(db, OWNER, rent.id, { dueRule: 'end_of_month', startDate: '2026-10-30' }, date('2026-09-16')), RangeError);

  await patchBilling(db, OWNER, rent.id, { state: 'ended' });
  await patchBilling(db, OWNER, until.id, { state: 'ended' });
});
```

- [ ] **Step 2: Implement**

```ts
// schemas/billing.ts, after end_date
  /** 'end_of_month' lands every occurrence on the last day of its month; null (older rows) means 'fixed'. */
  due_rule?: 'fixed' | 'end_of_month';
// utils/body.ts: BillingBody after endDate and PatchBody after startDate
  dueRule?: 'fixed' | 'end_of_month';
// services/request.ts canonical object, after endDate
      // Only the new rule enters the hash, so replays of older fixed requests keep their fingerprint.
      ...(input.dueRule === 'end_of_month' ? { dueRule: input.dueRule } : {}),
// repositories/billing.ts
//   BILLING_SELECT: due_rule: true   BillingRow: due_rule?: BillingDueRule
//   calendarRule: { frequency, startDate, endDate, dueRule: row.due_rule }
//   summary/dto: dueRule: row.due_rule ?? 'fixed'
//   createBilling insert: due_rule: input.dueRule ?? 'fixed'
//   installmentCountFor: billingDueDates({ ..., dueRule: row.due_rule })
//   billingInputFrom: dueRule: row.due_rule
//   assertPatchAllowed frozen: || patch.dueRule !== undefined
//   patchBilling:
    const dueRule = patch.dueRule ?? row.due_rule ?? 'fixed';
    const startDate = patch.startDate ?? row.start_date;
    const rescheduled = startDate !== row.start_date || dueRule !== (row.due_rule ?? 'fixed');

    if (rescheduled) {
      // Same checks as creation: a real date, monthly only for a month end, and on its last day.
      normalizeBillingInput({ ...billingInputFrom(row, split), startDate, dueRule });
    }
//   update data: ...(rescheduled ? { start_date: startDate, due_rule: dueRule, processed_through: rescheduledCursor(row, startDate, today) } : {})
//   notice: patch.startDate !== undefined || patch.dueRule !== undefined || patch.state === 'active'
```

- [ ] **Step 3: Verify** `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test && pnpm --filter @receivy/api openapi:generate && pnpm --filter @receivy/api openapi:check` and biome on touched files. Integration (`test:integration`) is run by the user.

### Task 3: Web

**Files:** Create `web/src/components/app/month-select.tsx`; modify `web/src/components/forms/billing-form-screen.tsx`, `web/src/components/screens/billing-detail-screen.tsx`; test `web/src/components/forms/billing-form-screen.test.tsx`.

**Interfaces — Consumes:** `endOfMonth`, `endOfMonthOptions`, `BillingDueRule`.
**Produces:** `MonthSelect({ value, today, onSelect, disabled })`, combobox named "Mês do vencimento", options named by `label`.

- [ ] **Step 1: Failing tests**

```tsx
it("lands the due date on the last day of the picked month with Final do mês", async () => {
  // create flow as in "creates the billing in one step": pick Ana, type the amount, then
  await user.click(screen.getByRole("button", { name: "Final do mês" }));
  expect(screen.queryByLabelText("Vencimento")).not.toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "Mês do vencimento" }));
  const next = endOfMonthOptions(today(), 2)[1]!;
  await user.click(screen.getByRole("option", { name: new RegExp(next.label) }));
  // submit and read the POST body
  expect(body).toMatchObject({ startDate: next.value, dueRule: "end_of_month" });
});

it("offers Final do mês only while the billing is once or monthly", async () => {
  // choose the recurring type, set Frequência to Anual → no "Final do mês" button
});

it("switches an open-ended billing to the end of the month on edit", async () => {
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(indefiniteBilling) : undefined));
  const { user } = renderForm(indefiniteBilling);
  await user.click(await screen.findByRole("button", { name: "Final do mês" }));
  // save and read the PATCH body
  expect(patchBody).toMatchObject({ dueRule: "end_of_month", startDate: endOfMonth(indefiniteBilling.startDate >= today() ? indefiniteBilling.startDate : today()) });
});
```

- [ ] **Step 2: Implement** — `MonthSelect` copies the `CategorySelect` panel (bottom sheet up to `sm`, anchored dropdown from `sm`), trigger shows `label` and `dueLabel`, options from `endOfMonthOptions(today, 13)`, fallback `endOfMonthOptions(value, 1)[0]` when the value is outside the window. Form:

```tsx
  // Month ends exist for a single due date and for monthly rules; yearly keeps a fixed day.
  const monthEnds = draft.type === "once" || draft.frequency === "monthly";
  const monthEnd = monthEnds && draft.dueRule === "end_of_month";

  function toggleMonthEnd() {
    if (monthEnd) {
      update({ dueRule: "fixed" });
      return;
    }

    update({ dueRule: "end_of_month", start: endOfMonth(draft.start && draft.start >= today ? draft.start : today) });
  }
```

`MonthSelect` replaces the date input while `monthEnd`; "Hoje" sets `{ start: today, dueRule: "fixed" }`; chip "Final do mês" with `aria-pressed={monthEnd}` rendered when `monthEnds`. `draftFromBilling` reads `dueRule: billing.dueRule ?? "fixed"`; `patchBody` adds `dueRule: input.dueRule ?? "fixed"` beside `startDate`. Detail `typeTag` appends `· final do mês` to Parcelado and Recorrente mensal.

- [ ] **Step 3: Verify** `pnpm --filter @receivy/web test && pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint` (lint on touched files).

### Task 4: Mobile

**Files:** Create `mobile/src/components/app/month-select.tsx`; modify `mobile/src/components/forms/billing-form-screen.tsx`, `mobile/src/components/screens/billing-detail-screen.tsx`; test `mobile/src/components/forms/billing-form-screen.test.tsx`.

**Interfaces — Produces:** `MonthSelect({ value, today, onSelect, disabled })`, trigger button "Mês do vencimento", options named by `label` inside a `Modal` bottom sheet (same shape as mobile `CategorySelect`).

- [ ] **Step 1: Failing tests**

```tsx
it("picks the month of a due date on the last day with Final do mês", async () => {
  const { client } = await quickForm();
  await fillQuickBilling();
  await fireEvent.press(screen.getByRole("button", { name: "Final do mês" }));
  expect(screen.queryByLabelText("Vencimento")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Mês do vencimento" }));
  const next = endOfMonthOptions(calendarDate(new Date(), TIMEZONE), 2)[1]!;
  await fireEvent.press(await screen.findByRole("button", { name: next.label }));
  await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
  await waitFor(() => expect(client.createBilling).toHaveBeenCalled());
  expect(client.createBilling.mock.calls[0][0]).toMatchObject({ startDate: next.value, dueRule: "end_of_month" });
});

it("hides Final do mês on a yearly billing", async () => {
  // press the recurring type and "Anual" → no "Final do mês" button
});
```

- [ ] **Step 2: Implement** — same `monthEnds`/`monthEnd`/`toggleMonthEnd` as web (typed text guarded by `/^\d{4}-\d{2}-\d{2}$/` before `endOfMonth`); `MonthSelect` replaces the `TextInput` and hides the calendar button while `monthEnd`; quick "Hoje" sets `dueRule: "fixed"`; `draftFromBilling`, `patchBody` and `typeTag` as web.

- [ ] **Step 3: Verify** `pnpm --filter @receivy/mobile test && pnpm --filter @receivy/mobile check-types` + eslint on touched files.

### Task 5: Docs

- [ ] `docs/recurrences.md`: after "Mensais limitam dias 29–31 ao último dia do mês; …" add the `due_rule = end_of_month` rule.
- [ ] Append one line to `~/Projects/ai-rules/notes/receivy.md`.
- [ ] Final report: migration SQL for the user, integration command left to run.
