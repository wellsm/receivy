# Mês materializado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every occurrence due until the end of the current month exists as a real charge; the initial notice only goes out for what is due today (or that no reminder will reach); Pausar/Encerrar and recurring edits ask what happens to the charges already created.

**Architecture:** One horizon function (`materializationHorizon`) replaces the reminder lead time in `dueOccurrences`; one pure gate (`shouldSendInitialNotice`) sits inside `announceCharges`, the single entry every creation path already uses. `BillingPatch` gains `pendingCharges` (Pausar/Encerrar) and `applyTo` (edit); the edit rewrites this month's not-yet-due charges in place through a pure diff (`monthChanges`). Web and mobile share `@receivy/common` helpers to decide when to ask, and one scope dialog/modal per platform.

**Tech Stack:** TypeScript, Vitest (common/web/api unit), node:test + EZ4 (api integration), Jest + RNTL 14 (mobile), Next 16, Expo Router, Tailwind/Uniwind.

**Spec:** `docs/superpowers/specs/2026-09-12-mes-materializado-design.md`

## Global Constraints

- Never commit, push, run migrations or deploy (user rule). No migration is needed: no new column.
- No new dependency.
- AGENTS.md: repositories are namespaces (`BillingRepository.*`), handlers destructure `{ db }`, string unions are `const enum`, clean code with early returns.
- API style: single quotes, semicolons, no trailing commas, width 140 (Biome). Web: prettier-like, double quotes, ~200 columns, no formatter over whole files. Mobile: keep each file's formatting.
- Enum values (exact): `PendingChargesAction { Keep = 'keep', Cancel = 'cancel' }`, `EditScope { CurrentMonth = 'current_month', NextMonth = 'next_month' }`.
- Error codes (exact): `PENDING_CHARGES_WITHOUT_STATE` (422), `EDIT_SCOPE_NOT_RECURRING` (422).
- Event payload reasons (exact): `billing_paused`, `billing_ended`, `billing_edited`; new event type `charge.edited`.
- Copy (exact, pt-BR):
  - Pausar: title `Pausar conta?`, explanation `Novas cobranças deixam de ser geradas. E as pendentes de “{descrição}”?`
  - Encerrar: title `Encerrar conta?`, subtitle `Esta ação não pode ser desfeita.`, explanation `Encerrar impede novas ocorrências de “{descrição}”. E as pendentes?`
  - Actions: `Manter as deste mês`, `Cancelar pendentes ({n})`, `Voltar`
  - Edit: title `Aplicar às cobranças deste mês?`, explanation `{n} cobrança(s) de {mês} ainda não venceu/venceram.` (see Task 2 `editScopeExplanation`), actions `Aplicar também às deste mês`, `Só a partir do mês seguinte`, `Voltar`
  - Errors: `Escolha pausar ou encerrar para decidir sobre as cobranças pendentes.`, `Só contas recorrentes aplicam a edição às cobranças do mês.`
- API integration specs (`test/**`) run against the `receivy_tests` database with `--reset`; the user runs `pnpm --filter @receivy/api test:integration`. Executors write them and must pass `pnpm --filter @receivy/api check-types:test`.
- Per package before claiming done: `check-types`, `lint`, `test` (api: `pnpm exec vitest run src --pool=forks`; baseline has 6 known failures in `src/common/services/email/service.test.ts`).

## File map

| File | Responsibility |
|---|---|
| `packages/common/src/domain/billing.ts` | `PendingChargesAction`, `EditScope`, `BillingPatch.pendingCharges/applyTo` |
| `packages/common/src/domain/billing-calendar.ts` | `materializationDate` (month start), `materializationHorizon` |
| `packages/common/src/domain/billing-scope.ts` (new) | `pendingChargesOf`, `editableMonthCharges`, `patchTouchesCharges`, `shouldAskEditScope`, `editScopeExplanation` |
| `packages/api/src/notifications/services/planner.ts` | `shouldSendInitialNotice` |
| `packages/api/src/notifications/services/send.ts` | gate inside `announceCharges` |
| `packages/api/src/public/repositories/public-link.ts` | late initial notice through `announceCharges` |
| `packages/api/src/billings/services/month-scope.ts` (new) | pure `monthChanges` diff |
| `packages/api/src/billings/repositories/billing.ts` | horizon, reschedule cursor, `pendingCharges`, `applyTo` rewrite |
| `packages/api/src/billings/errors.ts`, `utils/body.ts`, `src/api.ts` | two 422 errors, `PatchBody` fields, `httpErrors` |
| `packages/web/src/components/app/scope-dialog.tsx` (new) | two-action dialog + Voltar |
| `packages/web/src/components/screens/billing-detail-screen.tsx` | Pausar/Encerrar scope |
| `packages/web/src/components/forms/billing-form-screen.tsx` | edit scope |
| `packages/mobile/src/components/app/scope-modal.tsx` (new) | two-action modal + Voltar |
| `packages/mobile/src/components/screens/billing-detail-screen.tsx` | Pausar/Encerrar scope |
| `packages/mobile/src/components/forms/billing-form-screen.tsx` | edit scope |

---

### Task 1: Calendar horizon and patch contract in `@receivy/common`

**Files:**
- Modify: `packages/common/src/domain/billing.ts` (enums after `SplitPartKind`, `BillingPatch`)
- Modify: `packages/common/src/domain/billing-calendar.ts:53-57` (`materializationDate`) + new `materializationHorizon`
- Test: `packages/common/src/domain/billing-calendar.test.ts:110-119`

**Interfaces — Produces:**
- `export const enum PendingChargesAction { Keep = 'keep', Cancel = 'cancel' }`
- `export const enum EditScope { CurrentMonth = 'current_month', NextMonth = 'next_month' }`
- `BillingPatch.pendingCharges?: PendingChargesAction`, `BillingPatch.applyTo?: EditScope`
- `materializationDate(dueDate: string, reminders: BillingReminder[]): string`
- `materializationHorizon(today: string, reminders: BillingReminder[]): string`

- [ ] **Step 1: Replace the failing expectations in `billing-calendar.test.ts:110-119`**

```ts
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
```

Add `materializationHorizon` to the import list at the top of the test file.

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @receivy/common exec vitest run src/domain/billing-calendar.test.ts`
Expected: FAIL — `materializationHorizon` is not exported and `'2026-03-07'` ≠ `'2026-03-01'`.

- [ ] **Step 3: Implement in `billing-calendar.ts`**

Replace `materializationDate` (lines 53-57) with:

```ts
function earliestOffset(reminders: BillingReminder[]): number {
  const offsets = reminders.filter((reminder) => reminder.enabled).map((reminder) => reminder.offsetDays);

  return offsets.length ? Math.min(...offsets) : 0;
}

/** The day an occurrence becomes a charge: the first day of its month, or earlier when a reminder fires before that. */
export function materializationDate(dueDate: string, reminders: BillingReminder[]): string {
  const byReminder = addCalendarDays(dueDate, earliestOffset(reminders));
  const monthStart = `${dueDate.slice(0, 7)}-01`;

  return byReminder < monthStart ? byReminder : monthStart;
}

/** The last due date that must already exist today: the month end, or later when an early reminder reaches next month. */
export function materializationHorizon(today: string, reminders: BillingReminder[]): string {
  const byReminder = addCalendarDays(today, -earliestOffset(reminders));
  const monthEnd = endOfMonth(today);

  return byReminder > monthEnd ? byReminder : monthEnd;
}
```

- [ ] **Step 4: Add the enums and patch fields in `billing.ts`**

After `SplitPartKind`:

```ts
/** What Pausar/Encerrar do with pending charges: keep this month's, or cancel every pending one. */
export const enum PendingChargesAction {
  Keep = 'keep',
  Cancel = 'cancel'
}

/** Whether an edit of a recorrente also rewrites this month's charges that are not due yet. */
export const enum EditScope {
  CurrentMonth = 'current_month',
  NextMonth = 'next_month'
}
```

In `BillingPatch`, after `state?: BillingState;`:

```ts
  /** Only with state paused/ended. Absent keeps the old behavior: pausing keeps, ending cancels. */
  pendingCharges?: PendingChargesAction;
  /** Recorrente only. Absent means next month. */
  applyTo?: EditScope;
```

- [ ] **Step 5: Run and see it pass**

Run: `pnpm --filter @receivy/common exec vitest run src/domain/billing-calendar.test.ts && pnpm --filter @receivy/common check-types`
Expected: PASS, 0 type errors.

- [ ] **Step 6: No commit** (user rule).

---

### Task 2: Scope helpers shared by web and mobile

**Files:**
- Create: `packages/common/src/domain/billing-scope.ts`
- Create: `packages/common/src/domain/billing-scope.test.ts`
- Modify: `packages/common/src/index.ts` (add `export * from './domain/billing-scope';` after `billing-preview`)

**Interfaces:**
- Consumes: `PendingChargesAction`, `EditScope`, `BillingPatch` (Task 1)
- Produces:
  - `pendingChargesOf(billing: Pick<BillingDetail, 'charges'>): ChargeDetail[]`
  - `editableMonthCharges(billing: Pick<BillingDetail, 'charges'>, today: string): ChargeDetail[]`
  - `patchTouchesCharges(billing: BillingDetail, patch: BillingPatch): boolean`
  - `shouldAskEditScope(billing: BillingDetail, patch: BillingPatch, today: string): boolean`
  - `editScopeExplanation(count: number, today: string): string`

- [ ] **Step 1: Failing tests (`billing-scope.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { type BillingDetail, BillingDueRule, BillingFrequency, BillingState, BillingType, SplitPartKind } from './billing';
import { BillingCategory } from './billing-category';
import { editableMonthCharges, editScopeExplanation, patchTouchesCharges, pendingChargesOf, shouldAskEditScope } from './billing-scope';
import { type ChargeDetail, ChargeState, Direction, ProofMime, ProofState, SharingState, SplitMode } from './contracts';

function charge(overrides: Partial<ChargeDetail> & { id: string }): ChargeDetail {
  return {
    description: 'Aluguel',
    amount: { amountCents: 100_000, currency: 'BRL' },
    dueDate: '2026-09-20',
    state: ChargeState.Pending,
    billingId: 'b1',
    billingType: BillingType.Indefinite,
    installment: null,
    installmentCount: null,
    counterpartName: 'Ana',
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: 'u1', name: 'Ana', email: null },
    debtorUserId: 'u1',
    pix: null,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides
  };
}

const recurring: BillingDetail = {
  id: 'b1',
  type: BillingType.Indefinite,
  frequency: BillingFrequency.Monthly,
  direction: Direction.Receivable,
  payee: null,
  pix: null,
  description: 'Aluguel',
  total: { amountCents: 100_000, currency: 'BRL' },
  startDate: '2026-09-20',
  dueRule: BillingDueRule.Fixed,
  state: BillingState.Active,
  nextDueDate: '2026-09-20',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  timezone: 'America/Sao_Paulo',
  paymentMethodId: 'pix-1',
  reminders: [],
  split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u1' }] },
  allocations: [],
  charges: [charge({ id: 'c1' })],
  previews: [],
  nextMaterialization: '2026-10-01',
  category: BillingCategory.Housing,
  invite: null,
  guests: [],
  linkableContacts: []
};

describe('billing scope helpers', () => {
  it('counts every pending charge for Cancelar pendentes', () => {
    const billing = { charges: [charge({ id: 'a' }), charge({ id: 'b', state: ChargeState.Paid }), charge({ id: 'c', dueDate: '2026-08-20' })] };

    expect(pendingChargesOf(billing).map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('keeps only this month charges that are pending, not due yet and without a proof under way', () => {
    const file = { name: 'p.pdf', mime: ProofMime.Pdf, size: 1 };
    const proof = (state: ProofState) => ({ state, file, sentAt: '', reviewedAt: null, reason: null, sentByViewer: false });
    const billing = {
      charges: [
        charge({ id: 'future' }),
        charge({ id: 'today', dueDate: '2026-09-10' }),
        charge({ id: 'next-month', dueDate: '2026-10-05' }),
        charge({ id: 'paid', state: ChargeState.Paid }),
        charge({ id: 'review', proof: proof(ProofState.Pending) }),
        charge({ id: 'rejected', proof: proof(ProofState.Rejected) })
      ]
    };

    expect(editableMonthCharges(billing, '2026-09-10').map((item) => item.id)).toEqual(['future', 'rejected']);
  });

  it('flags only the fields a charge carries', () => {
    expect(patchTouchesCharges(recurring, { category: BillingCategory.Food, reminders: [] })).toBe(false);
    expect(patchTouchesCharges(recurring, { description: 'Aluguel', totalCents: 100_000, paymentMethodId: 'pix-1', clearPaymentMethod: false })).toBe(false);
    expect(patchTouchesCharges(recurring, { totalCents: 120_000 })).toBe(true);
    expect(patchTouchesCharges(recurring, { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u2' }] } })).toBe(true);
    expect(patchTouchesCharges(recurring, { split: { mode: SplitMode.Equal, parts: [{ userId: 'u1', kind: SplitPartKind.User }] } })).toBe(false);
    expect(patchTouchesCharges(recurring, { startDate: '2026-09-25' })).toBe(true);
    expect(patchTouchesCharges({ ...recurring, type: BillingType.Once }, { totalCents: 1 })).toBe(false);
  });

  it('asks only when a charge-carried field changes and this month still has editable charges', () => {
    expect(shouldAskEditScope(recurring, { totalCents: 120_000 }, '2026-09-10')).toBe(true);
    expect(shouldAskEditScope(recurring, { totalCents: 120_000 }, '2026-09-20')).toBe(false);
    expect(shouldAskEditScope(recurring, { category: BillingCategory.Food }, '2026-09-10')).toBe(false);
  });

  it('explains the count with the month name', () => {
    expect(editScopeExplanation(1, '2026-09-10')).toBe('1 cobrança de setembro ainda não venceu.');
    expect(editScopeExplanation(3, '2026-12-01')).toBe('3 cobranças de dezembro ainda não venceram.');
  });
});
```

Remove the stray `import { BillingType as _unused }` line if Biome flags it; it is not needed.

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @receivy/common exec vitest run src/domain/billing-scope.test.ts`
Expected: FAIL — cannot resolve `./billing-scope`.

- [ ] **Step 3: Implement `billing-scope.ts`**

```ts
import { type BillingDetail, BillingDueRule, type BillingPatch, type BillingPixInput, BillingType } from './billing';
import { endOfMonth } from './billing-calendar';
import { type ChargeDetail, ChargeState, type PixSnapshot, ProofState } from './contracts';
import type { BillingSplit } from './split';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Every pending charge: what "Cancelar pendentes" cancels. */
export function pendingChargesOf(billing: Pick<BillingDetail, 'charges'>): ChargeDetail[] {
  return billing.charges.filter((charge) => charge.state === ChargeState.Pending);
}

/** What an edit with EditScope.CurrentMonth rewrites: pending, due after today within this month, no proof under way. */
export function editableMonthCharges(billing: Pick<BillingDetail, 'charges'>, today: string): ChargeDetail[] {
  const monthEnd = endOfMonth(today);

  return billing.charges.filter((charge) => {
    if (charge.state !== ChargeState.Pending) {
      return false;
    }

    if (charge.dueDate <= today || charge.dueDate > monthEnd) {
      return false;
    }

    return !charge.proof || charge.proof.state === ProofState.Rejected;
  });
}

function splitKey(split: BillingSplit): string {
  const parts = split.parts.map((part) => {
    const userId = 'userId' in part ? part.userId : '';
    const value = 'amountCents' in part ? part.amountCents : 'basisPoints' in part ? part.basisPoints : 'shares' in part ? part.shares : '';

    return `${part.kind}:${userId}:${value}`;
  });

  return `${split.mode}|${parts.sort().join(',')}`;
}

function pixKey(pix: BillingPixInput | PixSnapshot | null | undefined): string {
  return pix ? `${pix.keyType}:${pix.key}:${pix.label ?? ''}` : '';
}

/** True when a recorrente patch changes what its charges carry: text, amount, split, Pix, payee or due day. */
export function patchTouchesCharges(billing: BillingDetail, patch: BillingPatch): boolean {
  if (billing.type !== BillingType.Indefinite) {
    return false;
  }

  const changes = [
    patch.description !== undefined && patch.description !== billing.description,
    patch.totalCents !== undefined && patch.totalCents !== billing.total.amountCents,
    patch.split !== undefined && splitKey(patch.split) !== splitKey(billing.split),
    patch.paymentMethodId !== undefined && patch.paymentMethodId !== billing.paymentMethodId,
    Boolean(patch.clearPaymentMethod) && Boolean(billing.paymentMethodId),
    patch.pix !== undefined && pixKey(patch.pix) !== pixKey(billing.pix),
    Boolean(patch.clearPix) && Boolean(billing.pix),
    patch.payeeUserId !== undefined && patch.payeeUserId !== billing.payee?.userId,
    Boolean(patch.clearPayee) && Boolean(billing.payee),
    patch.startDate !== undefined && patch.startDate !== billing.startDate,
    patch.dueRule !== undefined && patch.dueRule !== (billing.dueRule ?? BillingDueRule.Fixed)
  ];

  return changes.some(Boolean);
}

/** The edit form asks for the scope only when the answer changes something. */
export function shouldAskEditScope(billing: BillingDetail, patch: BillingPatch, today: string): boolean {
  if (!patchTouchesCharges(billing, patch)) {
    return false;
  }

  return editableMonthCharges(billing, today).length > 0;
}

export function editScopeExplanation(count: number, today: string): string {
  const month = MONTHS[Number(today.slice(5, 7)) - 1];

  if (count === 1) {
    return `1 cobrança de ${month} ainda não venceu.`;
  }

  return `${count} cobranças de ${month} ainda não venceram.`;
}
```

If `PixSnapshot` has no `label` or `BillingDetail.dueRule` is named differently, read `contracts.ts`/`billing.ts` and adapt the field access, keeping the behavior the tests describe.

- [ ] **Step 4: Export and run**

Add `export * from './domain/billing-scope';` to `packages/common/src/index.ts`.
Run: `pnpm --filter @receivy/common exec vitest run src/domain/billing-scope.test.ts && pnpm --filter @receivy/common lint`
Expected: PASS; Biome 0 errors (the `noConstEnum` warnings are expected).

- [ ] **Step 5: No commit** (user rule).

---

### Task 3: Initial notice gate (API)

**Files:**
- Modify: `packages/api/src/notifications/services/planner.ts` (new `shouldSendInitialNotice`, imports from `@receivy/common`)
- Create: `packages/api/src/notifications/services/planner.test.ts`
- Modify: `packages/api/src/notifications/services/send.ts:215-226` (`announceCharges`)
- Modify: `packages/api/src/public/repositories/public-link.ts:97-99` (late notice)
- Test (integration): `packages/api/test/notifications/notifications.spec.ts:292-316`, `packages/api/test/financial/first-publication.spec.ts:31-33`

**Interfaces — Produces:**
- `type InitialNoticeInput = { dueDate: string; now: number; timezone: string; reminders: BillingReminder[] }`
- `shouldSendInitialNotice(input: InitialNoticeInput): boolean`

- [ ] **Step 1: Failing unit test (`planner.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { shouldSendInitialNotice } from './planner';

const TZ = 'America/Sao_Paulo';
const at = (iso: string) => Date.parse(iso);
const onDueDay = [{ offsetDays: 0, enabled: true }];

describe('shouldSendInitialNotice', () => {
  it('announces a charge due today or already late', () => {
    expect(shouldSendInitialNotice({ dueDate: '2026-03-10', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: onDueDay })).toBe(true);
    expect(shouldSendInitialNotice({ dueDate: '2026-03-01', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: [] })).toBe(true);
  });

  it('leaves a future charge to its first reminder', () => {
    expect(shouldSendInitialNotice({ dueDate: '2026-03-20', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: onDueDay })).toBe(false);
  });

  it('announces a future charge that no reminder will reach', () => {
    // 06:00 of the 10th in São Paulo (09:00 UTC) is already behind 15:00 UTC.
    expect(
      shouldSendInitialNotice({ dueDate: '2026-03-11', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: [{ offsetDays: -1, enabled: true }] })
    ).toBe(true);
    expect(
      shouldSendInitialNotice({ dueDate: '2026-03-20', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: [{ offsetDays: 0, enabled: false }] })
    ).toBe(true);
  });

  it('reads today in the billing timezone', () => {
    // 01:00 UTC of the 11th is still the 10th in São Paulo, and the reminder of the 11th is ahead.
    expect(shouldSendInitialNotice({ dueDate: '2026-03-11', now: at('2026-03-11T01:00:00Z'), timezone: TZ, reminders: onDueDay })).toBe(false);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/api && pnpm exec vitest run src/notifications/services/planner.test.ts --pool=forks`
Expected: FAIL — `shouldSendInitialNotice` is not exported.

- [ ] **Step 3: Implement in `planner.ts`**

At the top of the file:

```ts
import { addCalendarDays, type BillingReminder } from '@receivy/common';
```

After `instantAt`:

```ts
export type InitialNoticeInput = { dueDate: string; now: number; timezone: string; reminders: BillingReminder[] };

/** A charge due today or earlier is announced at once; a later one waits for its first reminder, unless none is left to fire. */
export function shouldSendInitialNotice({ dueDate, now, timezone, reminders }: InitialNoticeInput): boolean {
  if (dueDate <= civilDate(now, timezone)) {
    return true;
  }

  const reachable = reminders.some((reminder) => {
    if (!reminder.enabled) {
      return false;
    }

    return instantAt(addCalendarDays(dueDate, reminder.offsetDays), REMINDER_HOUR, timezone).getTime() >= now;
  });

  return !reachable;
}
```

- [ ] **Step 4: Run the unit test**

Run: `cd packages/api && pnpm exec vitest run src/notifications/services/planner.test.ts src/import-cycles.test.ts --pool=forks`
Expected: PASS.

- [ ] **Step 5: Gate `announceCharges` (`send.ts:215-226`)**

```ts
export async function announceCharges(db: DbClient, context: NoticeContext, chargeIds: string[], now = Date.now()): Promise<void> {
  for (const chargeId of chargeIds) {
    const charge = await db.charges.findOne({ select: { payer: true, due_date: true, billing_id: true }, where: { id: chargeId } });

    // The owner of a conta a pagar just typed it: only the scheduled reminders reach them.
    if (!charge || ChargeRepository.payer(charge) === ChargePayer.Owner) {
      continue;
    }

    const billing = await db.billings.findOne({ select: { timezone: true, reminders: true }, where: { id: charge.billing_id } });

    if (!billing) {
      continue;
    }

    // A charge created ahead of its due day meets the debtor through the reminders, not on the day it was created.
    const due = shouldSendInitialNotice({ dueDate: charge.due_date, now, timezone: billing.timezone, reminders: effectiveReminders(billing) });

    if (!due) {
      continue;
    }

    await notifyCharge(db, context, chargeId, NoticeTemplate.Initial, now);
  }
}
```

Add `shouldSendInitialNotice` to the existing import from `./planner` in `send.ts`.

- [ ] **Step 6: Route the late notice of `PublicLinkRepository.createOrRotate` through the gate (`public-link.ts:97-99`)**

```ts
    if (announce && notice) {
      await announceCharges(db, notice, [chargeId], nowSeconds * 1000);
    }
```

Replace the `notifyCharge` import from `../../notifications/services/send` with `announceCharges` (keep `NoticeTemplate` if still used). Run `pnpm exec vitest run src/import-cycles.test.ts --pool=forks` again: PASS.

- [ ] **Step 7: Update `test/notifications/notifications.spec.ts:292-316`**

The once charge of `charge()` is due `DUE_DATE = '2029-01-04'`, three days after `start`: with the gate it would wait for its reminder. Move the clock to the due day and add the waiting case:

```ts
  it('announces a charge due today by push and arms the e-mail follow-up two hours later', async () => {
    clock = Date.parse(`${DUE_DATE}T11:00:00Z`);
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[announce]', 'announce');

    const { id } = await charge(OWNER, DEBTOR_EMAIL, true);

    equal(sent.pushes.length, 1);
    equal(sent.emails.length, 0);
    deepEqual((await EventRepository.list(db, id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['push'] });
    deepEqual(notify.events.get(notifyIdentifier(id)), followUp(id));
    equal(followUp(id).date.toISOString(), `${DUE_DATE}T13:00:00.000Z`);
```

Keep the rest of the test body as is. Then add after it:

```ts
  it('leaves a charge due later to its first reminder', async () => {
    clock = start;
    sent.reset();

    const { id } = await charge(OWNER, undefined, true);

    equal(sent.emails.length + sent.pushes.length, 0);
    deepEqual(await EventRepository.list(db, id, 'notice.sent'), []);
    equal(notify.events.has(notifyIdentifier(id)), false);
  });
```

If `followUp(id)` reads `clock` for its date, the new expected instant above holds; if it hardcodes `start`, change it to use `clock`.

- [ ] **Step 8: Update `test/financial/first-publication.spec.ts:31-33`**

The spec checks that a creation notice without Pix is skipped and released on publication. Make the charge due already, so the gate lets the creation notice through:

```ts
    chargeId = (await createOnceCharge(db, owner, 'first-pix', { userId: person.userId, amountCents: 100, dueDate: '2026-01-01' }, context))
      .chargeId;
```

If `BillingRepository.create` rejects a past once date (RangeError), use `calendarDate(new Date(), 'America/Sao_Paulo')` from `@receivy/common` instead.

- [ ] **Step 9: Typecheck**

Run: `cd packages/api && pnpm run check-types && pnpm run check-types:test && pnpm exec biome check src/notifications/services src/public/repositories/public-link.ts test/notifications test/financial/first-publication.spec.ts`
Expected: 0 type errors; Biome 0 errors.

- [ ] **Step 10: No commit** (user rule).

---

### Task 4: Materialize up to the month end (API)

**Files:**
- Modify: `packages/api/src/billings/repositories/billing.ts` — imports, `dueOccurrences` (~502-515), new `rescheduledMonthCursor` next to `rescheduledCursor` (~469), `patch` (~921-951), comment in `create` (~804)
- Test (integration): `packages/api/test/scheduling/crons.spec.ts`, `packages/api/test/billings/billings.spec.ts`, `packages/api/test/invites/invites.spec.ts`

**Interfaces:**
- Consumes: `materializationHorizon`, `endOfMonth` from `@receivy/common` (Task 1)
- Produces: `rescheduledMonthCursor(db: DbClient, row: BillingRepository.Row, startDate: string, today: string): Promise<string>` (private)

- [ ] **Step 1: Update the integration specs that encode the old timing (they fail against the new rule)**

`test/scheduling/crons.spec.ts`, in `before()` replace the two assertions after creating `earlyId`:

```ts
    deepEqual(await dueDates(monthlyId), ['2026-01-31'], 'the month of creation exists right away');
    deepEqual(await dueDates(earlyId), []);
```

Replace the first `it(...)` (materializes every due occurrence…) with:

```ts
  it('materializes every occurrence up to the month end and announces only what is already due', async () => {
    sent.reset();

    ok((await BillingRepository.materializeDueBillings(db, context, cronAt('2026-03-05'))) >= 1);
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28', '2026-03-31']);
    equal(await cursorOf(monthlyId), '2026-03-31');
    equal((await auditTypes(monthlyId)).filter((type) => type === 'billing.materialized').length, 3);
    deepEqual(await dueDates(earlyId), [], 'June is not due in March');

    equal(debtorEmails().length, 1, 'only the late February charge says hello; March waits for its reminder');

    const [january, february, march] = await charges(monthlyId);

    ok(january && february && march);
    deepEqual((await EventRepository.list(db, february.id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['email'] });
    equal(notify.events.has(notifyIdentifier(february.id)), false, 'an e-mail sent right away needs no follow-up');
    deepEqual(await EventRepository.list(db, march.id, 'notice.sent'), []);
    deepEqual(await EventRepository.list(db, january.id, 'notice.sent'), [], 'created with its month, left to the reminder');

    // Both steps are idempotent: the same day again finds nothing to do.
    sent.reset();
    deepEqual(await BillingRepository.materializeDue(db, monthlyId, context, cronAt('2026-03-05')), { materialized: false });
    await BillingRepository.materializeDueBillings(db, context, cronAt('2026-03-05'));
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28', '2026-03-31']);
    equal(debtorEmails().length, 0);
  });
```

In `audits an archived recipient…`, March already exists since 03-05: sweep on April 1st instead.

```ts
    ok(
      (await BillingRepository.materializeDueBillings(db, context, cronAt('2026-04-01'))) >= 1,
      'the healthy billing still gets its charge'
    );
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    equal(debtorEmails().length, 0, 'April waits for its reminder');
```

and `materializeDue(db, billing.id, context, cronAt('2026-04-01'))` in the same test. Everything else in `crons.spec.ts` stays.

`test/billings/billings.spec.ts`:

- In `materializes indefinite billings one occurrence at a time…` replace `equal(created.charges.length, 0);` and `equal(created.nextMaterialization, '2026-01-31');` with:

```ts
    equal(created.charges.length, 1, 'January exists from creation');
    equal(created.nextMaterialization, '2026-02-01');
```

- In `edits future occurrences of an indefinite billing…` move the month: both `startDate: '2026-01-15'` become `'2026-02-15'`; both `materializeNextOccurrence(..., date('2026-01-15'))` become `date('2026-02-01')`; the patch date `date('2026-01-16')` becomes `date('2026-02-16')`. The `processed_through` expectation `'2025-12-31'` stays.

- In the `month-end-rent` block (~190-212):

```ts
    equal(rent.dueRule, 'fixed');
    deepEqual(
      rent.charges.map((charge) => charge.dueDate),
      ['2026-09-15'],
      'the month of creation already has its charge'
    );

    const switched = await BillingRepository.patch(
      db,
      OWNER,
      rent.id,
      { dueRule: BillingDueRule.EndOfMonth, startDate: '2026-09-30' },
      date('2026-09-16')
    );
    equal(switched.dueRule, 'end_of_month');
    deepEqual(
      switched.previews.map((preview) => preview.occurrenceDate).slice(0, 3),
      ['2026-10-31', '2026-11-30', '2026-12-31'],
      'September already has its charge: the new day starts next month'
    );
    equal(switched.charges.length, 1);
    equal(switched.charges[0]!.dueDate, '2026-09-15', 'generated charges keep their date');
```

(remove the now redundant `materializeNextOccurrence(db, rent.id, date('2026-09-15'))` line.)

`test/invites/invites.spec.ts` in `keeps indefinite billings on allocations only…` (~347):

```ts
    ok(endless.charges.length > 0, 'the month of creation exists right away');
    equal((await chargesOf(endless.id)).length, endless.charges.length, 'the guest joins the split from next month');
```

- [ ] **Step 2: Typecheck the specs**

Run: `cd packages/api && pnpm run check-types:test`
Expected: 0 errors (behavior is verified by the user's integration run).

- [ ] **Step 3: Implement the horizon in `dueOccurrences`**

Add `endOfMonth` and `materializationHorizon` to the `@receivy/common` import of `billing.ts`, then:

```ts
function dueOccurrences(row: BillingRepository.Row, now: Date, limit: number): string[] {
  if (row.state !== BillingState.Active || row.type !== BillingType.Indefinite) {
    return [];
  }

  const today = calendarDate(now, row.timezone);
  const latest = materializationHorizon(today, effectiveReminders(row));
  const cursor = row.processed_through ?? addCalendarDays(row.start_date, -1);

  return billingDates(calendarRule(row), addCalendarDays(cursor, 1), latest, limit);
}
```

- [ ] **Step 4: Never give a month a second charge on reschedule**

After `rescheduledCursor`:

```ts
/** A new due day never adds a second charge to a month that already has one: that month is skipped. */
async function rescheduledMonthCursor(db: DbClient, row: BillingRepository.Row, startDate: string, today: string): Promise<string> {
  const cursor = rescheduledCursor(row, startDate, today);
  const monthEnd = endOfMonth(startDate);
  const taken = await db.charges.count({ where: { billing_id: row.id, due_date: { gte: `${startDate.slice(0, 7)}-01`, lte: monthEnd } } });

  if (!taken) {
    return cursor;
  }

  return cursor > monthEnd ? cursor : monthEnd;
}
```

In `patch`, right after the `if (rescheduled) { normalizeBillingInput(...) }` block:

```ts
      const cursor = rescheduled ? await rescheduledMonthCursor(tx, row, startDate, today) : undefined;
```

and in the `updateOne` data replace `processed_through: rescheduledCursor(row, startDate, today)` with `processed_through: cursor`.

In `create`, update the comment above the inline materialization to: `// An assinatura gets the charges of its first month right away instead of waiting for the daily sweep.`

- [ ] **Step 5: Verify**

Run: `cd packages/api && pnpm run check-types && pnpm run check-types:test && pnpm exec vitest run src --pool=forks && pnpm exec biome check src/billings test/scheduling test/billings test/invites`
Expected: 0 type errors; unit tests at baseline (only the 6 email failures); Biome 0 errors.

- [ ] **Step 6: No commit** (user rule).

---

### Task 5: Pausar/Encerrar with `pendingCharges` (API)

**Files:**
- Modify: `packages/api/src/billings/errors.ts` (new `PendingChargesWithoutStateError`)
- Modify: `packages/api/src/api.ts` (`httpErrors`, next to the other 422 classes such as `ProofInvalidFileError`)
- Modify: `packages/api/src/billings/utils/body.ts` (`PatchBody.pendingCharges`)
- Modify: `packages/api/src/billings/repositories/billing.ts` — `cancelPendingCharges` (~413), `assertPatchAllowed` (~433), `patch` (~957-959), new `settlePendingCharges`
- Create (integration): `packages/api/test/billings/month-materialized.spec.ts`

**Interfaces:**
- Consumes: `PendingChargesAction` (Task 1), `endOfMonth`
- Produces:
  - `class PendingChargesWithoutStateError extends UnprocessableEntityError` (code `PENDING_CHARGES_WITHOUT_STATE`)
  - `cancelPendingCharges(db: DbClient, ownerId: string, billingId: string, now: string, reason: string, after?: string): Promise<void>`
  - test helpers in `month-materialized.spec.ts`: `recurring(key, startDate, userIds, overrides?)`, `chargeRows(billingId)` (Task 6 appends tests to this file)

- [ ] **Step 1: Write the integration spec (`test/billings/month-materialized.spec.ts`)**

```ts
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import {
  type BillingInput,
  BillingFrequency,
  BillingState,
  BillingType,
  PendingChargesAction,
  PixKeyType,
  SplitMode,
  type SplitParty,
  SplitPartKind
} from '@receivy/common';
import { PendingChargesWithoutStateError } from '../../src/billings/errors';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { cleanupUsers, createUser, db } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = 'b6666666-6666-4666-8666-666666666666';
const TZ = 'America/Sao_Paulo';
const date = (value: string) => new Date(`${value}T12:00:00Z`);
const { context, sent } = fakeNotice();

let pixId: string;
let anaId: string;
let brunoId: string;
let carlaId: string;

function recurring(key: string, startDate: string, userIds: string[], overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Indefinite,
    frequency: BillingFrequency.Monthly,
    description: key,
    totalCents: 10_000,
    startDate,
    timezone: TZ,
    paymentMethodId: pixId,
    split: { mode: SplitMode.Equal, parts: userIds.map((userId): SplitParty => ({ kind: SplitPartKind.User, userId })) },
    ...overrides
  };
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, due_date: true, state: true, amount_cents: true, debtor_user_id: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return records;
}

describe('month materialized: pending charges and current month edits', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'month-owner@example.com', name: 'Dona' });

    anaId = (await ContactRepository.save(db, OWNER, { name: 'Ana', email: 'month-ana@example.com' })).userId;
    brunoId = (await ContactRepository.save(db, OWNER, { name: 'Bruno', email: 'month-bruno@example.com' })).userId;
    carlaId = (await ContactRepository.save(db, OWNER, { name: 'Carla', email: 'month-carla@example.com' })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER]));

  it('creates the whole month of a recorrente at creation and leaves it to the reminder', async () => {
    sent.reset();

    const billing = await BillingRepository.create(db, OWNER, 'month-create', recurring('Aluguel', '2026-03-20', [anaId]), date('2026-03-05'), undefined, context);

    deepEqual(
      billing.charges.map((charge) => charge.dueDate),
      ['2026-03-20']
    );
    equal(sent.emails.length, 0, 'the charge meets Ana through its reminder');
    equal(billing.nextMaterialization, '2026-04-01');
  });

  it('announces only the installment due today', async () => {
    sent.reset();

    const billing = await BillingRepository.create(
      db,
      OWNER,
      'month-installments',
      { ...recurring('Curso', '2026-03-05', [anaId]), type: BillingType.Until, endDate: '2026-05-05' },
      date('2026-03-05'),
      undefined,
      context
    );

    equal(billing.charges.length, 3);
    equal(sent.emails.length, 1);
  });

  it('keeps this month on Keep and cancels every pending charge on Cancel', async () => {
    const kept = await BillingRepository.create(db, OWNER, 'month-pause-keep', recurring('Mantida', '2026-03-20', [anaId]), date('2026-03-05'));

    await BillingRepository.patch(db, OWNER, kept.id, { state: BillingState.Paused, pendingCharges: PendingChargesAction.Keep }, date('2026-03-06'));
    deepEqual(
      (await chargeRows(kept.id)).map((row) => row.state),
      ['pending']
    );

    const dropped = await BillingRepository.create(db, OWNER, 'month-pause-cancel', recurring('Cancelada', '2026-03-20', [anaId]), date('2026-03-05'));

    await BillingRepository.patch(db, OWNER, dropped.id, { state: BillingState.Paused, pendingCharges: PendingChargesAction.Cancel }, date('2026-03-06'));

    const [row] = await chargeRows(dropped.id);

    ok(row);
    equal(row.state, 'cancelled');
    deepEqual((await EventRepository.list(db, row.id, 'charge.cancelled'))[0]?.payload, { reason: 'billing_paused' });

    const course = await BillingRepository.create(
      db,
      OWNER,
      'month-end-keep',
      { ...recurring('Curso', '2026-03-20', [anaId]), type: BillingType.Until, endDate: '2026-05-20' },
      date('2026-03-05')
    );

    await BillingRepository.patch(db, OWNER, course.id, { state: BillingState.Ended, pendingCharges: PendingChargesAction.Keep }, date('2026-03-06'));
    deepEqual(
      (await chargeRows(course.id)).map((charge) => [charge.due_date, charge.state]),
      [
        ['2026-03-20', 'pending'],
        ['2026-04-20', 'cancelled'],
        ['2026-05-20', 'cancelled']
      ]
    );

    await rejects(
      () => BillingRepository.patch(db, OWNER, kept.id, { pendingCharges: PendingChargesAction.Cancel }, date('2026-03-06')),
      PendingChargesWithoutStateError
    );
  });
});
```

`brunoId` and `carlaId` are used by Task 6; if Biome flags them as unused now, leave them (Task 6 uses them) or prefix with `_` only until Task 6 lands.

- [ ] **Step 2: Typecheck the spec (fails)**

Run: `cd packages/api && pnpm run check-types:test`
Expected: FAIL — `PendingChargesWithoutStateError` not exported.

- [ ] **Step 3: Error class (`billings/errors.ts`)**

Change the first import to `import { ConflictError, UnprocessableEntityError } from '../common/errors';` and add:

```ts
export class PendingChargesWithoutStateError extends UnprocessableEntityError {
  constructor(message = 'Escolha pausar ou encerrar para decidir sobre as cobranças pendentes.') {
    super(message, 'PENDING_CHARGES_WITHOUT_STATE');
  }
}
```

Import it in `src/api.ts` and list it in `httpErrors` next to the other `UnprocessableEntityError` subclasses.

- [ ] **Step 4: Body (`billings/utils/body.ts`)**

Add `PendingChargesAction` to the `import type { ... } from '@receivy/common'` list and, in `PatchBody` after `state?: BillingState;`:

```ts
  pendingCharges?: PendingChargesAction;
```

- [ ] **Step 5: Repository (`billings/repositories/billing.ts`)**

Add `PendingChargesAction` (value import) to the `@receivy/common` list and `PendingChargesWithoutStateError` to the `../errors` list.

Replace `cancelPendingCharges`:

```ts
async function cancelPendingCharges(db: DbClient, ownerId: string, billingId: string, now: string, reason: string, after?: string) {
  const pending = await db.charges.findMany({
    select: ChargeRepository.SELECT,
    where: { billing_id: billingId, state: ChargeState.Pending, ...(after ? { due_date: { gt: after } } : {}) },
    lock: true
  });

  for (const row of pending.records) {
    await db.charges.updateOne({ where: { id: row.id }, data: { state: ChargeState.Cancelled, cancelled_at: now, updated_at: now } });
    await EventRepository.record(db, {
      type: 'charge.cancelled',
      eventableType: EventableType.Charge,
      eventableId: row.id,
      actorId: ownerId,
      payload: { reason },
      at: now
    });
  }
}

/** Pausar keeps and Encerrar cancels by default; Keep only drops what falls after this month, Cancel drops every pending charge. */
async function settlePendingCharges(db: DbClient, ownerId: string, billingId: string, patch: BillingPatch, today: string, now: string) {
  const ended = patch.state === BillingState.Ended;
  const reason = ended ? 'billing_ended' : 'billing_paused';
  const action = patch.pendingCharges ?? (ended ? PendingChargesAction.Cancel : PendingChargesAction.Keep);

  if (action === PendingChargesAction.Cancel) {
    await cancelPendingCharges(db, ownerId, billingId, now, reason);
    return;
  }

  await cancelPendingCharges(db, ownerId, billingId, now, reason, endOfMonth(today));
}
```

In `assertPatchAllowed`, right after the `BillingEndedError` guard:

```ts
  const settles = patch.state === BillingState.Paused || patch.state === BillingState.Ended;

  if (patch.pendingCharges !== undefined && !settles) {
    throw new PendingChargesWithoutStateError();
  }
```

In `patch`, replace

```ts
      if (patch.state === BillingState.Ended) {
        await cancelPendingCharges(tx, ownerId, id, instant);
      }
```

with

```ts
      if (patch.state === BillingState.Paused || patch.state === BillingState.Ended) {
        await settlePendingCharges(tx, ownerId, id, patch, today, instant);
      }
```

- [ ] **Step 6: Verify**

Run: `cd packages/api && pnpm run check-types && pnpm run check-types:test && pnpm exec vitest run src --pool=forks && pnpm exec biome check src/billings src/api.ts test/billings`
Expected: 0 type errors; unit tests at baseline; Biome 0 errors.

- [ ] **Step 7: No commit** (user rule).

---

### Task 6: Edit with `applyTo` (API)

**Files:**
- Create: `packages/api/src/billings/services/month-scope.ts`
- Create: `packages/api/src/billings/services/month-scope.test.ts`
- Modify: `packages/api/src/billings/errors.ts` (new `EditScopeNotRecurringError`), `src/api.ts` (`httpErrors`)
- Modify: `packages/api/src/billings/utils/body.ts` (`PatchBody.applyTo`)
- Modify: `packages/api/src/billings/repositories/billing.ts` — `assertPatchAllowed`, new `rewriteMonthCharges`, `patch`
- Modify (integration): `packages/api/test/billings/month-materialized.spec.ts` (tests appended inside the `describe`)
- Modify: `docs/api-errors.md`, regenerate `docs/api-oas.yml`

**Interfaces:**
- Consumes: `EditScope` (Task 1), `cancelPendingCharges`-style event shape (Task 5), `recurring`/`chargeRows` (Task 5 spec)
- Produces:
  - `type MonthCharge = { id: string; debtorUserId: string | null; dueDate: string }`
  - `type MonthChanges = { update: { charge: MonthCharge; planned: PlannedCharge }[]; cancel: MonthCharge[]; create: PlannedCharge[] }`
  - `monthChanges(existing: MonthCharge[], planned: PlannedCharge[]): MonthChanges`
  - `class EditScopeNotRecurringError extends UnprocessableEntityError` (code `EDIT_SCOPE_NOT_RECURRING`)

- [ ] **Step 1: Failing unit test (`month-scope.test.ts`)**

```ts
import type { PlannedCharge } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { monthChanges } from './month-scope';

function planned(userId: string | null, amountCents: number): PlannedCharge {
  return { userId, description: 'Aluguel', amountCents, currency: 'BRL', dueDate: '2026-03-25', installment: null, installmentCount: null };
}

describe('monthChanges', () => {
  it('updates the same person, cancels who left and creates who joined', () => {
    const existing = [
      { id: 'c-ana', debtorUserId: 'ana', dueDate: '2026-03-20' },
      { id: 'c-bruno', debtorUserId: 'bruno', dueDate: '2026-03-20' }
    ];

    const changes = monthChanges(existing, [planned('ana', 6_000), planned('carla', 6_000)]);

    expect(changes.update).toEqual([{ charge: existing[0], planned: planned('ana', 6_000) }]);
    expect(changes.cancel).toEqual([existing[1]]);
    expect(changes.create).toEqual([planned('carla', 6_000)]);
  });

  it('pairs a conta a pagar without payee by the empty debtor', () => {
    const existing = [{ id: 'c-owner', debtorUserId: null, dueDate: '2026-03-20' }];

    expect(monthChanges(existing, [planned(null, 9_000)])).toEqual({
      update: [{ charge: existing[0], planned: planned(null, 9_000) }],
      cancel: [],
      create: []
    });
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/api && pnpm exec vitest run src/billings/services/month-scope.test.ts --pool=forks`
Expected: FAIL — cannot resolve `./month-scope`.

- [ ] **Step 3: Implement `month-scope.ts`**

```ts
import type { PlannedCharge } from '@receivy/common';

export type MonthCharge = { id: string; debtorUserId: string | null; dueDate: string };

export type MonthChanges = {
  update: { charge: MonthCharge; planned: PlannedCharge }[];
  cancel: MonthCharge[];
  create: PlannedCharge[];
};

/** Pairs this month's editable charges with the new plan by person: the same person updates, a missing one cancels, a new one creates. */
export function monthChanges(existing: MonthCharge[], planned: PlannedCharge[]): MonthChanges {
  const changes: MonthChanges = { update: [], cancel: [], create: [] };

  for (const charge of existing) {
    const match = planned.find((item) => item.userId === charge.debtorUserId);

    if (!match) {
      changes.cancel.push(charge);
      continue;
    }

    changes.update.push({ charge, planned: match });
  }

  for (const item of planned) {
    if (!existing.some((charge) => charge.debtorUserId === item.userId)) {
      changes.create.push(item);
    }
  }

  return changes;
}
```

Run the unit test again: PASS.

- [ ] **Step 4: Append the integration tests to `month-materialized.spec.ts` (inside the `describe`, after the Task 5 tests)**

Add `EditScope` to the `@receivy/common` import, `EditScopeNotRecurringError` to the `../../src/billings/errors` import, and `StoredProofState` from `../../src/charges/schemas/charge`.

```ts
  it('rewrites the not yet due charges of this month on CurrentMonth', async () => {
    sent.reset();

    const billing = await BillingRepository.create(db, OWNER, 'month-edit', recurring('Casa', '2026-03-20', [anaId, brunoId]), date('2026-03-05'));
    const [anaCharge] = (await chargeRows(billing.id)).filter((row) => row.debtor_user_id === anaId);

    ok(anaCharge);

    await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      {
        totalCents: 12_000,
        split: { mode: SplitMode.Equal, parts: [anaId, carlaId].map((userId): SplitParty => ({ kind: SplitPartKind.User, userId })) },
        applyTo: EditScope.CurrentMonth
      },
      date('2026-03-06'),
      undefined,
      context
    );

    const rows = await chargeRows(billing.id);
    const ana = rows.find((row) => row.debtor_user_id === anaId);
    const bruno = rows.find((row) => row.debtor_user_id === brunoId);
    const carla = rows.find((row) => row.debtor_user_id === carlaId);

    equal(ana?.id, anaCharge.id, 'the charge keeps its id and public link');
    equal(ana?.amount_cents, 6_000);
    equal(bruno?.state, 'cancelled');
    deepEqual((await EventRepository.list(db, bruno!.id, 'charge.cancelled'))[0]?.payload, { reason: 'billing_edited' });
    equal(carla?.state, 'pending');
    equal(carla?.amount_cents, 6_000);
    equal((await EventRepository.list(db, anaCharge.id, 'charge.edited')).length, 1);
    equal(sent.emails.length, 0, 'Carla meets her charge through the reminder');
  });

  it('leaves charges due today or with a proof under review, and NextMonth touches nothing', async () => {
    const today = await BillingRepository.create(db, OWNER, 'month-today', recurring('Hoje', '2026-03-05', [anaId]), date('2026-03-05'));

    await BillingRepository.patch(db, OWNER, today.id, { totalCents: 5_000, applyTo: EditScope.CurrentMonth }, date('2026-03-05'));
    equal((await chargeRows(today.id))[0]?.amount_cents, 10_000);

    const reviewed = await BillingRepository.create(db, OWNER, 'month-review', recurring('Revisão', '2026-03-20', [anaId]), date('2026-03-05'));
    const [row] = await chargeRows(reviewed.id);

    await db.charges.updateOne({ where: { id: row!.id }, data: { proof_state: StoredProofState.Pending } });
    await BillingRepository.patch(db, OWNER, reviewed.id, { totalCents: 5_000, applyTo: EditScope.CurrentMonth }, date('2026-03-06'));
    equal((await chargeRows(reviewed.id))[0]?.amount_cents, 10_000);

    const later = await BillingRepository.create(db, OWNER, 'month-next', recurring('Depois', '2026-03-20', [anaId]), date('2026-03-05'));

    await BillingRepository.patch(db, OWNER, later.id, { totalCents: 5_000, applyTo: EditScope.NextMonth }, date('2026-03-06'));
    equal((await chargeRows(later.id))[0]?.amount_cents, 10_000);
  });

  it('moves the due day inside the month and skips a person whose cancelled charge holds the date', async () => {
    const moved = await BillingRepository.create(db, OWNER, 'month-move', recurring('Mudou', '2026-03-20', [anaId]), date('2026-03-05'));
    const [before] = await chargeRows(moved.id);

    await BillingRepository.patch(db, OWNER, moved.id, { startDate: '2026-03-25', applyTo: EditScope.CurrentMonth }, date('2026-03-06'));

    const after = await chargeRows(moved.id);

    equal(after.length, 1, 'the month never gets a second charge');
    equal(after[0]?.id, before!.id);
    equal(after[0]?.due_date, '2026-03-25');

    const back = await BillingRepository.create(db, OWNER, 'month-back', recurring('Volta', '2026-03-20', [anaId, brunoId]), date('2026-03-05'));
    const onlyAna = { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } satisfies BillingInput['split'];
    const both = { mode: SplitMode.Equal, parts: [anaId, brunoId].map((userId): SplitParty => ({ kind: SplitPartKind.User, userId })) };

    await BillingRepository.patch(db, OWNER, back.id, { split: onlyAna, applyTo: EditScope.CurrentMonth }, date('2026-03-06'));
    await BillingRepository.patch(db, OWNER, back.id, { split: both, applyTo: EditScope.CurrentMonth }, date('2026-03-07'));

    const brunoRows = (await chargeRows(back.id)).filter((row) => row.debtor_user_id === brunoId);

    deepEqual(
      brunoRows.map((row) => row.state),
      ['cancelled']
    );
  });

  it('refuses applyTo on a finite billing', async () => {
    const course = await BillingRepository.create(
      db,
      OWNER,
      'month-finite-scope',
      { ...recurring('Curso', '2026-03-20', [anaId]), type: BillingType.Until, endDate: '2026-04-20' },
      date('2026-03-05')
    );

    await rejects(
      () => BillingRepository.patch(db, OWNER, course.id, { category: undefined, applyTo: EditScope.CurrentMonth }, date('2026-03-06')),
      EditScopeNotRecurringError
    );
  });
```

Run: `cd packages/api && pnpm run check-types:test` — Expected: FAIL (`EditScopeNotRecurringError` missing).

- [ ] **Step 5: Error, body and guard**

`billings/errors.ts`:

```ts
export class EditScopeNotRecurringError extends UnprocessableEntityError {
  constructor(message = 'Só contas recorrentes aplicam a edição às cobranças do mês.') {
    super(message, 'EDIT_SCOPE_NOT_RECURRING');
  }
}
```

List it in `src/api.ts` `httpErrors` next to `PendingChargesWithoutStateError`.

`body.ts`: add `EditScope` to the type import and `applyTo?: EditScope;` after `pendingCharges`.

`assertPatchAllowed`, after the `PendingChargesWithoutStateError` guard:

```ts
  if (patch.applyTo !== undefined && row.type !== BillingType.Indefinite) {
    throw new EditScopeNotRecurringError();
  }
```

- [ ] **Step 6: `rewriteMonthCharges` in `billing.ts`**

Imports: add `EditScope` (value) to the `@receivy/common` list, `EditScopeNotRecurringError` to `../errors`, `StoredProofState` from `../../charges/schemas/charge`, and `monthChanges`, `type MonthCharge` from `../services/month-scope`. Place the function after `settlePendingCharges`:

```ts
/** EditScope.CurrentMonth: this month's charges that are not due yet follow the edit; returns the created charge ids to announce. */
async function rewriteMonthCharges(db: DbClient, row: BillingRepository.Row, today: string, now: string): Promise<string[]> {
  const monthEnd = endOfMonth(today);
  const { records } = await db.charges.findMany({
    select: ChargeRepository.SELECT,
    where: { billing_id: row.id, state: ChargeState.Pending, due_date: { gt: today, lte: monthEnd } },
    lock: true
  });
  const editable = records.filter((charge) => !charge.proof_state || charge.proof_state === StoredProofState.Rejected);

  if (!editable.length) {
    return [];
  }

  // Monthly and yearly rules have one occurrence per month: the new day inside the month, or the current one.
  const dueDate = billingDates(calendarRule(row), addCalendarDays(today, 1), monthEnd, 1)[0] ?? editable[0]!.due_date;
  const { split } = await BillingRepository.splitFor(db, row.id);
  const payable = payableOf(row);
  const counterparts = payable ? (row.payee_user_id ? [row.payee_user_id] : []) : userIds(split);
  const context = await prepareChargeMaterialization(db, row.owner_id, counterparts, row.payment_method_id, payable);
  const plan = planBillingCharges({
    description: row.description,
    totalCents: row.total_cents,
    split,
    dueDates: [dueDate],
    numbered: false,
    payer: context.payer,
    payeeUserId: row.payee_user_id ?? null
  });
  const existing: MonthCharge[] = editable.map((charge) => ({ id: charge.id, debtorUserId: charge.debtor_user_id ?? null, dueDate: charge.due_date }));
  const changes = monthChanges(existing, plan.charges);

  for (const { charge, planned } of changes.update) {
    const moving = planned.dueDate !== charge.dueDate;
    const blocked = moving && (await db.charges.count({ where: { billing_id: row.id, debtor_user_id: charge.debtorUserId ?? sqlNull, due_date: planned.dueDate } }));

    if (blocked) {
      continue;
    }

    await db.charges.updateOne({
      where: { id: charge.id },
      data: {
        description: planned.description,
        amount_cents: planned.amountCents,
        due_date: planned.dueDate,
        pix_key_type_snapshot: context.pix?.keyType ?? sqlNull,
        pix_key_snapshot: context.pix?.key ?? sqlNull,
        pix_label_snapshot: context.pix?.label ?? sqlNull,
        updated_at: now
      }
    });
    await EventRepository.record(db, { type: 'charge.edited', eventableType: EventableType.Charge, eventableId: charge.id, actorId: row.owner_id, at: now });
  }

  for (const charge of changes.cancel) {
    await db.charges.updateOne({ where: { id: charge.id }, data: { state: ChargeState.Cancelled, cancelled_at: now, updated_at: now } });
    await EventRepository.record(db, {
      type: 'charge.cancelled',
      eventableType: EventableType.Charge,
      eventableId: charge.id,
      actorId: row.owner_id,
      payload: { reason: 'billing_edited' },
      at: now
    });
  }

  const creatable: typeof plan.charges = [];

  for (const planned of changes.create) {
    // A cancelled charge of the same person on the same date holds the unique index: the person joins next month.
    const taken = await db.charges.count({ where: { billing_id: row.id, debtor_user_id: planned.userId ?? sqlNull, due_date: planned.dueDate } });

    if (!taken) {
      creatable.push(planned);
    }
  }

  if (!creatable.length) {
    return [];
  }

  const persisted = await persistChargePlan(db, row.owner_id, { ...plan, charges: creatable }, { id: row.id, type: BillingType.Indefinite }, context, now);

  return persisted.noticeChargeIds;
}
```

If the `count` `where` does not accept `sqlNull` for a null debtor, use `debtor_user_id: { isNull: true }` for that branch. If `context.pix` has no `label`, drop `pix_label_snapshot` from the update the same way `persistChargePlan` builds it.

- [ ] **Step 7: Call it from `patch`**

Before `const detail = await db.transaction(...)`:

```ts
    const noticeChargeIds: string[] = [];
```

After `settlePendingCharges` and before `audit(...)`:

```ts
      if (patch.applyTo === EditScope.CurrentMonth) {
        noticeChargeIds.push(...(await rewriteMonthCharges(tx, await billingRow(tx, ownerId, id), today, instant)));
      }
```

After the transaction, before the existing `materializeDue` block:

```ts
    if (notice && noticeChargeIds.length) {
      await announceCharges(db, notice, noticeChargeIds, now.getTime());
    }
```

- [ ] **Step 8: Docs**

`docs/api-errors.md`, after the "How a domain error is declared" section, add:

```md
## Billing scope errors

| Code | Status | When |
|---|---|---|
| `PENDING_CHARGES_WITHOUT_STATE` | 422 | `PATCH /billings/{id}` sends `pendingCharges` without `state` `paused`/`ended` |
| `EDIT_SCOPE_NOT_RECURRING` | 422 | `PATCH /billings/{id}` sends `applyTo` for a Única or Parcelado billing |
```

Regenerate: `pnpm --filter @receivy/api openapi:generate && pnpm --filter @receivy/api openapi:check`.

- [ ] **Step 9: Verify**

Run: `cd packages/api && pnpm run check-types && pnpm run check-types:test && pnpm exec vitest run src --pool=forks && pnpm exec biome check src/billings src/api.ts test/billings && pnpm run openapi:check`
Expected: 0 type errors; unit tests at baseline plus the new `month-scope` and `planner` tests passing; Biome 0 errors; "OpenAPI matches".

- [ ] **Step 10: No commit** (user rule).

---

### Task 7: Web scope dialog and Pausar/Encerrar

**Files:**
- Create: `packages/web/src/components/app/scope-dialog.tsx`
- Create: `packages/web/src/components/app/scope-dialog.test.tsx`
- Modify: `packages/web/src/components/screens/billing-detail-screen.tsx` — imports, state (~181), `transition` (~262-277), action tiles (~476-485), dialogs (~781-792)
- Test: `packages/web/src/components/screens/billing-detail-screen.test.tsx` (~309-360)

**Interfaces:**
- Consumes: `PendingChargesAction` (Task 1), `pendingChargesOf` (Task 2)
- Produces: `ScopeDialog(props: ScopeDialogProps)` with
  `type ScopeDialogProps = { title: string; subtitle?: string; icon: LucideIcon; explanation: string; primaryLabel: string; secondaryLabel: string; secondaryTone?: "danger" | "neutral"; busy?: boolean; onPrimary: () => void; onSecondary: () => void; onCancel: () => void }`

- [ ] **Step 1: Failing component test (`scope-dialog.test.tsx`)**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CirclePause } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { ScopeDialog } from "@/components/app/scope-dialog";

afterEach(cleanup);

it("offers two scoped actions and a way back", async () => {
  const onPrimary = vi.fn();
  const onSecondary = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();

  render(<ScopeDialog title="Pausar conta?" icon={CirclePause} explanation="E as pendentes?" primaryLabel="Manter as deste mês" secondaryLabel="Cancelar pendentes (2)" secondaryTone="danger" onPrimary={onPrimary} onSecondary={onSecondary} onCancel={onCancel} />);

  expect(screen.getByRole("dialog", { name: "Pausar conta?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Voltar" })).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Manter as deste mês" }));
  await user.click(screen.getByRole("button", { name: "Cancelar pendentes (2)" }));
  await user.keyboard("{Escape}");

  expect(onPrimary).toHaveBeenCalledTimes(1);
  expect(onSecondary).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

Run: `pnpm --filter @receivy/web exec vitest run src/components/app/scope-dialog.test.tsx` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `scope-dialog.tsx`** (same shell as `components/ui/confirm-dialog.tsx`)

```tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

type ScopeDialogProps = {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  explanation: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** "danger" when the second action cancels charges; "neutral" when it only narrows the scope. */
  secondaryTone?: "danger" | "neutral";
  busy?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onCancel: () => void;
};

const SECONDARY_STYLES = {
  danger: "bg-red-600 text-white",
  neutral: "border border-outline/50 bg-surface text-ink",
} as const;

/** A choice with two outcomes plus Voltar: Pausar, Encerrar and the scope of a recorrente edit. */
export function ScopeDialog({ title, subtitle, icon: Icon, explanation, primaryLabel, secondaryLabel, secondaryTone = "neutral", busy = false, onPrimary, onSecondary, onCancel }: ScopeDialogProps) {
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    back.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4"
      role="presentation"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="scope-dialog-title" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-outline/30 bg-surface p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="scope-dialog-title" className="m-0 text-[17px] font-bold text-ink">
              {title}
            </h2>
            {subtitle && <p className="m-0 text-[11px] text-muted">{subtitle}</p>}
          </div>
        </div>
        <p className="m-0 text-xs leading-5 text-muted">{explanation}</p>
        <div className="flex flex-col gap-2.5 pt-1">
          <button type="button" disabled={busy} onClick={onPrimary} className="h-11 rounded-xl bg-primary text-sm font-semibold text-white transition hover:bg-primary-strong disabled:opacity-50">
            {primaryLabel}
          </button>
          <button type="button" disabled={busy} onClick={onSecondary} className={`h-11 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${SECONDARY_STYLES[secondaryTone]}`}>
            {secondaryLabel}
          </button>
          <button ref={back} type="button" onClick={onCancel} className="h-11 rounded-xl text-sm font-semibold text-muted">
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
```

Run the test: PASS.

- [ ] **Step 3: Update the detail screen tests (fail first)**

In `billing-detail-screen.test.tsx`, add `PendingChargesAction` to the `@receivy/common` import and this helper after `open`:

```tsx
function patchBodies(): unknown[] {
  return vi
    .mocked(browserFetch)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)));
}
```

Replace `pauses and resumes only a subscription` and `ends only after confirmation…` with:

```tsx
it("asks what to do with the pending charges before pausing a subscription", async () => {
  await open(billing({ type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined }));
  const user = setup();

  expect(screen.getByText("Recorrente mensal")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Pausar" }));

  const dialog = await screen.findByRole("dialog", { name: "Pausar conta?" });
  expect(patchBodies()).toEqual([]);

  await user.click(within(dialog).getByRole("button", { name: "Manter as deste mês" }));

  expect(patchBodies()).toEqual([{ state: "paused", pendingCharges: PendingChargesAction.Keep }]);
  expect(await screen.findByRole("button", { name: "Retomar" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
});

it("pauses right away when nothing is pending", async () => {
  await open(billing({ type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined, charges: firstCycle }));
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Pausar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(patchBodies()).toEqual([{ state: "paused" }]);
});

it("ends cancelling the pending charges, revokes the invite and hides the actions", async () => {
  const calls = await open(billing({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } }));
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));

  expect(await screen.findByRole("dialog", { name: "Encerrar conta?" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Voltar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar pendentes (1)" }));

  expect(await screen.findByText("Encerrada")).toBeInTheDocument();
  expect(patchBodies()).toEqual([{ state: "ended", pendingCharges: PendingChargesAction.Cancel }]);
  expect(calls).toContain("DELETE /api/financial/billings/b1/invite");
  expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).not.toBeInTheDocument();
});

it("ends with the simple confirmation when nothing is pending", async () => {
  await open(billing({ charges: firstCycle }));
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  await user.click(within(await screen.findByRole("dialog", { name: "Encerrar conta?" })).getByRole("button", { name: "Encerrar" }));

  expect(await screen.findByText("Encerrada")).toBeInTheDocument();
  expect(patchBodies()).toEqual([{ state: "ended" }]);
});
```

Run: `pnpm --filter @receivy/web exec vitest run src/components/screens/billing-detail-screen.test.tsx` — Expected: FAIL (no scope dialog).

- [ ] **Step 4: Implement in `billing-detail-screen.tsx`**

Imports: add `pendingChargesOf, PendingChargesAction` to the `@receivy/common` import and `import { ScopeDialog } from "@/components/app/scope-dialog";`.

State, next to `confirmEnd`:

```tsx
  const [scope, setScope] = useState<"paused" | "ended" | null>(null);
```

`transition`:

```tsx
  async function transition(detail: BillingDetail, state: "active" | "paused" | "ended", pendingCharges?: PendingChargesAction) {
    await run(async () => {
      const body = pendingCharges ? { state, pendingCharges } : { state };
      const updated = await request<BillingDetail>(`/api/financial/billings/${detail.id}`, jsonInit("PATCH", body), "Não foi possível atualizar a cobrança.");

      setBilling(updated);
      setConfirmEnd(false);
      setScope(null);
```

(rest of the function unchanged).

Handlers, above the `return`:

```tsx
  function pause(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      void transition(detail, "paused");
      return;
    }

    setScope("paused");
  }

  function end(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      setConfirmEnd(true);
      return;
    }

    setScope("ended");
  }
```

Tiles: the Pausar/Retomar `onClick` becomes `onClick={() => (billing.state === "active" ? pause(billing) : void transition(billing, "active"))}`; Encerrar `onClick={() => end(billing)}`.

Next to the existing `confirmEnd` dialog, render:

```tsx
      {scope && (
        <ScopeDialog
          title={scope === "paused" ? "Pausar conta?" : "Encerrar conta?"}
          subtitle={scope === "ended" ? "Esta ação não pode ser desfeita." : undefined}
          icon={scope === "paused" ? CirclePause : CircleStop}
          explanation={scope === "paused" ? `Novas cobranças deixam de ser geradas. E as pendentes de “${billing.description}”?` : `Encerrar impede novas ocorrências de “${billing.description}”. E as pendentes?`}
          primaryLabel="Manter as deste mês"
          secondaryLabel={`Cancelar pendentes (${pendingChargesOf(billing).length})`}
          secondaryTone="danger"
          busy={busy}
          onPrimary={() => void transition(billing, scope, PendingChargesAction.Keep)}
          onSecondary={() => void transition(billing, scope, PendingChargesAction.Cancel)}
          onCancel={() => setScope(null)}
        />
      )}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: 0 type errors, lint exit 0, all tests pass (baseline 279 + new).

- [ ] **Step 6: No commit** (user rule).

---

### Task 8: Web edit asks for the scope

**Files:**
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx` — imports, `Attempt` type (~54), state (~215), `save` (~337-367), `patchBody` (~369-392), `submit` (~394-407), render before `</form>`
- Test: `packages/web/src/components/forms/billing-form-screen.test.tsx` (after the open-ended billing tests, ~725)

**Interfaces:**
- Consumes: `EditScope` (Task 1); `shouldAskEditScope`, `editableMonthCharges`, `editScopeExplanation` (Task 2); `ScopeDialog` (Task 7)

- [ ] **Step 1: Failing tests**

In the test file add `ChargeState, SharingState, type ChargeDetail` to the `@receivy/common` import and `vi.useRealTimers();` inside the existing `afterEach`. Append:

```tsx
const monthCharge: ChargeDetail = {
  id: "c9",
  description: "Jantar",
  amount: { amountCents: 9_000, currency: "BRL" },
  dueDate: "2026-09-20",
  state: ChargeState.Pending,
  billingId: "b2",
  billingType: BillingType.Indefinite,
  installment: null,
  installmentCount: null,
  counterpartName: "Ana",
  proofState: null,
  direction: Direction.Receivable,
  recipient: { userId: "u1", name: "Ana", email: null },
  debtorUserId: "u1",
  pix: null,
  sharingState: SharingState.Ready,
  proof: null,
  cancelledAt: null,
  paidAt: null,
  createdAt: "2026-09-01T00:00:00Z",
};

const recurringWithCharge: BillingDetail = { ...indefiniteBilling, startDate: "2026-09-20", charges: [monthCharge] };

function onSeptemberTenth() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-10T15:00:00Z"));
}

it("asks whether an amount change also reaches this month's charges", async () => {
  onSeptemberTenth();
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(recurringWithCharge) : undefined));
  const { user } = renderForm(recurringWithCharge);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Valor por ocorrência"));
  await user.type(screen.getByLabelText("Valor por ocorrência"), "12000");
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const dialog = await screen.findByRole("dialog", { name: "Aplicar às cobranças deste mês?" });

  expect(within(dialog).getByText("1 cobrança de setembro ainda não venceu.")).toBeInTheDocument();
  expect(sent.some(entry => entry.init.method === "PATCH")).toBe(false);

  await user.click(within(dialog).getByRole("button", { name: "Aplicar também às deste mês" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");
  expect(JSON.parse(String(patch?.init.body))).toMatchObject({ totalCents: 12_000, applyTo: "current_month" });
});

it("sends no scope when the owner keeps this month as it is", async () => {
  onSeptemberTenth();
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(recurringWithCharge) : undefined));
  const { user } = renderForm(recurringWithCharge);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Valor por ocorrência"));
  await user.type(screen.getByLabelText("Valor por ocorrência"), "12000");
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Só a partir do mês seguinte" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");
  expect(JSON.parse(String(patch?.init.body)).applyTo).toBeUndefined();
});

it("saves an untouched recurring billing without asking", async () => {
  onSeptemberTenth();
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(recurringWithCharge) : undefined));
  const { user } = renderForm(recurringWithCharge);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(sent.some(entry => entry.init.method === "PATCH")).toBe(true);
});
```

Run: `pnpm --filter @receivy/web exec vitest run src/components/forms/billing-form-screen.test.tsx` — Expected: the first two FAIL (no dialog).

If "saves an untouched recurring billing" fails because the draft round-trip differs from the billing (for example the start date or split shape), fix the comparison in `patchTouchesCharges` (Task 2) rather than the form, and add the case to `billing-scope.test.ts`.

- [ ] **Step 2: Implement**

Imports: add `EditScope, editableMonthCharges, editScopeExplanation, shouldAskEditScope, type BillingPatch` to the `@receivy/common` import, `CalendarClock` to the `lucide-react` import, and `import { ScopeDialog } from "@/components/app/scope-dialog";`.

```tsx
type Attempt = { input: BillingInput; key: string; uncertain: boolean; applyTo?: EditScope };
```

State next to `attempt`:

```tsx
  const [scopeAttempt, setScopeAttempt] = useState<Attempt | null>(null);
```

In `save`, the PATCH body becomes:

```tsx
            body: JSON.stringify(sent.applyTo ? { ...patchBody(sent.input), applyTo: sent.applyTo } : patchBody(sent.input)),
```

`patchBody` gets a return type and the enum default:

```tsx
  function patchBody(input: BillingInput): BillingPatch {
```

and its last line uses `dueRule: input.dueRule ?? BillingDueRule.Fixed`.

`submit`, inside the `try`:

```tsx
    try {
      const next: Attempt = { input: buildBillingInput(draft), key: crypto.randomUUID(), uncertain: false };

      // Only a recorrente edit that changes what its charges carry, with charges of this month still ahead, needs the answer.
      if (billing && shouldAskEditScope(billing, patchBody(next.input), todayIn(billing.timezone))) {
        setScopeAttempt(next);
        return;
      }

      void save(next);
    } catch (reason) {
```

Handlers above the `return`:

```tsx
  function applyScope(applyTo?: EditScope) {
    if (!scopeAttempt) {
      return;
    }

    const sent = applyTo ? { ...scopeAttempt, applyTo } : scopeAttempt;

    setScopeAttempt(null);
    void save(sent);
  }
```

Right before `</form>`:

```tsx
      {scopeAttempt && billing && (
        <ScopeDialog
          title="Aplicar às cobranças deste mês?"
          icon={CalendarClock}
          explanation={editScopeExplanation(editableMonthCharges(billing, todayIn(billing.timezone)).length, todayIn(billing.timezone))}
          primaryLabel="Aplicar também às deste mês"
          secondaryLabel="Só a partir do mês seguinte"
          busy={busy}
          onPrimary={() => applyScope(EditScope.CurrentMonth)}
          onSecondary={() => applyScope()}
          onCancel={() => setScopeAttempt(null)}
        />
      )}
```

The retry path (`locked && attempt`) keeps working: `attempt` carries `applyTo`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: 0 type errors, lint exit 0, all tests pass.

- [ ] **Step 4: No commit** (user rule).

---

### Task 9: Mobile scope modal and Pausar/Encerrar

**Files:**
- Create: `packages/mobile/src/components/app/scope-modal.tsx`
- Create: `packages/mobile/src/components/app/scope-modal.test.tsx`
- Modify: `packages/mobile/src/components/screens/billing-detail-screen.tsx` — imports, state (~196), `transition` (~280-293), tiles (~490-499), end modal (~799-835)
- Test: `packages/mobile/src/components/screens/billing-detail-screen.test.tsx` (~298-345)

**Interfaces:**
- Consumes: `PendingChargesAction` (Task 1), `pendingChargesOf` (Task 2)
- Produces: `ScopeModal(props: ScopeModalProps)` with
  `type ScopeModalProps = { title: string; subtitle?: string; explanation: string; primaryLabel: string; secondaryLabel: string; secondaryTone?: "danger" | "neutral"; busy?: boolean; onPrimary: () => void; onSecondary: () => void; onCancel: () => void }`

- [ ] **Step 1: Failing component test (`scope-modal.test.tsx`)**

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ScopeModal } from "@/components/app/scope-modal";

describe("ScopeModal", () => {
  it("offers two scoped actions and a way back", async () => {
    const onPrimary = jest.fn();
    const onSecondary = jest.fn();
    const onCancel = jest.fn();

    await render(<ScopeModal title="Pausar conta?" explanation="E as pendentes?" primaryLabel="Manter as deste mês" secondaryLabel="Cancelar pendentes (2)" secondaryTone="danger" onPrimary={onPrimary} onSecondary={onSecondary} onCancel={onCancel} />);

    expect(screen.getByRole("header", { name: "Pausar conta?" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Manter as deste mês" }));
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar pendentes (2)" }));
    await fireEvent.press(screen.getByRole("button", { name: "Voltar" }));

    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm --filter @receivy/mobile exec jest src/components/app/scope-modal.test.tsx` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `scope-modal.tsx`** (same shell as the current Encerrar modal)

```tsx
import { Modal, Pressable, Text, View } from "react-native";

type ScopeModalProps = {
  title: string;
  subtitle?: string;
  explanation: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** "danger" when the second action cancels charges; "neutral" when it only narrows the scope. */
  secondaryTone?: "danger" | "neutral";
  busy?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onCancel: () => void;
};

const SECONDARY = {
  danger: { button: "bg-red-600", label: "text-white" },
  neutral: { button: "border border-outline", label: "text-ink" },
} as const;

/** A choice with two outcomes plus Voltar: Pausar, Encerrar and the scope of a recorrente edit. */
export function ScopeModal({ title, subtitle, explanation, primaryLabel, secondaryLabel, secondaryTone = "neutral", busy = false, onPrimary, onSecondary, onCancel }: ScopeModalProps) {
  const secondary = SECONDARY[secondaryTone];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full max-w-xs gap-3 rounded-2xl border border-outline/40 bg-surface p-5">
          <Text accessibilityRole="header" className="text-center text-lg font-semibold text-ink">
            {title}
          </Text>
          {subtitle ? <Text className="text-center text-[11px] text-muted">{subtitle}</Text> : null}
          <Text className="text-center text-xs leading-4 text-muted">{explanation}</Text>
          <View className="gap-2 pt-1">
            <Pressable accessibilityRole="button" accessibilityLabel={primaryLabel} disabled={busy} onPress={onPrimary} className="h-11 items-center justify-center rounded-lg bg-primary">
              <Text className="text-xs font-semibold text-white">{primaryLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={secondaryLabel} disabled={busy} onPress={onSecondary} className={`h-11 items-center justify-center rounded-lg ${secondary.button}`}>
              <Text className={`text-xs font-semibold ${secondary.label}`}>{secondaryLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={onCancel} className="h-11 items-center justify-center rounded-lg">
              <Text className="text-xs font-semibold text-muted">Voltar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

Run the test: PASS.

- [ ] **Step 3: Update the detail screen tests (fail first)**

Add `PendingChargesAction` to the `@receivy/common` import. Replace `pauses and resumes only a subscription` and `ends only after confirmation…` with:

```tsx
  it("asks what to do with the pending charges before pausing a subscription", async () => {
    const detail = billing({ type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined });
    const client = makeClient(detail, { patchBilling: jest.fn().mockResolvedValue({ ...detail, state: BillingState.Paused }) });

    await open(client);

    expect(screen.getByText("Recorrente mensal")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Pausar" }));

    expect(screen.getByRole("header", { name: "Pausar conta?" })).toBeOnTheScreen();
    expect(client.patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Manter as deste mês" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Paused, pendingCharges: PendingChargesAction.Keep }));
    expect(await screen.findByRole("button", { name: "Retomar" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
  });

  it("pauses right away when nothing is pending", async () => {
    const detail = billing({ type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined, charges: firstCycle });
    const client = makeClient(detail, { patchBilling: jest.fn().mockResolvedValue({ ...detail, state: BillingState.Paused }) });

    await open(client);
    await fireEvent.press(screen.getByRole("button", { name: "Pausar" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Paused }));
    expect(screen.queryByRole("header", { name: "Pausar conta?" })).toBeNull();
  });

  it("ends cancelling the pending charges, revokes the invite and hides the actions", async () => {
    const detail = billing({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } });
    const { client } = await open(makeClient(detail));

    await fireEvent.press(screen.getByRole("button", { name: "Encerrar" }));

    expect(screen.getByRole("header", { name: "Encerrar conta?" })).toBeOnTheScreen();
    expect(client.patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Cancelar pendentes (1)" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Ended, pendingCharges: PendingChargesAction.Cancel }));
    await waitFor(() => expect(client.revokeInvite).toHaveBeenCalledWith("b1"));
    expect(await screen.findByText("Encerrada")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).toBeNull();
  });

  it("ends with the simple confirmation when nothing is pending", async () => {
    const { client } = await open(makeClient(billing({ charges: firstCycle })));

    await fireEvent.press(screen.getByRole("button", { name: "Encerrar" }));
    await fireEvent.press(screen.getByRole("button", { name: "Confirmar encerramento" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Ended }));
  });
```

Run: `pnpm --filter @receivy/mobile exec jest src/components/screens/billing-detail-screen.test.tsx` — Expected: FAIL.

- [ ] **Step 4: Implement in `billing-detail-screen.tsx`**

Imports: add `pendingChargesOf, PendingChargesAction` to the `@receivy/common` import and `import { ScopeModal } from "@/components/app/scope-modal";`.

State next to `confirmEnd`:

```tsx
  const [scope, setScope] = useState<BillingState.Paused | BillingState.Ended | null>(null);
```

`transition`:

```tsx
  async function transition(detail: BillingDetail, state: BillingState, pendingCharges?: PendingChargesAction) {
    await run(async () => {
      const updated = await client.patchBilling(detail.id, pendingCharges ? { state, pendingCharges } : { state });

      setBilling(updated);
      setConfirmEnd(false);
      setScope(null);
```

(rest unchanged; the `state === "ended"` comparison may become `state === BillingState.Ended`).

Handlers above the `return`:

```tsx
  function pause(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      void transition(detail, BillingState.Paused);
      return;
    }

    setScope(BillingState.Paused);
  }

  function end(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      setConfirmEnd(true);
      return;
    }

    setScope(BillingState.Ended);
  }
```

Tiles: Pausar/Retomar `onPress={() => (billing.state === "active" ? pause(billing) : void transition(billing, BillingState.Active))}`; Encerrar `onPress={() => end(billing)}`.

Next to the `confirmEnd` modal:

```tsx
      {scope && (
        <ScopeModal
          title={scope === BillingState.Paused ? "Pausar conta?" : "Encerrar conta?"}
          subtitle={scope === BillingState.Ended ? "Esta ação não pode ser desfeita." : undefined}
          explanation={scope === BillingState.Paused ? `Novas cobranças deixam de ser geradas. E as pendentes de “${billing.description}”?` : `Encerrar impede novas ocorrências de “${billing.description}”. E as pendentes?`}
          primaryLabel="Manter as deste mês"
          secondaryLabel={`Cancelar pendentes (${pendingChargesOf(billing).length})`}
          secondaryTone="danger"
          busy={busy}
          onPrimary={() => void transition(billing, scope, PendingChargesAction.Keep)}
          onSecondary={() => void transition(billing, scope, PendingChargesAction.Cancel)}
          onCancel={() => setScope(null)}
        />
      )}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test`
Expected: 0 type errors, lint exit 0, all suites pass (baseline 206 + new).

- [ ] **Step 6: No commit** (user rule).

---

### Task 10: Mobile edit asks for the scope

**Files:**
- Modify: `packages/mobile/src/components/forms/billing-form-screen.tsx` — imports, `Attempt` (~69), state (~328), `patchBody` (~484-501), `save` (~503-521), `submit` (~527-546), render before `</SafeAreaView>`
- Test: `packages/mobile/src/components/forms/billing-form-screen.test.tsx` (after `edits a finite billing…`, ~735)

**Interfaces:**
- Consumes: `EditScope`; `shouldAskEditScope`, `editableMonthCharges`, `editScopeExplanation`; `ScopeModal` (Task 9)

- [ ] **Step 1: Failing tests**

Add `BillingFrequency, ChargeState, SharingState, type ChargeDetail` to the `@receivy/common` import. Inside the `describe`, append:

```tsx
  const monthCharge: ChargeDetail = {
    id: "c9",
    description: "Jantar",
    amount: { amountCents: 9_000, currency: "BRL" },
    dueDate: "2026-09-20",
    state: ChargeState.Pending,
    billingId: "b2",
    billingType: BillingType.Indefinite,
    installment: null,
    installmentCount: null,
    counterpartName: "Ana",
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: "u1", name: "Ana", email: null },
    debtorUserId: "u1",
    pix: null,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01T00:00:00Z",
  };

  const recurringWithCharge: BillingDetail = { ...onceBilling, id: "b2", type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: "2026-09-20", nextDueDate: "2026-09-20", charges: [monthCharge] };

  // Only Date is faked: RNTL keeps its real timers for waitFor.
  function onSeptemberTenth() {
    jest.useFakeTimers({
      now: new Date("2026-09-10T15:00:00Z"),
      doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "hrtime", "performance"],
    });
  }

  afterEach(() => jest.useRealTimers());

  it("asks whether an amount change also reaches this month's charges", async () => {
    onSeptemberTenth();
    const patchBilling = jest.fn().mockResolvedValue(recurringWithCharge);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={recurringWithCharge} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    await fireEvent.changeText(screen.getByLabelText("Valor"), "12000");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));

    expect(await screen.findByRole("header", { name: "Aplicar às cobranças deste mês?" })).toBeOnTheScreen();
    expect(screen.getByText("1 cobrança de setembro ainda não venceu.")).toBeOnTheScreen();
    expect(patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Aplicar também às deste mês" }));

    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(patchBilling.mock.calls[0][1]).toMatchObject({ totalCents: 12_000, applyTo: "current_month" });
  });

  it("sends no scope when the owner keeps this month as it is", async () => {
    onSeptemberTenth();
    const patchBilling = jest.fn().mockResolvedValue(recurringWithCharge);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={recurringWithCharge} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    await fireEvent.changeText(screen.getByLabelText("Valor"), "12000");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Só a partir do mês seguinte" }));

    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(patchBilling.mock.calls[0][1].applyTo).toBeUndefined();
  });

  it("saves an untouched recurring billing without asking", async () => {
    onSeptemberTenth();
    const patchBilling = jest.fn().mockResolvedValue(recurringWithCharge);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={recurringWithCharge} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));

    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(screen.queryByRole("header", { name: "Aplicar às cobranças deste mês?" })).toBeNull();
  });
```

Run: `pnpm --filter @receivy/mobile exec jest src/components/forms/billing-form-screen.test.tsx` — Expected: the first two FAIL.

If the "untouched" case asks anyway, fix the comparison in `patchTouchesCharges` (Task 2) and add the failing shape to `billing-scope.test.ts`.

- [ ] **Step 2: Implement**

Imports: add `EditScope, editableMonthCharges, editScopeExplanation, shouldAskEditScope, type BillingPatch` to the `@receivy/common` import and `import { ScopeModal } from "@/components/app/scope-modal";`.

```tsx
type Attempt = { input: BillingInput; key: string; uncertain: boolean; applyTo?: EditScope };
```

State next to `attempt`:

```tsx
  const [scopeAttempt, setScopeAttempt] = useState<Attempt | null>(null);
```

`patchBody` signature: `function patchBody(input: BillingInput): BillingPatch {`.

`save`, the PATCH call:

```tsx
      const saved = billing
        ? await client.patchBilling(billing.id, sent.applyTo ? { ...patchBody(sent.input), applyTo: sent.applyTo } : patchBody(sent.input))
        : await client.createBilling(sent.input, sent.key);
```

`submit`, the `try`:

```tsx
    try {
      const next: Attempt = { input: buildBillingInput(draftToBuild(draft)), key: Crypto.randomUUID(), uncertain: false };

      // Only a recorrente edit that changes what its charges carry, with charges of this month still ahead, needs the answer.
      if (billing && shouldAskEditScope(billing, patchBody(next.input), todayIn(billing.timezone))) {
        setScopeAttempt(next);
        return;
      }

      void save(next);
    } catch (reason) {
```

Handler above the `return`:

```tsx
  function applyScope(applyTo?: EditScope) {
    if (!scopeAttempt) {
      return;
    }

    const sent = applyTo ? { ...scopeAttempt, applyTo } : scopeAttempt;

    setScopeAttempt(null);
    void save(sent);
  }
```

Before `</SafeAreaView>` of the main render:

```tsx
      {scopeAttempt && billing && (
        <ScopeModal
          title="Aplicar às cobranças deste mês?"
          explanation={editScopeExplanation(editableMonthCharges(billing, todayIn(billing.timezone)).length, todayIn(billing.timezone))}
          primaryLabel="Aplicar também às deste mês"
          secondaryLabel="Só a partir do mês seguinte"
          busy={busy}
          onPrimary={() => applyScope(EditScope.CurrentMonth)}
          onSecondary={() => applyScope()}
          onCancel={() => setScopeAttempt(null)}
        />
      )}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test`
Expected: 0 type errors, lint exit 0, all suites pass.

- [ ] **Step 4: No commit** (user rule).

---

### Task 11: QA script, notes and final verification

**Files:**
- Modify: `docs/manual-qa-script.md` (new section before `## Divergências`)
- Modify: `~/Projects/ai-rules/notes/receivy.md` (append only, one line)

- [ ] **Step 1: QA section**

Insert before `## Divergências`, renumbering nothing else:

```md
## 17. Mês materializado

- [ ] Criar recorrente mensal com vencimento daqui a alguns dias neste mês. Esperado: a cobrança aparece no Feed e no detalhe na hora; nenhum e-mail/push agora; o lembrete chega às 06:00 do dia.
- [ ] Criar recorrente com vencimento hoje. Esperado: aviso inicial imediato.
- [ ] Criar parcelado 3× começando hoje. Esperado: 3 cobranças, 1 aviso (a de hoje).
- [ ] Pausar com pendentes → modal "Pausar conta?". "Manter as deste mês": a cobrança do mês continua pendente. Repetir em outra conta com "Cancelar pendentes (N)": todas canceladas.
- [ ] Encerrar parcelado com "Manter as deste mês". Esperado: parcela do mês pendente, meses seguintes canceladas.
- [ ] Pausar/Encerrar sem pendentes. Esperado: Pausar direto; Encerrar com a confirmação simples.
- [ ] Editar valor de recorrente com cobrança futura no mês → "Aplicar também às deste mês". Esperado: mesma cobrança (mesmo link público) com o novo valor. Repetir com "Só a partir do mês seguinte": valor do mês intacto.
- [ ] Editar só a categoria. Esperado: salva sem modal.
- [ ] Trocar o vencimento de 15 para 30 no dia 16 de um mês que já tem a cobrança de 15. Esperado: nenhuma segunda cobrança no mês; próxima em 30 do mês seguinte.
```

- [ ] **Step 2: Note**

Append one line to `~/Projects/ai-rules/notes/receivy.md`:

```
- 2026-09-12: mês materializado: recorrentes viram cobrança até o fim do mês (materializationHorizon), aviso inicial só se vence hoje ou nenhum lembrete alcança (shouldSendInitialNotice em announceCharges, inclusive publicação tardia do Pix); PATCH de billing aceita pendingCharges (keep|cancel, só com paused/ended) e applyTo (current_month|next_month, só recorrente) que reescreve in place as pendentes futuras do mês sem comprovante; remarcar num mês que já tem cobrança pula o mês. Spec docs/superpowers/specs/2026-09-12-mes-materializado-design.md.
```

- [ ] **Step 3: Full verification**

Run each and record the result:

```bash
pnpm --filter @receivy/common check-types && pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test
cd packages/api && pnpm run check-types && pnpm run check-types:test && pnpm exec vitest run src --pool=forks && pnpm exec biome check src test && pnpm run openapi:check; cd ../..
pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test
pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test
```

Expected: common/web/mobile green; api unit tests only with the 6 known email failures; `biome check` in api may still report the pre-existing `ez4.project.js` format error (outside `src`/`test`, not introduced here); OpenAPI matches.

Hand the user: `pnpm --filter @receivy/api test:integration` (resets `receivy_tests`) and the QA section above.

- [ ] **Step 4: No commit** (user rule).
