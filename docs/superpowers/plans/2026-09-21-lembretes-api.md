# Lembretes configuráveis — API Implementation Plan (common + api)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lembretes com canais por regra (e-mail, WhatsApp; push implícito), padrão do usuário herdado pela conta até ser editada, teto de 5 regras em ±14 dias, lembrete manual guiado pela config, opt-out de e-mail do destinatário e telefone/consentimento no contato. WhatsApp entra como canal declarado e sempre cai com `unavailable` nesta fase.

**Architecture:** O domínio (`@receivy/common`) ganha `reminders.ts` com `ChannelSet`, `ReminderRule`, `ReminderConfig`, validação e resolução em três níveis. A API guarda `users.reminder_config` (JSON) e continua com `billings.reminders` (JSON, nulo = herda). O envio (`sendChargeNotice`) recebe um `ChannelSet` resolvido, deixa de armar follow-up e grava `dropped` no evento. Um resolvedor puro em `notifications/services/channels.ts` decide o que sai e por que o resto cai, e alimenta tanto o envio quanto o preview do manual. O opt-out de e-mail é um token HMAC sem expiração, aceito por rotas públicas.

**Tech Stack:** EZ4 (gateway, database, scheduler, factory), vitest (unit em `src`), `ez4 test --local` (integração em `test/`, `node:test` + `node:assert/strict`), biome (sem formatter).

**Spec:** `docs/superpowers/specs/2026-09-21-lembretes-configuraveis-design.md`. Desvios aprovados neste plano por convenção do repo: rotas em `/account/reminders` (prefixo já usado por `/account/profile`); reset da conta por `clearReminders: true` no PATCH (padrão de `clearPaymentMethod`); `whatsappAvailable` sai em `GET /account/reminders`, não em `auth/me`; opt-out por `POST`/`DELETE /public/notices/opt-out/{token}` (o EZ4 não redireciona; a página é do web, plano de UI).

## Global Constraints

- Teto: `REMINDER_MAX_RULES = 5`, `REMINDER_MAX_OFFSET = 14`. Mensagem de validação (verbatim): `'Lembretes inválidos: até 5 dias únicos entre -14 e 14.'`.
- Padrão do sistema (verbatim): `reminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }]`, `manual: { email: true, whatsapp: true }`.
- Motivos de queda (`DropReason`, const enum): `NoEmail = 'no_email'`, `NoPhone = 'no_phone'`, `NoConsent = 'no_consent'`, `OptedOut = 'opted_out'`, `Unavailable = 'unavailable'`. `quota` fica para a fase 2.
- Evento `notice.sent`/`notice.skipped`: payload continua `{ template, offsetDays?, channels }` e ganha `dropped?: { channel, reason }[]`. `channels` segue com um `push` por aparelho.
- Push nunca é configurável: sai sempre que `pushAvailable` e houver aparelho. Conta a pagar (auto-lembrete): `whatsapp` forçado `false`.
- Sem follow-up: `EMAIL_FOLLOWUP_MS`, `followUpCharge`, `emailAlreadySent` e `stage` deixam de existir.
- Rodapé de e-mail (verbatim): texto `Para parar de receber avisos de cobrança do Receivy: <url>`; HTML `noticeRow` com link `Parar de receber avisos de cobrança`. Login por código não leva rodapé.
- Const enum, nunca literal. Repositório só banco, select inline. Handlers desestruturam o contexto. Chaves `if` sempre; linha em branco ao trocar o tipo de statement.
- Colunas novas são nulas; o EZ4 sincroniza (sem migração para o usuário rodar). Nunca `biome --write`. Nunca commitar: o dono commita.
- Verificação por task: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`; `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test`; integração quando a task toca envio/manual/contato: `pnpm --filter @receivy/api test:integration` (Docker de pé). Baselines vermelhas conhecidas: 6 unit de e-mail (`file.ts:32`), 1 de integração (category), ~200 avisos biome de formato.
- OpenAPI: ao final de cada task que muda rota ou body, `pnpm --filter @receivy/api openapi:generate` e conferir `git diff docs/api-oas.yml`.

---

### Task 1: Common — `reminders.ts` (modelo, validação, resolução)

**Files:**
- Create: `packages/common/src/domain/reminders.ts`, `packages/common/src/domain/reminders.test.ts`
- Modify: `packages/common/src/index.ts` (exportar o módulo, ao lado dos outros `domain/*`)

**Interfaces:**
- Produces: `ChannelSet`, `ReminderRule`, `ReminderConfig`, `REMINDER_MAX_RULES`, `REMINDER_MAX_OFFSET`, `SYSTEM_REMINDER_CONFIG`, `REMINDERS_INVALID_MESSAGE`, `normalizeReminderRules(input: unknown): ReminderRule[]`, `validateReminderRules(rules: ReminderRule[]): ReminderRule[]`, `validateReminderConfig(config: ReminderConfig): ReminderConfig`, `effectiveConfig(billingReminders: ReminderRule[] | null | undefined, ownerConfig: ReminderConfig | null | undefined): ReminderConfig`, `channelsFor(config: ReminderConfig, template: 'initial' | 'reminder' | 'manual', offsetDays?: number): ChannelSet`.

- [ ] **Step 1: Testes**

```ts
// packages/common/src/domain/reminders.test.ts
import { describe, expect, it } from 'vitest';
import {
  channelsFor,
  effectiveConfig,
  normalizeReminderRules,
  REMINDERS_INVALID_MESSAGE,
  SYSTEM_REMINDER_CONFIG,
  validateReminderConfig,
  validateReminderRules
} from './reminders';

const EMAIL = { email: true, whatsapp: false };
const BOTH = { email: true, whatsapp: true };

describe('normalizeReminderRules', () => {
  it('reads a legacy rule without channels as e-mail only', () => {
    expect(normalizeReminderRules([{ offsetDays: 0, enabled: true }])).toEqual([{ offsetDays: 0, enabled: true, channels: EMAIL }]);
  });

  it('keeps channels when present and drops unknown keys', () => {
    expect(normalizeReminderRules([{ offsetDays: 2, enabled: false, channels: BOTH, extra: 1 }])).toEqual([{ offsetDays: 2, enabled: false, channels: BOTH }]);
  });

  it('refuses anything that is not an array of rules', () => {
    expect(() => normalizeReminderRules('x')).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => normalizeReminderRules([{ offsetDays: 'a', enabled: true }])).toThrow(REMINDERS_INVALID_MESSAGE);
  });
});

describe('validateReminderRules', () => {
  it('sorts by offset and accepts up to five unique offsets within ±14', () => {
    const rules = [-14, 14, 0, 3, -3].map((offsetDays) => ({ offsetDays, enabled: true, channels: EMAIL }));

    expect(validateReminderRules(rules).map((rule) => rule.offsetDays)).toEqual([-14, -3, 0, 3, 14]);
  });

  it('refuses six rules, duplicates, non-integers and offsets beyond 14 days', () => {
    const six = [-5, -4, -3, -2, -1, 0].map((offsetDays) => ({ offsetDays, enabled: true, channels: EMAIL }));

    expect(() => validateReminderRules(six)).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([{ offsetDays: 0, enabled: true, channels: EMAIL }, { offsetDays: 0, enabled: false, channels: EMAIL }])).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([{ offsetDays: 1.5, enabled: true, channels: EMAIL }])).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([{ offsetDays: 15, enabled: true, channels: EMAIL }])).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([])).toThrow(REMINDERS_INVALID_MESSAGE);
  });
});

describe('validateReminderConfig', () => {
  it('validates the rules and requires both manual channels to be booleans', () => {
    expect(validateReminderConfig(SYSTEM_REMINDER_CONFIG)).toEqual(SYSTEM_REMINDER_CONFIG);
    expect(() => validateReminderConfig({ reminders: SYSTEM_REMINDER_CONFIG.reminders, manual: { email: 'yes' as unknown as boolean, whatsapp: true } })).toThrow(REMINDERS_INVALID_MESSAGE);
  });
});

describe('effectiveConfig', () => {
  const owner = { reminders: [{ offsetDays: -3, enabled: true, channels: BOTH }], manual: { email: false, whatsapp: true } };

  it('falls back to the system default when neither level is set', () => {
    expect(effectiveConfig(null, null)).toEqual(SYSTEM_REMINDER_CONFIG);
  });

  it('uses the owner config when the billing has none', () => {
    expect(effectiveConfig(undefined, owner)).toEqual(owner);
  });

  it('takes the billing rules and always the owner manual channels', () => {
    const own = [{ offsetDays: 5, enabled: true, channels: EMAIL }];

    expect(effectiveConfig(own, owner)).toEqual({ reminders: own, manual: owner.manual });
    expect(effectiveConfig(own, null)).toEqual({ reminders: own, manual: SYSTEM_REMINDER_CONFIG.manual });
  });
});

describe('channelsFor', () => {
  const config = {
    reminders: [
      { offsetDays: -3, enabled: false, channels: BOTH },
      { offsetDays: 0, enabled: true, channels: EMAIL },
      { offsetDays: 2, enabled: true, channels: { email: false, whatsapp: true } }
    ],
    manual: { email: false, whatsapp: true }
  };

  it('picks the rule by offset for a reminder', () => {
    expect(channelsFor(config, 'reminder', 2)).toEqual({ email: false, whatsapp: true });
  });

  it('uses the first enabled rule for the initial notice, or the system rule when none is enabled', () => {
    expect(channelsFor(config, 'initial')).toEqual(EMAIL);
    expect(channelsFor({ ...config, reminders: config.reminders.map((rule) => ({ ...rule, enabled: false })) }, 'initial')).toEqual(EMAIL);
  });

  it('uses the manual channels for the manual reminder', () => {
    expect(channelsFor(config, 'manual')).toEqual({ email: false, whatsapp: true });
  });

  it('falls back to e-mail only when the reminder offset has no rule', () => {
    expect(channelsFor(config, 'reminder', 9)).toEqual(EMAIL);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/common test -- reminders`
Expected: FAIL, módulo `./reminders` não existe.

- [ ] **Step 3: Implementar**

```ts
// packages/common/src/domain/reminders.ts
export type ChannelSet = { email: boolean; whatsapp: boolean };

export type ReminderRule = { offsetDays: number; enabled: boolean; channels: ChannelSet };

export type ReminderConfig = { reminders: ReminderRule[]; manual: ChannelSet };

export type ReminderTemplate = 'initial' | 'reminder' | 'manual';

export const REMINDER_MAX_RULES = 5;

export const REMINDER_MAX_OFFSET = 14;

export const REMINDERS_INVALID_MESSAGE = 'Lembretes inválidos: até 5 dias únicos entre -14 e 14.';

const EMAIL_ONLY: ChannelSet = { email: true, whatsapp: false };

export const SYSTEM_REMINDER_CONFIG: ReminderConfig = {
  reminders: [{ offsetDays: 0, enabled: true, channels: EMAIL_ONLY }],
  manual: { email: true, whatsapp: true }
};

function isChannelSet(value: unknown): value is ChannelSet {
  return typeof value === 'object' && value !== null && typeof (value as ChannelSet).email === 'boolean' && typeof (value as ChannelSet).whatsapp === 'boolean';
}

/** A stored rule may predate channels: it read as e-mail only. Anything else malformed is refused. */
export function normalizeReminderRules(input: unknown): ReminderRule[] {
  if (!Array.isArray(input)) {
    throw new RangeError(REMINDERS_INVALID_MESSAGE);
  }

  return input.map((item) => {
    const rule = item as Partial<ReminderRule> | null;

    if (!rule || typeof rule.offsetDays !== 'number' || typeof rule.enabled !== 'boolean') {
      throw new RangeError(REMINDERS_INVALID_MESSAGE);
    }

    const channels = rule.channels === undefined ? EMAIL_ONLY : rule.channels;

    if (!isChannelSet(channels)) {
      throw new RangeError(REMINDERS_INVALID_MESSAGE);
    }

    return { offsetDays: rule.offsetDays, enabled: rule.enabled, channels: { email: channels.email, whatsapp: channels.whatsapp } };
  });
}

/** Up to five unique integer offsets inside ±14 days, sorted ascending. */
export function validateReminderRules(rules: ReminderRule[]): ReminderRule[] {
  const invalid = rules.some(
    (rule) => !Number.isInteger(rule.offsetDays) || Math.abs(rule.offsetDays) > REMINDER_MAX_OFFSET || typeof rule.enabled !== 'boolean' || !isChannelSet(rule.channels)
  );
  const unique = new Set(rules.map((rule) => rule.offsetDays)).size === rules.length;

  if (rules.length === 0 || rules.length > REMINDER_MAX_RULES || invalid || !unique) {
    throw new RangeError(REMINDERS_INVALID_MESSAGE);
  }

  return [...rules]
    .map((rule) => ({ offsetDays: rule.offsetDays, enabled: rule.enabled, channels: { email: rule.channels.email, whatsapp: rule.channels.whatsapp } }))
    .sort((a, b) => a.offsetDays - b.offsetDays);
}

export function validateReminderConfig(config: ReminderConfig): ReminderConfig {
  if (!isChannelSet(config?.manual)) {
    throw new RangeError(REMINDERS_INVALID_MESSAGE);
  }

  return { reminders: validateReminderRules(config.reminders), manual: { email: config.manual.email, whatsapp: config.manual.whatsapp } };
}

/** billing rules ?? owner rules ?? system rules; the manual channels are always the owner's. */
export function effectiveConfig(billingReminders: ReminderRule[] | null | undefined, ownerConfig: ReminderConfig | null | undefined): ReminderConfig {
  const owner = ownerConfig ?? SYSTEM_REMINDER_CONFIG;

  return { reminders: billingReminders ?? owner.reminders, manual: owner.manual };
}

/** Which configurable channels a notice wants; push is implicit and never listed here. */
export function channelsFor(config: ReminderConfig, template: ReminderTemplate, offsetDays?: number): ChannelSet {
  if (template === 'manual') {
    return config.manual;
  }

  if (template === 'initial') {
    return config.reminders.find((rule) => rule.enabled)?.channels ?? SYSTEM_REMINDER_CONFIG.reminders[0]!.channels;
  }

  return config.reminders.find((rule) => rule.offsetDays === offsetDays)?.channels ?? EMAIL_ONLY;
}
```

Exportar em `packages/common/src/index.ts` seguindo a linha dos outros módulos de `domain` (ex.: `export * from './domain/plan';`).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/common test -- reminders && pnpm --filter @receivy/common lint`
Expected: PASS (avisos `noConstEnum`/formato de baseline são aceitáveis).

---

### Task 2: Common — `ReminderRule` substitui `BillingReminder`; teto 5/±14; `clearReminders`; draft nulo

**Files:**
- Modify: `packages/common/src/domain/billing.ts:52-54,69,93,193`, `packages/common/src/domain/billing-calendar.ts:72-92,162-175,234,267`, `packages/common/src/domain/billing-draft.ts:18,64,91,306-312`, testes vizinhos (`billing-calendar.test.ts`, `billing-draft.test.ts`) onde citam `BillingReminder` ou `reminders: [{ offsetDays: '0', enabled: true }]`.

**Interfaces:**
- Produces: `BillingInput.reminders?: ReminderRule[]`; `BillingPatch.reminders?: ReminderRule[]` e `BillingPatch.clearReminders?: boolean`; `BillingDetail.reminders: ReminderRule[] | null` e `BillingDetail.effectiveReminders: ReminderRule[]`; `BillingDraft.reminders: ReminderDraft[] | null` (nulo = herda); `ReminderDraft = Omit<ReminderRule, 'offsetDays'> & { offsetDays: string }`; `materializationDate`/`materializationHorizon` recebem `ReminderRule[]`.
- Consumes: Task 1.

- [ ] **Step 1: Testes**

```ts
// packages/common/src/domain/billing-calendar.test.ts — acrescentar
import { REMINDERS_INVALID_MESSAGE } from './reminders';

describe('normalizeBillingInput reminders', () => {
  const base = { recurrence: BillingRecurrence.Once, totalCents: 100, startDate: '2026-10-10', timezone: 'America/Sao_Paulo', split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] } };

  it('accepts up to five rules within ±14 days and keeps channels', () => {
    const reminders = [{ offsetDays: 14, enabled: true, channels: { email: false, whatsapp: true } }, { offsetDays: -14, enabled: true, channels: { email: true, whatsapp: false } }];

    expect(normalizeBillingInput({ ...base, reminders }).reminders).toEqual([reminders[1], reminders[0]]);
  });

  it('refuses a sixth rule or 15 days', () => {
    expect(() => normalizeBillingInput({ ...base, reminders: [{ offsetDays: 15, enabled: true, channels: { email: true, whatsapp: false } }] })).toThrow(REMINDERS_INVALID_MESSAGE);
  });

  it('leaves reminders undefined when absent: the billing inherits', () => {
    expect(normalizeBillingInput(base).reminders).toBeUndefined();
  });
});
```

```ts
// packages/common/src/domain/billing-draft.test.ts — acrescentar
it('starts a new draft inheriting reminders and only sends them once customised', () => {
  const draft = EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-10-10');

  expect(draft.reminders).toBeNull();
  expect(buildBillingInput({ ...draft, amount: '10', selected: [], owner: true, description: 'x' }, new Date('2026-10-01')).reminders).toBeUndefined();

  const custom = { ...draft, amount: '10', description: 'x', reminders: [{ offsetDays: '3', enabled: true, channels: { email: true, whatsapp: false } }] };

  expect(buildBillingInput(custom, new Date('2026-10-01')).reminders).toEqual([{ offsetDays: 3, enabled: true, channels: { email: true, whatsapp: false } }]);
});
```

Ajustar o `buildBillingInput` do teste ao helper que o arquivo já usa para montar um draft válido (ver os testes existentes no mesmo arquivo e copiar o mesmo esqueleto de draft).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/common test -- billing`
Expected: FAIL por tipo/mensagem antiga (`-90 e 90`) e `reminders` não nulo no draft.

- [ ] **Step 3: Implementar**

`billing.ts`:
```ts
import type { ReminderRule } from './reminders';

/** @deprecated use ReminderRule; kept one release for the clients' imports. */
export type BillingReminder = ReminderRule;
// remover DEFAULT_BILLING_REMINDERS
```
Trocar `reminders?: BillingReminder[]` por `reminders?: ReminderRule[]` em `BillingInput` e `BillingPatch`; em `BillingPatch` acrescentar `/** Back to the owner's default: the billing stops carrying its own rules. */ clearReminders?: boolean;`. Em `BillingDetail`: `reminders: ReminderRule[] | null;` e `/** What actually fires: the billing's own rules or the owner's default. */ effectiveReminders: ReminderRule[];`.

`billing-calendar.ts`: `earliestOffset`, `materializationDate`, `materializationHorizon` tipados com `ReminderRule[]`; `validateReminders` vira:
```ts
import { validateReminderRules, type ReminderRule } from './reminders';

function validateReminders(reminders: ReminderRule[]): ReminderRule[] {
  return validateReminderRules(reminders);
}
```
(linha 234 e 267 continuam chamando `validateReminders`).

`billing-draft.ts`:
```ts
export type ReminderDraft = Omit<ReminderRule, 'offsetDays'> & { offsetDays: string };
// BillingDraft
  /** `null` inherits the owner's default; an array is this billing's own rules. */
  reminders: ReminderDraft[] | null;
// EMPTY_BILLING_DRAFT
    reminders: null
// buildBillingInput (linhas 306-312)
  const base = {
    ...schedule,
    ...(draft.reminders
      ? {
          reminders: draft.reminders.map((reminder) => ({
            enabled: reminder.enabled,
            channels: reminder.channels,
            offsetDays: integer(reminder.offsetDays, 'Informe dias inteiros, como -3, 0 ou 2.')
          }))
        }
      : {})
  };
```
Grep obrigatório: `grep -rn "BillingReminder\|DEFAULT_BILLING_REMINDERS\|offsetDays: '0'" packages/common/src` e corrigir cada uso.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
Expected: PASS.

---

### Task 3: API — colunas novas, repositórios e resolução da config

**Files:**
- Modify: `packages/api/src/users/schemas/user.ts`, `packages/api/src/contacts/schemas/contact.ts`, `packages/api/src/users/repositories/account.ts`, `packages/api/src/contacts/repositories/contact.ts`, `packages/api/src/billings/utils/reminders.ts`, `packages/api/src/charges/repositories/charge.ts:185-237`, `packages/api/src/billings/repositories/billing.ts:105,137,216,301` (selects que já trazem `reminders`), `packages/api/src/billings/services/detail.ts:167-206`, `packages/api/src/billings/utils/split.ts:22`
- Test: `packages/api/src/billings/utils/reminders.test.ts` (novo)

**Interfaces:**
- Produces: `UserSchema.reminder_config?: String.Max<2000>`, `UserSchema.email_opt_out_at?: String.DateTime`, `UserSchema.whatsapp_opt_out_at?: String.DateTime`; `ContactSchema.phone?: String.Max<40>`, `ContactSchema.whatsapp_consent_at?: String.DateTime`.
- `AccountRepository.reminderConfig(db, id): Promise<{ config: ReminderConfig | null }>`, `AccountRepository.saveReminderConfig(db, id, config: ReminderConfig | null, now)`, `AccountRepository.setEmailOptOut(db, id, at: string | null)`.
- `ContactRepository.reachability(db, creditorId, debtorId): Promise<{ phone?: string; consentAt?: string } | null>`.
- `parseReminders(row: { reminders?: string }): ReminderRule[] | undefined`; `parseReminderConfig(json?: string): ReminderConfig | null`; `effectiveReminders(row: { reminders?: string; owner: { reminder_config?: string } }): ReminderRule[]`; `effectiveConfigOf(row): ReminderConfig`.
- `ChargeRepository.NoticeRow.billing.owner` ganha `reminder_config?: string`; `NoticeRow.debtor` ganha `phone?: string; email_opt_out_at?: string; whatsapp_opt_out_at?: string`; `NoticeRow` ganha `creditor_id` (já selecionado).

- [ ] **Step 1: Teste unitário do util**

```ts
// packages/api/src/billings/utils/reminders.test.ts
import { SYSTEM_REMINDER_CONFIG } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { effectiveConfigOf, effectiveReminders, parseReminderConfig, parseReminders } from './reminders';

const owner = { reminders: [{ offsetDays: -3, enabled: true, channels: { email: true, whatsapp: true } }], manual: { email: false, whatsapp: true } };

describe('billing reminder resolution', () => {
  it('reads legacy rows as e-mail only', () => {
    expect(parseReminders({ reminders: '[{"offsetDays":0,"enabled":true}]' })).toEqual([{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }]);
  });

  it('inherits the owner config when the billing has none, else the system default', () => {
    expect(effectiveReminders({ owner: { reminder_config: JSON.stringify(owner) } })).toEqual(owner.reminders);
    expect(effectiveReminders({ owner: {} })).toEqual(SYSTEM_REMINDER_CONFIG.reminders);
  });

  it('keeps the billing rules and the owner manual channels', () => {
    const own = '[{"offsetDays":5,"enabled":true,"channels":{"email":true,"whatsapp":false}}]';

    expect(effectiveConfigOf({ reminders: own, owner: { reminder_config: JSON.stringify(owner) } })).toEqual({ reminders: JSON.parse(own), manual: owner.manual });
    expect(parseReminderConfig(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test -- reminders`
Expected: FAIL (`effectiveConfigOf` não existe).

- [ ] **Step 3: Implementar**

Schemas:
```ts
// user.ts — acrescentar após `phone`
  /** JSON `ReminderConfig`; absent means the system default. */
  reminder_config?: String.Max<2000>;
  /** The person asked, from an e-mail footer, to stop receiving charge notices. */
  email_opt_out_at?: String.DateTime;
  /** Reserved for the WhatsApp quick reply (phase 3); nothing writes it yet. */
  whatsapp_opt_out_at?: String.DateTime;
// contact.ts — acrescentar após `nickname`
  /** E.164, typed by the owner; the person's own `users.phone` wins over it. */
  phone?: String.Max<40>;
  /** The owner declared this person agreed to WhatsApp notices; absent blocks the channel through this contact. */
  whatsapp_consent_at?: String.DateTime;
```

`billings/utils/reminders.ts`:
```ts
import { effectiveConfig, normalizeReminderRules, type ReminderConfig, type ReminderRule, validateReminderConfig } from '@receivy/common';

type ReminderRow = { reminders?: string; owner: { reminder_config?: string } };

/** Kept apart from the repository so the notifier can read reminder settings without importing it. */
export function parseReminders(row: { reminders?: string }): ReminderRule[] | undefined {
  return row.reminders ? normalizeReminderRules(JSON.parse(row.reminders)) : undefined;
}

export function parseReminderConfig(json?: string): ReminderConfig | null {
  if (!json) {
    return null;
  }

  const parsed = JSON.parse(json) as ReminderConfig;

  return { reminders: normalizeReminderRules(parsed.reminders), manual: parsed.manual };
}

/** The rules that fire for this billing: its own, else the owner's default, else the system's. */
export function effectiveReminders(row: ReminderRow): ReminderRule[] {
  return effectiveConfigOf(row).reminders;
}

export function effectiveConfigOf(row: ReminderRow): ReminderConfig {
  return effectiveConfig(parseReminders(row), parseReminderConfig(row.owner.reminder_config));
}

export function serializeReminderConfig(config: ReminderConfig): string {
  return JSON.stringify(validateReminderConfig(config));
}
```

`AccountRepository` (dentro do namespace, após `saveProfile`):
```ts
  export async function reminderConfig(db: DbClient, id: string): Promise<{ reminder_config?: string } | null> {
    const row = await db.users.findOne({ select: { reminder_config: true }, where: { id, deleted_at: { isNull: true } } });

    return row ?? null;
  }

  export async function saveReminderConfig(db: DbClient, id: string, json: string | null, now: string): Promise<void> {
    await db.users.updateOne({ where: { id }, data: { reminder_config: json ?? sqlNull, updated_at: now } });
  }

  export async function setEmailOptOut(db: DbClient, id: string, at: string | null, now: string): Promise<void> {
    await db.users.updateOne({ where: { id }, data: { email_opt_out_at: at ?? sqlNull, updated_at: now } });
  }
```

`ContactRepository`:
```ts
  /** How the creditor can reach this person beyond the account: the phone and consent typed on their contact. */
  export async function reachability(db: DbClient, creditorId: string, debtorId: string): Promise<{ phone?: string; consentAt?: string } | null> {
    const row = await db.contacts.findOne({ select: { phone: true, whatsapp_consent_at: true }, where: { owner_id: creditorId, user_id: debtorId, archived_at: { isNull: true } } });

    if (!row) {
      return null;
    }

    return { phone: row.phone ?? undefined, consentAt: row.whatsapp_consent_at ?? undefined };
  }
```

`ChargeRepository.forNotice` e `pendingDueBetween`: `billing: { kind: true, reminders: true, owner: { timezone: true, reminder_config: true } }`, `debtor: { id: true, name: true, email: true, phone: true, deleted_at: true, email_opt_out_at: true, whatsapp_opt_out_at: true }`; atualizar os tipos `NoticeRow` e o retorno de `pendingDueBetween`.

`billings/repositories/billing.ts`: em cada `select` que já traz `reminders: true` (linhas ~105, 137, 216, 301), acrescentar `owner: { reminder_config: true }` (relação `owner` já existe na tabela, mesma forma usada em `charges`). Atualizar `BillingRow` para incluir `owner: { reminder_config?: string }`.

`detail.ts`:
```ts
    reminders: parseReminders(row) ?? null,
    effectiveReminders: effectiveReminders(row),
```
(remover a `const reminders` da linha 168). `split.ts:22` continua chamando `effectiveReminders(row)`; agora o `row` precisa carregar `owner` — confirmar pelo tipo.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test -- reminders`
Expected: PASS. `check-types` acusa cada select que ficou sem `owner.reminder_config`: corrigir um a um.

---

### Task 4: API — corpo de billing com canais, `clearReminders`, teto 5/±14

**Files:**
- Modify: `packages/api/src/billings/utils/body.ts:32-35,57-73`, `packages/api/src/billings/services/billing.ts:464-471,536`, `packages/api/src/billings/utils/patch.ts` (onde `BillingPatch` é montado a partir do body; grep `reminders`)
- Test: `packages/api/test/billings/*.spec.ts` (o arquivo que hoje cobre PATCH de reminders; grep `reminders` em `packages/api/test/billings`)

**Interfaces:**
- Produces: `ReminderBody { offsetDays: Integer.Range<-14, 14>; enabled: boolean; channels: { email: boolean; whatsapp: boolean } }`; `PatchBody.clearReminders?: boolean`.

- [ ] **Step 1: Teste de integração**

No spec de billings que já cria uma conta e faz PATCH (copiar o esqueleto de `createBilling(db, OWNER, key, input, now)` e `patchBilling` usados nos testes vizinhos):
```ts
  it('stores reminder channels, refuses a sixth rule and goes back to the owner default with clearReminders', async () => {
    const rule = (offsetDays: number) => ({ offsetDays, enabled: true, channels: { email: true, whatsapp: false } });
    const billing = await createBilling(db, OWNER, 'reminders-1', { ...ONCE_INPUT, reminders: [rule(0), rule(3)] }, new Date());

    deepEqual((await getBilling(db, OWNER, billing.id)).reminders, [rule(0), rule(3)]);

    await rejects(patchBilling(db, OWNER, billing.id, { reminders: [0, 1, 2, 3, 4, 5].map(rule) }, new Date()), (error: Error) => error.message.includes('até 5 dias'));

    await patchBilling(db, OWNER, billing.id, { clearReminders: true }, new Date());

    const cleared = await getBilling(db, OWNER, billing.id);

    equal(cleared.reminders, null);
    deepEqual(cleared.effectiveReminders, SYSTEM_REMINDER_CONFIG.reminders);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration -- test/billings`
Expected: FAIL (`clearReminders` desconhecido, `effectiveReminders` ausente).

- [ ] **Step 3: Implementar**

`body.ts`:
```ts
export declare class ChannelSetBody {
  email: boolean;
  whatsapp: boolean;
}

export declare class ReminderBody {
  offsetDays: Integer.Range<-14, 14>;
  enabled: boolean;
  channels: ChannelSetBody;
}
// PatchBody
  reminders?: ReminderBody[];
  /** Drops the billing's own rules: it inherits the owner's default again. */
  clearReminders?: boolean;
```
`billing.ts` (patch, ~464-471 e ~536):
```ts
    const reminders =
      patch.reminders === undefined
        ? undefined
        : normalizeBillingInput({ ...billingInputFrom(row, split), ...(patch.contactId !== undefined ? { contactId: patch.contactId } : {}), reminders: patch.reminders }).reminders;
    ...
        ...(patch.clearReminders ? { reminders: sqlNull } : patch.reminders !== undefined ? { reminders: JSON.stringify(reminders) } : {}),
```
`patch.ts`: passar `clearReminders` do body ao `BillingPatch`. `assertPatchAllowed`: `clearReminders` segue a mesma permissão de `reminders` (permitido em conta já gerada; `FROZEN_NOTE` já diz que lembretes seguem editáveis).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test:integration -- test/billings && pnpm --filter @receivy/api openapi:generate`
Expected: PASS; `docs/api-oas.yml` mostra `channels` em `ReminderBody` e `clearReminders`.

---

### Task 5: API — `/account/reminders` (GET, PUT, DELETE)

**Files:**
- Create: `packages/api/src/users/endpoints/reminders-get.ts`, `packages/api/src/users/endpoints/reminders-put.ts`, `packages/api/src/users/endpoints/reminders-delete.ts`
- Modify: `packages/api/src/users/routes.ts`, `packages/api/src/users/services/account.ts`
- Test: `packages/api/test/account/*.spec.ts` (o spec que cobre `updateProfile`; acrescentar bloco)

**Interfaces:**
- Produces: `AccountClient.reminders(userId): Promise<ReminderSettings>`, `AccountClient.saveReminders(userId, config: ReminderConfig): Promise<ReminderSettings>`, `AccountClient.clearReminders(userId): Promise<ReminderSettings>`; `ReminderSettings = { config: ReminderConfig; inherited: boolean; whatsappAvailable: boolean }` (declarar em `@receivy/common` `domain/reminders.ts`). Rotas `GET /account/reminders`, `PUT /account/reminders` (body `ReminderConfig`), `DELETE /account/reminders`. `whatsappAvailable` é `false` nesta fase (constante em `notifications/services/planner.ts`, ver Task 6).

- [ ] **Step 1: Teste de integração**

```ts
  it('stores, returns and clears the owner reminder config', async () => {
    const config = { reminders: [{ offsetDays: -3, enabled: true, channels: { email: true, whatsapp: true } }, { offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }], manual: { email: false, whatsapp: true } };

    deepEqual(await accounts.reminders(OWNER), { config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false });
    deepEqual(await accounts.saveReminders(OWNER, config), { config, inherited: false, whatsappAvailable: false });
    await rejects(accounts.saveReminders(OWNER, { ...config, reminders: [{ offsetDays: 15, enabled: true, channels: { email: true, whatsapp: false } }] }), HttpBadRequestError);
    deepEqual(await accounts.clearReminders(OWNER), { config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false });
  });
```
(`accounts` = `createService` de `users/services/account.ts` já instanciado no fixture do spec; se não existir, instanciar como os outros services em `test/fixtures/financial.ts`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration -- test/account`
Expected: FAIL (`reminders` não é função).

- [ ] **Step 3: Implementar**

`account.ts` (service):
```ts
import { HttpBadRequestError } from '@ez4/gateway';
import { type ReminderConfig, type ReminderSettings, SYSTEM_REMINDER_CONFIG } from '@receivy/common';
import { parseReminderConfig, serializeReminderConfig } from '../../billings/utils/reminders';
import { WHATSAPP_AVAILABLE } from '../../notifications/services/planner';

async function reminderSettings(db: DbClient, userId: string): Promise<ReminderSettings> {
  const row = await AccountRepository.reminderConfig(db, userId);

  if (!row) {
    throw new HttpUnauthorizedError();
  }

  const config = parseReminderConfig(row.reminder_config);

  return { config: config ?? SYSTEM_REMINDER_CONFIG, inherited: config === null, whatsappAvailable: WHATSAPP_AVAILABLE };
}

async function saveReminders(db: DbClient, userId: string, input: ReminderConfig): Promise<ReminderSettings> {
  let json: string;

  try {
    json = serializeReminderConfig(input);
  } catch (error) {
    throw new HttpBadRequestError(error instanceof Error ? error.message : 'Lembretes inválidos.');
  }

  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, userId);

    const now = new Date().toISOString();

    await AccountRepository.saveReminderConfig(tx, userId, json, now);
    await EventRepository.record(tx, { type: 'account.reminders_updated', eventableType: EventableType.Account, eventableId: userId, actorId: userId, at: now });
  });

  return reminderSettings(db, userId);
}

async function clearReminders(db: DbClient, userId: string): Promise<ReminderSettings> {
  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, userId);

    const now = new Date().toISOString();

    await AccountRepository.saveReminderConfig(tx, userId, null, now);
    await EventRepository.record(tx, { type: 'account.reminders_cleared', eventableType: EventableType.Account, eventableId: userId, actorId: userId, at: now });
  });

  return reminderSettings(db, userId);
}
```
`AccountClient` ganha os três métodos; `createService` os liga (`reminders: (userId) => reminderSettings(db, userId)` etc.).

Endpoints (padrão de `profile.ts`):
```ts
// reminders-put.ts
declare class RemindersRequest implements Http.Request {
  identity: SessionIdentity;
  body: { reminders: ReminderBody[]; manual: ChannelSetBody };
}

declare class RemindersResponse implements Http.Response {
  status: 200;
  body: ReminderSettings;
}

export async function putRemindersHandler({ identity, body }: RemindersRequest, { accounts }: Service.Context<UserProvider>): Promise<RemindersResponse> {
  return { status: 200, body: await accounts.saveReminders(identity.userId, body) };
}
```
`ReminderBody`/`ChannelSetBody` vêm de `../../billings/utils/body`. `reminders-get.ts` e `reminders-delete.ts` idem, sem body, devolvendo `ReminderSettings`. Rotas em `users/routes.ts`, após `updateProfile`:
```ts
  Http.UseRoute<{ name: 'getReminders'; path: 'GET /account/reminders'; authorizer: typeof sessionAuthorizer; handler: typeof getRemindersHandler }>,
  Http.UseRoute<{ name: 'putReminders'; path: 'PUT /account/reminders'; authorizer: typeof sessionAuthorizer; handler: typeof putRemindersHandler }>,
  Http.UseRoute<{ name: 'clearReminders'; path: 'DELETE /account/reminders'; authorizer: typeof sessionAuthorizer; handler: typeof deleteRemindersHandler }>,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test:integration -- test/account && pnpm --filter @receivy/api openapi:generate`
Expected: PASS; três rotas novas no OAS.

---

### Task 6: API — resolvedor de canais, envio sem follow-up, `dropped`

**Files:**
- Create: `packages/api/src/notifications/services/channels.ts`, `packages/api/src/notifications/services/channels.test.ts`
- Modify: `packages/api/src/notifications/services/send.ts` (inteiro), `packages/api/src/notifications/services/planner.ts:27-33,35-44`, `packages/api/src/notifications/schedulers/charge-notify.ts`, `packages/api/src/notifications/services/render.ts:27-82`, `packages/api/src/common/services/email/client.ts:16-30`, `packages/api/src/vendors/resend/service.ts` (passar `headers`), `packages/api/src/public/services/capability.ts`
- Test: `packages/api/test/notifications/notifications.spec.ts`

**Interfaces:**
- Produces:
  - `NoticeChannel { Push = 'push', Email = 'email', WhatsApp = 'whatsapp' }`; `DropReason` const enum; `Dropped = { channel: NoticeChannel.Email | NoticeChannel.WhatsApp; reason: DropReason }`.
  - `resolveChannels(input: { wanted: ChannelSet; ownBill: boolean; target: { email?: string; phone?: string; email_opt_out_at?: string; whatsapp_opt_out_at?: string }; contact: { phone?: string; consentAt?: string } | null; whatsappAvailable: boolean }): { email: boolean; whatsapp: boolean; dropped: Dropped[] }` (puro).
  - `SendOptions = { offsetDays?: number; channels: ChannelSet }`; `SendResult = { channels: NoticeChannel[]; dropped: Dropped[] }`.
  - `notifyCharge(db, context, chargeId, template, now, offsetDays?)` resolve `channelsFor(effectiveConfigOf(charge.billing), template, offsetDays)` e chama `sendChargeNotice`.
  - `ChargeNotifySchedule = { chargeId; template; offsetDays? }` (sem `stage`).
  - `PublicTokenPurpose.OptOut = 'opt-out'`; `issueOptOutToken({ userId, secret }): string`; `verifyOptOutToken(token, secret): { userId: string }`.
  - `RenderInputs.optOutUrl?: string`; `EmailInputs.Message.headers?: Record<string, string>`.
  - `WHATSAPP_AVAILABLE = false` exportado de `planner.ts`; `NotificationConfig.whatsappAvailable: boolean`.
- Consumes: Tasks 1, 3.

- [ ] **Step 1: Teste unitário do resolvedor**

```ts
// packages/api/src/notifications/services/channels.test.ts
import { describe, expect, it } from 'vitest';
import { DropReason, NoticeChannel, resolveChannels } from './channels';

const target = { email: 'a@b.c', phone: '+5511999999999' };

describe('resolveChannels', () => {
  it('sends e-mail when wanted and possible, and drops it with a reason otherwise', () => {
    expect(resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target, contact: null, whatsappAvailable: false })).toEqual({ email: true, whatsapp: false, dropped: [] });
    expect(resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target: {}, contact: null, whatsappAvailable: false }).dropped).toEqual([{ channel: NoticeChannel.Email, reason: DropReason.NoEmail }]);
    expect(resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target: { ...target, email_opt_out_at: '2026-09-01T00:00:00Z' }, contact: null, whatsappAvailable: false }).dropped).toEqual([{ channel: NoticeChannel.Email, reason: DropReason.OptedOut }]);
  });

  it('never wants WhatsApp on the owner own bill and reports the first blocking reason otherwise', () => {
    const wanted = { email: false, whatsapp: true };

    expect(resolveChannels({ wanted, ownBill: true, target, contact: null, whatsappAvailable: true })).toEqual({ email: false, whatsapp: false, dropped: [] });
    expect(resolveChannels({ wanted, ownBill: false, target: { email: 'a@b.c' }, contact: null, whatsappAvailable: true }).dropped).toEqual([{ channel: NoticeChannel.WhatsApp, reason: DropReason.NoPhone }]);
    expect(resolveChannels({ wanted, ownBill: false, target: { email: 'a@b.c' }, contact: { phone: '+5511988887777' }, whatsappAvailable: true }).dropped).toEqual([{ channel: NoticeChannel.WhatsApp, reason: DropReason.NoConsent }]);
    expect(resolveChannels({ wanted, ownBill: false, target: { ...target, whatsapp_opt_out_at: '2026-09-01T00:00:00Z' }, contact: null, whatsappAvailable: true }).dropped).toEqual([{ channel: NoticeChannel.WhatsApp, reason: DropReason.OptedOut }]);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: false }).dropped).toEqual([{ channel: NoticeChannel.WhatsApp, reason: DropReason.Unavailable }]);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: true })).toEqual({ email: false, whatsapp: true, dropped: [] });
  });

  it('takes the contact phone with consent when the person typed none', () => {
    expect(resolveChannels({ wanted: { email: false, whatsapp: true }, ownBill: false, target: { email: 'a@b.c' }, contact: { phone: '+5511988887777', consentAt: '2026-09-01T00:00:00Z' }, whatsappAvailable: true }).whatsapp).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test -- channels`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `channels.ts`**

```ts
// packages/api/src/notifications/services/channels.ts
import type { ChannelSet } from '@receivy/common';

export const enum NoticeChannel {
  Push = 'push',
  Email = 'email',
  WhatsApp = 'whatsapp'
}

export const enum DropReason {
  NoEmail = 'no_email',
  NoPhone = 'no_phone',
  NoConsent = 'no_consent',
  OptedOut = 'opted_out',
  Unavailable = 'unavailable'
}

export type Dropped = { channel: NoticeChannel.Email | NoticeChannel.WhatsApp; reason: DropReason };

export type ReachTarget = { email?: string; phone?: string; email_opt_out_at?: string; whatsapp_opt_out_at?: string };

export type ReachContact = { phone?: string; consentAt?: string } | null;

export type ResolveInput = { wanted: ChannelSet; ownBill: boolean; target: ReachTarget; contact: ReachContact; whatsappAvailable: boolean };

export type Resolved = { email: boolean; whatsapp: boolean; dropped: Dropped[] };

function whatsappDrop(input: ResolveInput): DropReason | null {
  const own = Boolean(input.target.phone);
  const phone = input.target.phone ?? input.contact?.phone;

  if (!phone) {
    return DropReason.NoPhone;
  }

  if (!own && !input.contact?.consentAt) {
    return DropReason.NoConsent;
  }

  if (input.target.whatsapp_opt_out_at) {
    return DropReason.OptedOut;
  }

  if (!input.whatsappAvailable) {
    return DropReason.Unavailable;
  }

  return null;
}

/** Push is implicit and decided by the devices; this settles the two configurable channels and says why one fell. */
export function resolveChannels(input: ResolveInput): Resolved {
  const dropped: Dropped[] = [];
  let email = false;
  let whatsapp = false;

  if (input.wanted.email) {
    if (!input.target.email) {
      dropped.push({ channel: NoticeChannel.Email, reason: DropReason.NoEmail });
    } else if (input.target.email_opt_out_at) {
      dropped.push({ channel: NoticeChannel.Email, reason: DropReason.OptedOut });
    } else {
      email = true;
    }
  }

  // The owner reminding themself never pays for WhatsApp: the channel is not even wanted.
  if (input.wanted.whatsapp && !input.ownBill) {
    const reason = whatsappDrop(input);

    if (reason) {
      dropped.push({ channel: NoticeChannel.WhatsApp, reason });
    } else {
      whatsapp = true;
    }
  }

  return { email, whatsapp, dropped };
}
```

- [ ] **Step 4: Rodar o unitário e ver passar**

Run: `pnpm --filter @receivy/api test -- channels`
Expected: PASS.

- [ ] **Step 5: Testes de integração do envio**

Em `notifications.spec.ts`: remover os testes `'follows a push up by e-mail once, while the charge is open with nothing under review'` e `'drops the e-mail follow-up of a charge silenced after its push'`, o import de `EMAIL_FOLLOWUP_MS` e `followUpCharge`, e toda asserção `followUp(...)`/`notify.events.get(notifyIdentifier(...))` que espera um follow-up armado (trocar por `equal(notify.events.has(notifyIdentifier(id)), false)`). Acrescentar:

```ts
  it('sends push and e-mail together on the due-day rule and arms no follow-up', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[rule]', 'rule');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: ['push', 'email'], dropped: [] });
    equal(sent.pushes.length, 1);
    equal(sent.emails.length, 1);
    equal(notify.events.has(notifyIdentifier(id)), false);
    ok(sent.emails[0]!.text.includes('/opt-out/'), 'the e-mail carries the opt-out link');
  });

  it('follows the owner config: a WhatsApp-only rule drops the e-mail and reports WhatsApp unavailable', async () => {
    clock = start;
    sent.reset();

    await accounts.saveReminders(OWNER, { reminders: [{ offsetDays: 0, enabled: true, channels: { email: false, whatsapp: true } }], manual: { email: true, whatsapp: true } });

    try {
      const { id } = await charge(OWNER, DEBTOR_EMAIL);

      deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: [], dropped: [{ channel: 'whatsapp', reason: 'no_phone' }] });
      equal(sent.emails.length, 0);

      const skipped = (await EventRepository.list(db, id, 'notice.skipped')).map((event) => event.payload);

      deepEqual(skipped.at(-1)!['dropped'], [{ channel: 'whatsapp', reason: 'no_phone' }]);
    } finally {
      await accounts.clearReminders(OWNER);
    }
  });

  it('respects the debtor e-mail opt-out and records why', async () => {
    clock = start;
    sent.reset();

    const { id, userId } = await charge(OWNER, DEBTOR_EMAIL);

    await AccountRepository.setEmailOptOut(db, userId, new Date(clock).toISOString(), new Date(clock).toISOString());

    try {
      deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: [], dropped: [{ channel: 'email', reason: 'opted_out' }] });
    } finally {
      await AccountRepository.setEmailOptOut(db, userId, null, new Date(clock).toISOString());
    }
  });
```
(`accounts` e `AccountRepository` importados como nas outras suítes; `soleDevice` já existe no arquivo.)

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration -- test/notifications`
Expected: FAIL (`dropped` ausente, follow-up ainda armado, sem link de opt-out).

- [ ] **Step 7: Implementar `send.ts`, `planner.ts`, scheduler, render, e-mail, capability**

`planner.ts`: apagar `EMAIL_FOLLOWUP_MS`; acrescentar `/** Phase 3 reads a WHATSAPP_TRANSPORT variable; until then the channel exists but never sends. */ export const WHATSAPP_AVAILABLE = false;` e `whatsappAvailable: WHATSAPP_AVAILABLE` em `NotificationConfig` e em `notificationConfigFrom`. Em `test/fixtures/scheduling.ts` `TEST_CONFIG` ganha `whatsappAvailable: false`.

`capability.ts`:
```ts
export const enum PublicTokenPurpose {
  Charge = 'charge',
  Invite = 'invite',
  OptOut = 'opt-out',
  ...
}

/** No expiry: the footer of an old e-mail must still work. Signed over the user id alone. */
export function issueOptOutToken(input: { userId: string; secret: string }): string {
  const mac = signature(PublicTokenPurpose.OptOut, input.userId, 0, input.secret).toString('base64url');

  return `${input.userId}.${mac}`;
}

export function verifyOptOutToken(token: string, secret: string): { userId: string } {
  const [userId, mac] = token.split('.');

  if (!userId || !mac) {
    invalid();
  }

  const expected = signature(PublicTokenPurpose.OptOut, userId, 0, secret);
  const given = Buffer.from(mac, 'base64url');

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    invalid();
  }

  return { userId };
}
```

`client.ts` (e-mail): `headers?: Record<string, string>;` em `EmailInputs.Message` com comentário `/** Extra SMTP headers (List-Unsubscribe); transports without header support ignore them. */`. `vendors/resend/service.ts`: passar `headers: message.headers` no corpo do envio (campo `headers` da API do Resend). Mailpit e file: ignorar.

`render.ts`: `RenderInputs.optOutUrl?: string`. No ramo não-self:
```ts
  const optOut = input.optOutUrl ? `\nPara parar de receber avisos de cobrança do Receivy: ${input.optOutUrl}` : '';
  const text = `${opening}\n${input.description}\nConfira os detalhes: ${url}\n${CLOSING}${optOut}`;
  ...
    body: [chargeRow(...), buttonRow(url, 'Confira os detalhes'), noticeRow(CLOSING), ...(input.optOutUrl ? [noticeRow(`<a href="${escapeHtml(input.optOutUrl)}">Parar de receber avisos de cobrança</a>`)] : [])].join(''),
```
(`escapeHtml` já é exportado por `layout.ts`; conferir se `noticeRow` escapa o texto; se escapar, criar `linkRow(href, label)` em `layout.ts` ao lado de `buttonRow`, com a mesma tabela e um `<a>` simples.)

`send.ts`, mudanças:
1. Imports: `import { type ChannelSet, channelsFor } from '@receivy/common'`; `import { effectiveConfigOf } from '../../billings/utils/reminders'`; `import { ContactRepository } from '../../contacts/repositories/contact'`; `import { issueOptOutToken } from '../../public/services/capability'`; `import { type Dropped, NoticeChannel, resolveChannels } from './channels'`; `export { NoticeChannel }` no lugar do enum local; remover `EMAIL_FOLLOWUP_MS`.
2. `ChargeNotifyEvent = { chargeId: string; template: NoticeTemplate; offsetDays?: number }`.
3. `SendOptions = { offsetDays?: number; channels: ChannelSet }`; `SendResult = { channels: NoticeChannel[]; dropped: Dropped[] }`; `NOTHING = { channels: [], dropped: [] }`.
4. Portão `silenced`: `if (!charge.notify && template !== NoticeTemplate.Manual)`.
5. Após `rendered` (linha 195), substituir 196-226 por:
```ts
  const reach = ownBill ? null : await ContactRepository.reachability(db, charge.creditor_id, target.id);
  const resolved = resolveChannels({ wanted: options.channels, ownBill, target, contact: reach, whatsappAvailable: context.config.whatsappAvailable });
  const wantsPush = context.config.pushAvailable !== false;
  // One entry per device that took the push: the event says how many screens the notice landed on.
  const pushed = wantsPush ? await pushToDevices(db, context.transport, target.id, { title: rendered.subject, url: rendered.url }, now) : 0;
  const channels: NoticeChannel[] = Array.from({ length: pushed }, () => NoticeChannel.Push);

  if (resolved.email && !ownBill && target.email) {
    const result = await context.transport.email({
      to: target.email,
      key: `${chargeId}:${template}:${now}`,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      from: context.config.from ?? 'disabled',
      headers: rendered.optOutUrl ? { 'List-Unsubscribe': `<${rendered.optOutUrl}>` } : undefined
    });

    if (result.status === 'accepted') {
      channels.push(NoticeChannel.Email);
    }
  }

  // Phase 3 sends here; today `resolved.whatsapp` is always false because the transport is unavailable.

  await EventRepository.record(db, {
    type: channels.length ? 'notice.sent' : 'notice.skipped',
    eventableType: EventableType.Charge,
    eventableId: chargeId,
    payload: { ...payload, channels, ...(resolved.dropped.length ? { dropped: resolved.dropped } : {}), ...(channels.length ? {} : { reason: SkipReason.NoChannel }) },
    at: new Date(now).toISOString()
  });

  return { channels, dropped: resolved.dropped };
```
   e no `renderNotice` passar `optOutUrl: ownBill ? undefined : \`${context.config.publicOrigin}/opt-out/${issueOptOutToken({ userId: target.id, secret: context.config.secret })}\``; `renderNotice` devolve `optOutUrl` junto (`return { subject, text, html, url, optOutUrl: input.optOutUrl }`).
6. `notifyCharge`:
```ts
export async function notifyCharge(db: DbClient, context: NoticeContext, chargeId: string, template: NoticeTemplate, now = Date.now(), offsetDays?: number): Promise<SendResult> {
  const charge = await ChargeRepository.forNotice(db, chargeId);

  if (!charge) {
    return NOTHING;
  }

  const channels = channelsFor(effectiveConfigOf(charge.billing), template, offsetDays);

  return sendChargeNotice(db, context, chargeId, template, now, { offsetDays, channels });
}
```
   `charge.billing` precisa de `owner.reminder_config` (Task 3). Apagar `followUpCharge`, `emailAlreadySent`.
7. `planReminders`: evento `{ chargeId: charge.id, template: NoticeTemplate.Reminder, offsetDays: reminder.offsetDays }`.
8. Doc-comments do topo atualizados (sem "follow-up").

`charge-notify.ts`: tipo sem `stage`; handler perde o ramo `followup`; import só de `notifyCharge`.

`notification.ts` (manual, linha 138): `sendChargeNotice(db, notice, chargeId, NoticeTemplate.Manual, now, { channels: config.manual })` onde `config = effectiveConfigOf(row.billing)`; a Task 7 termina esse método.

Grep obrigatório ao final: `grep -rn "followUp\|EMAIL_FOLLOWUP\|stage:\|channel: '" packages/api/src packages/api/test` deve voltar vazio.

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test && pnpm --filter @receivy/api test:integration -- test/notifications test/scheduling`
Expected: PASS (salvo baselines conhecidas).

---

### Task 7: API — lembrete manual pela config, preview e resposta nova

**Files:**
- Create: `packages/api/src/notifications/endpoints/reminder-preview.ts`
- Modify: `packages/api/src/notifications/services/notification.ts:25-28,98-141`, `packages/api/src/notifications/endpoints/manual-reminder.ts`, `packages/api/src/notifications/routes.ts`
- Test: `packages/api/test/notifications/notifications.spec.ts`

**Interfaces:**
- Produces: `NotificationClient.manualReminder(userId, chargeId): Promise<ManualReminderResult>`, `NotificationClient.reminderPreview(userId, chargeId): Promise<ManualReminderResult>`; `ManualReminderResult = { channels: ('push' | 'email' | 'whatsapp')[]; dropped: { channel: 'email' | 'whatsapp'; reason: string }[] }` (declarar em `@receivy/common` `domain/notifications.ts`, com `DropReason` como const enum espelho). Rota `GET /charges/{id}/reminders/preview` (202 vira 200 no preview; o POST continua 202).

- [ ] **Step 1: Testes**

```ts
  it('previews the manual reminder from the owner manual channels without sending, then sends the same', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[manual]', 'manual');
    await accounts.saveReminders(OWNER, { ...SYSTEM_REMINDER_CONFIG, manual: { email: false, whatsapp: true } });

    try {
      const { id } = await charge(OWNER, DEBTOR_EMAIL);

      deepEqual(await notifications.reminderPreview(OWNER, id), { channels: ['push'], dropped: [{ channel: 'whatsapp', reason: 'no_phone' }] });
      equal(sent.pushes.length + sent.emails.length, 0, 'the preview sends nothing');

      deepEqual(await notifications.manualReminder(OWNER, id), { channels: ['push'], dropped: [{ channel: 'whatsapp', reason: 'no_phone' }] });
      equal(sent.emails.length, 0, 'e-mail is off for the manual reminder');
      await rejects(notifications.manualReminder(OWNER, id), ReminderQuotaError);
    } finally {
      await accounts.clearReminders(OWNER);
    }
  });
```
Ajustar os testes existentes de `manualReminder` que esperam `{ queued: true }` para `result.channels.length > 0`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration -- test/notifications`
Expected: FAIL (`reminderPreview` inexistente).

- [ ] **Step 3: Implementar**

`notification.ts`: extrair os portões (403 do credor, `ChargeClosedError`, registro, prova pendente) de `manualReminder` para `async function manualTarget(tx, userId, chargeId)` que devolve `{ row, config }` com `config = effectiveConfigOf(await ChargeRepository.forNotice(tx, chargeId)!.billing)`. Então:
```ts
export async function reminderPreview(db: DbClient, userId: string, chargeId: string, notice: NoticeContext): Promise<ManualReminderResult> {
  const { config } = await manualTarget(db, userId, chargeId);
  const charge = (await ChargeRepository.forNotice(db, chargeId))!;
  const target = charge.debtor && !charge.debtor.deleted_at ? charge.debtor : undefined;

  if (!target) {
    return { channels: [], dropped: [] };
  }

  const reach = await ContactRepository.reachability(db, charge.creditor_id, target.id);
  const resolved = resolveChannels({ wanted: config.manual, ownBill: ownerPays(charge), target, contact: reach, whatsappAvailable: notice.config.whatsappAvailable });
  const devices = await DeviceRepository.active(db, target.id);
  const channels: NoticeChannel[] = [
    ...(devices.length && notice.config.pushAvailable !== false ? [NoticeChannel.Push] : []),
    ...(resolved.email ? [NoticeChannel.Email] : []),
    ...(resolved.whatsapp ? [NoticeChannel.WhatsApp] : [])
  ];

  return { channels, dropped: resolved.dropped };
}
```
`manualReminder` mantém a transação, a cota e o `audit`, e termina com `return sendChargeNotice(db, notice, chargeId, NoticeTemplate.Manual, now, { channels: config.manual })`. O preview do push lista um único `push` (o envio real lista um por aparelho; o cliente só precisa saber que há canal).

Endpoint `reminder-preview.ts` (200, body `ManualReminderResult`), `manual-reminder.ts` passa a `body: ManualReminderResult` em 202. Rota `GET /charges/{id}/reminders/preview` com `sessionAuthorizer`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test:integration -- test/notifications && pnpm --filter @receivy/api openapi:generate`
Expected: PASS; OAS com `reminders/preview` e resposta nova do manual.

---

### Task 8: API — opt-out público de e-mail

**Files:**
- Create: `packages/api/src/public/endpoints/opt-out.ts`, `packages/api/src/public/endpoints/opt-in.ts`
- Modify: `packages/api/src/public/routes.ts`, `packages/api/src/public/services/public-link.ts` (ou o service público que já existe no `PublicProvider`; acrescentar `optOut(token)`/`optIn(token)`)
- Test: `packages/api/test/notifications/notifications.spec.ts` (ou o spec público existente)

**Interfaces:**
- Produces: `POST /public/notices/opt-out/{token}` → 200 `{ optedOut: true }`; `DELETE /public/notices/opt-out/{token}` → 200 `{ optedOut: false }`; 404 para token inválido. Service: `publicLinks.optOut(token): Promise<{ optedOut: boolean }>`, `publicLinks.optIn(token)`.

- [ ] **Step 1: Teste**

```ts
  it('lets the recipient opt out of e-mail through the signed token and opt back in', async () => {
    const { userId } = await charge(OWNER, DEBTOR_EMAIL);
    const token = issueOptOutToken({ userId, secret: TEST_CONFIG.secret });

    deepEqual(await publicLinks.optOut(token), { optedOut: true });
    ok((await AccountRepository.authUser(db, userId)) !== null);

    const row = await db.users.findOne({ select: { email_opt_out_at: true }, where: { id: userId } });

    ok(row?.email_opt_out_at);
    deepEqual(await publicLinks.optIn(token), { optedOut: false });
    await rejects(publicLinks.optOut(`${userId}.bad`), HttpNotFoundError);
  });
```
(`publicLinks` instanciado no fixture com `PUBLIC_LINK_HMAC_SECRET = TEST_CONFIG.secret`, como o service público já é instanciado nos specs de link.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration -- test/notifications`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Service:
```ts
async function setOptOut(db: DbClient, secret: string, token: string, optedOut: boolean): Promise<{ optedOut: boolean }> {
  let userId: string;

  try {
    userId = verifyOptOutToken(token, secret).userId;
  } catch {
    throw new HttpNotFoundError();
  }

  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, userId);

    const now = new Date().toISOString();

    await AccountRepository.setEmailOptOut(tx, userId, optedOut ? now : null, now);
    await EventRepository.record(tx, { type: optedOut ? 'account.email_opted_out' : 'account.email_opted_in', eventableType: EventableType.Account, eventableId: userId, actorId: userId, at: now });
  });

  return { optedOut };
}
```
`optOut: (token) => setOptOut(db, PUBLIC_LINK_HMAC_SECRET, token, true)`, `optIn: (token) => setOptOut(db, PUBLIC_LINK_HMAC_SECRET, token, false)` no `createService` do provider público (variável já declarada lá para os links). Endpoints públicos sem `authorizer`, `parameters: { token: String.Max<200> }`. Rotas em `public/routes.ts`:
```ts
  Http.UseRoute<{ name: 'noticeOptOut'; path: 'POST /public/notices/opt-out/{token}'; handler: typeof optOutHandler }>,
  Http.UseRoute<{ name: 'noticeOptIn'; path: 'DELETE /public/notices/opt-out/{token}'; handler: typeof optInHandler }>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test:integration -- test/notifications && pnpm --filter @receivy/api openapi:generate`
Expected: PASS.

---

### Task 9: API + common — telefone e consentimento no contato

**Files:**
- Create: `packages/common/src/domain/phone.ts`, `packages/common/src/domain/phone.test.ts`
- Modify: `packages/common/src/domain/contacts.ts:22-51,60-95`, `packages/api/src/users/utils/profile.ts` (importar `normalizePhone` do common e apagar a cópia local), `packages/api/src/contacts/utils/parse.ts`, `packages/api/src/contacts/endpoints/update.ts:14`, `packages/api/src/contacts/endpoints/create.ts` (mesmo body), `packages/api/src/contacts/services/contact.ts:151-184`, `packages/api/src/contacts/repositories/contact.ts` (`insert`, `setNickname` → `setDetails`, selects e `contactOf`)
- Test: `packages/api/test/auth-people/*.spec.ts` (spec de contatos), `packages/common/src/domain/contacts.test.ts`

**Interfaces:**
- Produces: `normalizePhone(value: string | null | undefined): string | undefined | false` em `@receivy/common`; `ContactInput.phone?: string`, `ContactInput.whatsappConsent?: boolean`; `Contact.phone: string | null` (o efetivo: pessoa, senão contato), `Contact.phoneSource: 'person' | 'owner' | null`, `Contact.whatsappConsentAt: string | null`; `ContactRepository.setDetails(db, ownerId, id, { nickname?, phone?, consentAt? }, now)`.

- [ ] **Step 1: Testes**

```ts
// packages/common/src/domain/phone.test.ts
import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('normalizes a Brazilian mobile to E.164 and keeps an international one', () => {
    expect(normalizePhone('(11) 99999-8888')).toBe('+5511999998888');
    expect(normalizePhone('+1 415 555 0100')).toBe('+14155550100');
  });

  it('is undefined when empty and false when malformed', () => {
    expect(normalizePhone('')).toBeUndefined();
    expect(normalizePhone('abc')).toBe(false);
  });
});
```
```ts
// packages/common/src/domain/contacts.test.ts — acrescentar
it('normalizes the phone and keeps the consent flag', () => {
  expect(normalizeContact({ name: 'Ana', phone: '(11) 98888-7777', whatsappConsent: true })).toEqual({ name: 'Ana', phone: '+5511988887777', whatsappConsent: true });
  expect(() => normalizeContact({ name: 'Ana', phone: 'x' })).toThrow('Informe um telefone válido.');
});
```
Integração (spec de contatos):
```ts
  it('stores the owner-typed phone and consent, and lets the person own phone win', async () => {
    const saved = await contacts.save(OWNER, { name: 'Zé', email: 'ze@example.com', phone: '11977776666', whatsappConsent: true });

    equal(saved.phone, '+5511977776666');
    equal(saved.phoneSource, 'owner');
    ok(saved.whatsappConsentAt);

    const again = await contacts.save(OWNER, { name: 'Zé', email: 'ze@example.com', whatsappConsent: false }, saved.id);

    equal(again.phone, null);
    equal(again.whatsappConsentAt, null);
    deepEqual(await ContactRepository.reachability(db, OWNER, saved.userId), { phone: undefined, consentAt: undefined });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/common test -- phone contacts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`phone.ts`: mover o corpo de `normalizePhone` de `packages/api/src/users/utils/profile.ts` sem alteração; `profile.ts` passa a `import { normalizePhone } from '@receivy/common'`.

`contacts.ts` (common): `ContactInput` ganha `phone?: string; whatsappConsent?: boolean`; `Contact` ganha `phoneSource: 'person' | 'owner' | null` e `whatsappConsentAt: string | null` (o `phone` existente passa a ser o efetivo). `normalizeContact`:
```ts
  const phone = normalizePhone(input.phone);

  if (phone === false) {
    throw new Error('Informe um telefone válido.');
  }
  ...
    ...(phone ? { phone } : {}),
    ...(input.whatsappConsent !== undefined ? { whatsappConsent: Boolean(input.whatsappConsent) } : {})
```

API: `ContactBody` e os dois endpoints ganham `phone?: String.Max<40>; whatsappConsent?: boolean`. `parse.ts` repassa os dois. `ContactRepository.setDetails` substitui `setNickname`:
```ts
  export async function setDetails(db: DbClient, ownerId: string, id: string, input: { nickname?: string; phone?: string; consentAt?: string }, now: string): Promise<void> {
    await db.contacts.updateOne({
      where: { id, owner_id: ownerId },
      data: { nickname: input.nickname ?? sqlNull, phone: input.phone ?? sqlNull, whatsapp_consent_at: input.consentAt ?? sqlNull, updated_at: now }
    });
  }
```
`insert` grava `phone` e `whatsapp_consent_at` também. No `save` do service: `consentAt = input.whatsappConsent ? existing?.whatsappConsentAt ?? now : undefined` (consentimento já dado mantém a data; desmarcar apaga). Selects de contato (`recentContacts`, `get`, `list`) acrescentam `phone: true, whatsapp_consent_at: true` na tabela `contacts`; `contactOf` monta `phone: row.user.phone ?? row.phone ?? null`, `phoneSource: row.user.phone ? 'person' : row.phone ? 'owner' : null`, `whatsappConsentAt: row.whatsapp_consent_at ?? null`. `canNotifyContact` continua lendo `phone`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test && pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test:integration -- test/auth-people test/notifications && pnpm --filter @receivy/api openapi:generate`
Expected: PASS.

---

### Task 10: Docs e verificação final

**Files:**
- Modify: `docs/notifications.md` (seções "Who sends what", "Channels and the follow-up rule" → "Channels"), `docs/recurrences.md:40-45` (lembretes padrão e teto), `docs/api-oas.yml` (gerado), `packages/api/src/import-cycles.test.ts` (só se acusar ciclo novo: `send.ts` → `contacts/repositories/contact.ts` é import de valor; se ciclar, mover `reachability` para `notifications/repositories/reach.ts`)

- [ ] **Step 1: Atualizar docs**

`docs/notifications.md`: descrever `ReminderConfig`, os três níveis, `channelsFor`, o resolvedor e `dropped`; remover o follow-up; documentar `POST/DELETE /public/notices/opt-out/{token}` e `GET /charges/{id}/reminders/preview`. `docs/recurrences.md`: "Lembrete padrão: dia 0 por e-mail (push sempre que houver aparelho). Até 5 offsets únicos entre -14 e +14. Conta sem lembretes próprios herda o padrão do dono."

- [ ] **Step 2: Verificação completa**

Run:
```bash
pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test
pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test && pnpm --filter @receivy/api test:integration && pnpm --filter @receivy/api openapi:check
pnpm --filter @receivy/web test -- openapi-contract
```
Expected: verde, salvo baselines conhecidas. O contrato do web acusa as rotas novas até o plano de UI entrar na allowlist: registrar no relatório final quais são (`GET/PUT/DELETE account/reminders`, `GET charges/{p}/reminders/preview`, `POST/DELETE public/notices/opt-out/{p}`).

- [ ] **Step 3: Relatório ao dono**

Listar: rotas novas, mudança da resposta do manual (`queued` saiu), colunas novas (nulas, sem migração), `BillingDetail.reminders` agora nulo quando herda, e o que o plano de UI consome. Nada commitado.
