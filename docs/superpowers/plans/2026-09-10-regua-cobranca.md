# Régua de cobrança com canal por etapa — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada etapa da régua declara em quais canais sai, o perfil ganha uma régua padrão que semeia toda cobrança nova, e o schema ganha a noção de plano.

**Architecture:** `packages/common` guarda tipos, limites por plano e validação, sem conhecer banco nem HTTP. Na API o canal viaja da etapa até o envio por três saltos: `planReminders` coloca os canais no evento do schedule, `sendChargeNotice` os recebe em `SendOptions`, e `notifyCharge` decide se arma o follow-up. As duas UIs ganham a mesma peça de edição.

**Tech Stack:** TypeScript, pnpm workspaces, turbo, EZ4 0.52.0 (gateway, database, scheduler), Postgres, Vitest em `common`/`api`/`web`, Jest em `mobile`, Biome.

**Spec:** `docs/superpowers/specs/2026-09-10-regua-cobranca-design.md`

**Escrito contra o código de 11/09/2026**, depois do refactor que trocou fila e tabela de entrega por schedules dinâmicos e `events`, e que moveu tudo para a estrutura por domínio do `CLAUDE.md`.

## Global Constraints

- **Nunca commitar, nunca dar push, nunca rodar migração, nunca fazer deploy.** Onde o passo diz "Revisão", pare e entregue o diff.
- **Nenhuma dependência nova.**
- **Diff mínimo.** Não refatore o que o passo não pede.
- Estrutura de pasta do `CLAUDE.md`: `src/<domínio>/{endpoints,repositories,schemas,services,crons,schedulers,utils}` mais `routes.ts` e `provider.ts`; regra compartilhada em `src/common`; terceiros em `src/vendors`.
- Código, identificadores e comentários em inglês. Mensagem de usuário em português do Brasil.
- `BillingReminder.channels` é **opcional**; etapa sem o campo mantém o comportamento atual. Nenhuma linha é migrada.
- `users.plan` e `users.preferences` entram **opcionais**, nunca `NOT NULL`.
- Teto de etapas vale só na escrita. Régua gravada continua sendo armada por `planReminders` mesmo acima do teto.
- Antes de fechar cada tarefa: `pnpm lint`, `pnpm check-types` e o teste da tarefa.

---

### Task 1: Canal, plano e validação em `packages/common`

**Files:**
- Modify: `packages/common/src/domain/billing.ts`
- Modify: `packages/common/src/domain/billing-calendar.ts`
- Test: `packages/common/src/domain/billing-calendar.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ReminderChannel`, `REMINDER_CHANNELS`, `BillingReminder.channels`, `UserPlan`, `PlanLimits`, `PLAN_LIMITS`, `PROFILE_DEFAULT_REMINDERS`, `normalizeBillingInput(input, limits?)`.

- [ ] **Step 1: Escreva os testes que falham**

Acrescente ao final de `billing-calendar.test.ts`. O `split` já está no escopo do arquivo.

```ts
import { PLAN_LIMITS, PROFILE_DEFAULT_REMINDERS } from './billing';

describe('reminder channels and plan limits', () => {
  const base = { type: 'once' as const, totalCents: 100, startDate: '2026-01-31', timezone: 'UTC', split };

  it('keeps a reminder without channels untouched', () => {
    const result = normalizeBillingInput({ ...base, reminders: [{ offsetDays: 0, enabled: true }] });
    expect(result.reminders).toEqual([{ offsetDays: 0, enabled: true }]);
  });

  it('preserves channels, sorts steps by offset and channels canonically', () => {
    const result = normalizeBillingInput(
      {
        ...base,
        reminders: [
          { offsetDays: 0, enabled: true, channels: ['email', 'push'] },
          { offsetDays: -1, enabled: true, channels: ['push'] }
        ]
      },
      PLAN_LIMITS.pro
    );
    expect(result.reminders).toEqual([
      { offsetDays: -1, enabled: true, channels: ['push'] },
      { offsetDays: 0, enabled: true, channels: ['push', 'email'] }
    ]);
  });

  it('rejects an empty, unknown or repeated channel', () => {
    const reject = (channels: unknown) =>
      expect(() =>
        normalizeBillingInput({ ...base, reminders: [{ offsetDays: 0, enabled: true, channels } as never] }, PLAN_LIMITS.pro)
      ).toThrow(RangeError);

    reject([]);
    reject(['sms']);
    reject(['push', 'push']);
  });

  it('rejects channels when the plan does not allow them', () => {
    expect(() =>
      normalizeBillingInput({ ...base, reminders: [{ offsetDays: 0, enabled: true, channels: ['push'] }] }, PLAN_LIMITS.free)
    ).toThrow(/plano/i);
  });

  it('enforces the plan step ceiling and defaults to free', () => {
    const steps = [
      { offsetDays: -2, enabled: true },
      { offsetDays: -1, enabled: true },
      { offsetDays: 0, enabled: true }
    ];
    expect(() => normalizeBillingInput({ ...base, reminders: steps }, PLAN_LIMITS.free)).toThrow(/no máximo 2/);
    expect(() => normalizeBillingInput({ ...base, reminders: steps })).toThrow(/no máximo 2/);
    expect(normalizeBillingInput({ ...base, reminders: steps }, PLAN_LIMITS.pro).reminders).toHaveLength(3);
  });

  it('ships a profile default that fits the free plan', () => {
    expect(PROFILE_DEFAULT_REMINDERS).toEqual([
      { offsetDays: -1, enabled: true, channels: ['push'] },
      { offsetDays: 0, enabled: true, channels: ['push', 'email'] }
    ]);
    expect(PROFILE_DEFAULT_REMINDERS.length).toBeLessThanOrEqual(PLAN_LIMITS.free.maxSteps);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/common exec vitest run src/domain/billing-calendar.test.ts
```

Esperado: FAIL, `PLAN_LIMITS` não exportado.

- [ ] **Step 3: Tipos em `billing.ts`**

Troque `export type BillingReminder = { offsetDays: number; enabled: boolean };` por:

```ts
export type ReminderChannel = 'push' | 'email';

/** Canonical order: the editor renders and the validator sorts by it. */
export const REMINDER_CHANNELS: ReminderChannel[] = ['push', 'email'];

export type BillingReminder = {
  offsetDays: number;
  enabled: boolean;
  /** Absent keeps today's behaviour: push now, e-mail follow-up two hours later. */
  channels?: ReminderChannel[];
};

export type UserPlan = 'free' | 'pro';

export type PlanLimits = {
  maxSteps: number;
  /** Whether this plan may pick the channel of each step. */
  channels: boolean;
};

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: { maxSteps: 2, channels: false },
  pro: { maxSteps: 5, channels: true }
};
```

Abaixo de `DEFAULT_BILLING_REMINDERS`, que **não muda**:

```ts
/** Seeds a new billing and the profile screen; never a fallback for a stored billing. */
export const PROFILE_DEFAULT_REMINDERS: BillingReminder[] = [
  { offsetDays: -1, enabled: true, channels: ['push'] },
  { offsetDays: 0, enabled: true, channels: ['push', 'email'] }
];
```

- [ ] **Step 4: Validação em `billing-calendar.ts`**

Substitua `validateReminders` inteira por:

```ts
function validateChannels(reminder: BillingReminder, limits: PlanLimits): ReminderChannel[] | undefined {
  if (!reminder.channels) {
    return undefined;
  }

  if (!limits.channels) {
    throw new RangeError('Seu plano não permite escolher o canal de cada lembrete.');
  }

  const channels = reminder.channels;
  const known = channels.every((channel) => REMINDER_CHANNELS.includes(channel));

  if (!channels.length || !known || new Set(channels).size !== channels.length) {
    throw new RangeError('Canais de lembrete inválidos: escolha ao menos um, sem repetir.');
  }

  return REMINDER_CHANNELS.filter((channel) => channels.includes(channel));
}

function validateReminders(reminders: BillingReminder[], limits: PlanLimits): BillingReminder[] {
  const invalid = reminders.some(
    (reminder) => !Number.isInteger(reminder.offsetDays) || Math.abs(reminder.offsetDays) > 90 || typeof reminder.enabled !== 'boolean'
  );
  const unique = new Set(reminders.map((reminder) => reminder.offsetDays)).size === reminders.length;

  if (invalid || !unique) {
    throw new RangeError('Lembretes inválidos: use dias únicos entre -90 e 90.');
  }

  if (reminders.length > limits.maxSteps) {
    throw new RangeError(`Seu plano permite no máximo ${limits.maxSteps} etapas de lembrete.`);
  }

  return [...reminders]
    .map((reminder) => {
      const channels = validateChannels(reminder, limits);

      return channels
        ? { offsetDays: reminder.offsetDays, enabled: reminder.enabled, channels }
        : { offsetDays: reminder.offsetDays, enabled: reminder.enabled };
    })
    .sort((a, b) => a.offsetDays - b.offsetDays);
}
```

Assinatura e chamada:

```ts
export function normalizeBillingInput(input: BillingInput, limits: PlanLimits = PLAN_LIMITS.free): NormalizedBillingInput {
```

```ts
    reminders: input.reminders ? validateReminders(input.reminders, limits) : undefined,
```

- [ ] **Step 5: Rode e confirme que passa**

```bash
pnpm --filter @receivy/common test
```

- [ ] **Step 6: Revisão**

---

### Task 2: `UserPreferences` e merge por chave

**Files:**
- Create: `packages/common/src/domain/user-preferences.ts`
- Create: `packages/common/src/domain/user-preferences.test.ts`
- Modify: `packages/common/src/index.ts`

**Interfaces:**
- Consumes: `BillingReminder` (Task 1).
- Produces: `UserPreferences`, `parsePreferences`, `mergePreferences`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
import { describe, expect, it } from 'vitest';
import { mergePreferences, parsePreferences } from './user-preferences';

describe('user preferences', () => {
  it('reads null, broken JSON and arrays as an empty object', () => {
    expect(parsePreferences(undefined)).toEqual({});
    expect(parsePreferences('não é json')).toEqual({});
    expect(parsePreferences('[]')).toEqual({});
  });

  it('reads a stored object', () => {
    expect(parsePreferences('{"reminders":[{"offsetDays":0,"enabled":true}]}')).toEqual({
      reminders: [{ offsetDays: 0, enabled: true }]
    });
  });

  it('merges by key and keeps keys it does not know', () => {
    const current = { reminders: [{ offsetDays: 0, enabled: true }], future: 'keep me' } as never;
    expect(mergePreferences(current, { reminders: [{ offsetDays: -1, enabled: true }] })).toEqual({
      reminders: [{ offsetDays: -1, enabled: true }],
      future: 'keep me'
    });
  });

  it('ignores an undefined key instead of erasing it', () => {
    expect(mergePreferences({ reminders: [{ offsetDays: 0, enabled: true }] }, { reminders: undefined }).reminders).toEqual([
      { offsetDays: 0, enabled: true }
    ]);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/common exec vitest run src/domain/user-preferences.test.ts
```

- [ ] **Step 3: Escreva o módulo**

```ts
import type { BillingReminder } from './billing';

/**
 * One JSON column on `users`. Every key is optional so an older client never breaks when a new key
 * appears, and a new client never breaks reading an old object.
 */
export type UserPreferences = {
  /** Seeds a new billing form; the notifier never reads it. */
  reminders?: BillingReminder[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Never throws: a broken column must not lock the account out of its own profile. */
export function parsePreferences(raw?: string | null): UserPreferences {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return isObject(parsed) ? (parsed as UserPreferences) : {};
  } catch {
    return {};
  }
}

/** Writes only the keys present in `patch`; an absent or undefined key is left alone. */
export function mergePreferences(current: UserPreferences, patch: UserPreferences): UserPreferences {
  const merged = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}
```

Acrescente `export * from './domain/user-preferences';` no `index.ts`, em ordem alfabética.

- [ ] **Step 4: Rode e confirme que passa**

- [ ] **Step 5: Revisão**

---

### Task 3: `buildBillingInput` e `emptyBillingDraft` recebem a régua

**Files:**
- Modify: `packages/common/src/domain/billing-draft.ts`
- Test: `packages/common/src/domain/billing-draft.test.ts`

**Interfaces:**
- Consumes: Task 1 e 2.
- Produces: `buildBillingInput(draft, limits?)`, `emptyBillingDraft(today, timezone, reminders?)`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
import { PLAN_LIMITS, PROFILE_DEFAULT_REMINDERS } from './billing';

describe('reminder draft channels', () => {
  it('carries channels from the draft into the input', () => {
    const input = buildBillingInput(
      { ...base, reminders: [{ offsetDays: '0', enabled: true, channels: ['push', 'email'] }] },
      PLAN_LIMITS.pro
    );
    expect(input.reminders).toEqual([{ offsetDays: 0, enabled: true, channels: ['push', 'email'] }]);
  });

  it('refuses channels on the free plan', () => {
    expect(() =>
      buildBillingInput({ ...base, reminders: [{ offsetDays: '0', enabled: true, channels: ['push'] }] }, PLAN_LIMITS.free)
    ).toThrow(/plano/i);
  });

  it('seeds an empty draft with the given reminders', () => {
    expect(emptyBillingDraft('2026-01-01', 'America/Sao_Paulo', PROFILE_DEFAULT_REMINDERS).reminders).toEqual([
      { offsetDays: '-1', enabled: true, channels: ['push'] },
      { offsetDays: '0', enabled: true, channels: ['push', 'email'] }
    ]);
  });

  it('keeps the single due-date step when no reminders are given', () => {
    expect(emptyBillingDraft('2026-01-01', 'America/Sao_Paulo').reminders).toEqual([{ offsetDays: '0', enabled: true }]);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Implemente**

`ReminderDraft` já herda `channels?` de `BillingReminder`, então não muda. Em `emptyBillingDraft`:

```ts
export function emptyBillingDraft(today: string, timezone: string, reminders?: BillingReminder[]): BillingDraft {
```

```ts
    reminders: (reminders ?? DEFAULT_BILLING_REMINDERS).map((reminder) => ({
      ...reminder,
      offsetDays: String(reminder.offsetDays)
    }))
```

Em `buildBillingInput`:

```ts
export function buildBillingInput(draft: BillingDraft, limits: PlanLimits = PLAN_LIMITS.free): BillingInput {
```

```ts
    reminders: draft.reminders.map((reminder) => ({
      enabled: reminder.enabled,
      offsetDays: integer(reminder.offsetDays, 'Informe dias inteiros, como -3, 0 ou 2.'),
      ...(reminder.channels ? { channels: reminder.channels } : {})
    }))
```

E passe `limits` como segundo argumento nas **duas** chamadas de `normalizeBillingInput` do arquivo.

- [ ] **Step 4: Rode e confirme que passa**

```bash
pnpm --filter @receivy/common test
```

- [ ] **Step 5: Revisão**

---

### Task 4: `plan` e `preferences` em `users`

**Files:**
- Modify: `packages/api/src/users/schemas/user.ts`
- Modify: `packages/api/src/users/repositories/auth.ts` (o arquivo que monta `AuthUser`)
- Modify: `packages/common/src/auth/auth.ts`
- Test: a spec de conta em `packages/api/test/`

**Interfaces:**
- Consumes: `UserPlan` (Task 1), `parsePreferences` (Task 2).
- Produces: `AuthUser.plan`, `AuthUser.preferences`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
it('starts on the free plan with empty preferences', async () => {
  const response = await client.get('/auth/me', { token });

  expect(response.body.user.plan).toBe('free');
  expect(response.body.user.preferences).toEqual({});
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/api test:integration
```

- [ ] **Step 3: Colunas e tipo**

Em `users/schemas/user.ts`, antes de `created_at`:

```ts
  /** Optional on purpose: a required column over existing rows would need a migration. Absent means 'free'. */
  plan?: 'free' | 'pro';
  /** JSON of UserPreferences; absent or broken reads as an empty object. */
  preferences?: String.Max<4000>;
```

Em `packages/common/src/auth/auth.ts`, dentro de `AuthUser`, antes de `currency`:

```ts
  /** Absent in the database means 'free'; the API never sends null. */
  plan: UserPlan;
  /** Every key optional; an empty object means the person never changed anything. */
  preferences: UserPreferences;
```

No mapeador de `AuthUser`, acrescente ao tipo de entrada `plan?: UserPlan` e `preferences?: string`, e ao objeto devolvido:

```ts
    plan: row.plan ?? 'free',
    preferences: parsePreferences(row.preferences),
```

Acrescente `plan: true` e `preferences: true` a **todo** `select` que alimente esse mapeador. Ache-os por `currency: true`.

- [ ] **Step 4: Rode e confirme que passa**

```bash
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api exec vitest run src
```

- [ ] **Step 5: Revisão**

---

### Task 5: `PUT /account/preferences` com merge por chave

**Files:**
- Create: `packages/api/src/users/endpoints/preferences.ts`
- Modify: `packages/api/src/users/repositories/account.ts`
- Modify: `packages/api/src/users/routes.ts`
- Test: a spec de conta

**Interfaces:**
- Consumes: Tasks 1, 2, 4.
- Produces: `updatePreferences(db, userId, patch): Promise<AuthUser>`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('saves the reminder rule and keeps unknown keys', async () => {
  await promoteToPro(userId);
  await client.put('/account/preferences', { token, body: { reminders: [{ offsetDays: -1, enabled: true, channels: ['push'] }] } });

  const again = await client.put('/account/preferences', { token, body: {} });

  expect(again.body.user.preferences.reminders).toEqual([{ offsetDays: -1, enabled: true, channels: ['push'] }]);
});

it('refuses a rule the plan does not allow', async () => {
  const response = await client.put('/account/preferences', {
    token,
    body: { reminders: [{ offsetDays: -2, enabled: true }, { offsetDays: -1, enabled: true }, { offsetDays: 0, enabled: true }] }
  });

  expect(response.status).toBe(400);
});
```

`promoteToPro` escreve `users.plan` direto, ao lado dos helpers que o arquivo já tem.

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Repositório**

```ts
export async function updatePreferences(db: DbClient, userId: string, patch: UserPreferences): Promise<AuthUser> {
  return db.transaction(async (tx) => {
    const row = await tx.users.findOne({
      select: { id: true, plan: true, preferences: true },
      where: { id: userId, deleted_at: { isNull: true } },
      lock: true
    });

    if (!row) {
      throw new HttpUnauthorizedError();
    }

    if (patch.reminders) {
      try {
        // Same validation a billing rule obeys, so a saved rule can always be copied into one.
        normalizeReminderRule(patch.reminders, PLAN_LIMITS[row.plan ?? 'free']);
      } catch (error) {
        throw new HttpBadRequestError(error instanceof RangeError ? error.message : 'Régua inválida.');
      }
    }

    const merged = mergePreferences(parsePreferences(row.preferences), patch);

    await tx.users.updateOne({
      where: { id: userId },
      data: { preferences: JSON.stringify(merged), updated_at: new Date().toISOString() }
    });

    const user = await findAuthUserById(tx, userId);

    if (!user) {
      throw new HttpUnauthorizedError();
    }

    return user;
  });
}
```

`normalizeReminderRule` é um export magro novo em `billing-calendar.ts`, que só expõe a `validateReminders` da Task 1:

```ts
/** Validates a standalone rule (the profile), under the same rules a billing rule obeys. */
export function normalizeReminderRule(reminders: BillingReminder[], limits: PlanLimits): BillingReminder[] {
  return validateReminders(reminders, limits);
}
```

- [ ] **Step 4: Endpoint e rota**

```ts
declare class ReminderRuleBody {
  offsetDays: Integer.Range<-90, 90>;
  enabled: boolean;
  channels?: ('push' | 'email')[];
}

declare class PreferencesRequest implements Http.Request {
  identity: SessionIdentity;
  body: { reminders?: ReminderRuleBody[] };
}

export async function preferencesHandler(request: PreferencesRequest, context: Service.Context<UserProvider>): Promise<ProfileResponse> {
  return { status: 200, body: { user: await updatePreferences(context.db, request.identity.userId, request.body) } };
}
```

Registre `PUT /account/preferences` em `users/routes.ts`, copiando a forma da rota de perfil, autorizador incluído.

- [ ] **Step 5: Rode e confirme que passa**

```bash
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api run openapi:generate
```

- [ ] **Step 6: Revisão**

---

### Task 6: Billings passam o plano do dono para a validação

**Files:**
- Modify: `packages/api/src/billings/repositories/billing.ts`
- Modify: `packages/api/src/billings/utils/body.ts` (ou onde `ReminderBody` é declarado)
- Test: a spec de billings

**Interfaces:**
- Consumes: `PLAN_LIMITS` (Task 1), coluna `plan` (Task 4).
- Produces: `ownerPlanLimits(db, ownerId): Promise<PlanLimits>`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('refuses channels from a free owner', async () => {
  const response = await createBillingRequest({ reminders: [{ offsetDays: 0, enabled: true, channels: ['push'] }] });
  expect(response.status).toBe(403);
});

it('accepts channels from a pro owner', async () => {
  await promoteToPro(ownerId);
  const response = await createBillingRequest({
    reminders: [
      { offsetDays: -1, enabled: true, channels: ['push'] },
      { offsetDays: 0, enabled: true, channels: ['push', 'email'] }
    ]
  });
  expect(response.status).toBe(201);
  expect(response.body.billing.reminders).toHaveLength(2);
});

it('refuses more steps than the plan allows', async () => {
  const response = await createBillingRequest({
    reminders: [{ offsetDays: -2, enabled: true }, { offsetDays: -1, enabled: true }, { offsetDays: 0, enabled: true }]
  });
  expect(response.status).toBe(400);
});

it('keeps arming a stored rule above the free ceiling after a downgrade', async () => {
  await promoteToPro(ownerId);
  const created = await createBillingRequest({
    reminders: [{ offsetDays: -3, enabled: true }, { offsetDays: -1, enabled: true }, { offsetDays: 0, enabled: true }]
  });
  await demoteToFree(ownerId);

  const read = await client.get(`/billings/${created.body.billing.id}`, { token });

  expect(read.body.billing.reminders).toHaveLength(3);
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Implemente**

Em `billings/repositories/billing.ts`:

```ts
/** A stored rule is never re-checked: the ceiling guards writes only. */
export async function ownerPlanLimits(db: DbClient, ownerId: string): Promise<PlanLimits> {
  const row = await db.users.findOne({ select: { plan: true }, where: { id: ownerId, deleted_at: { isNull: true } } });

  return PLAN_LIMITS[row?.plan ?? 'free'];
}
```

Em `createBilling`, troque `normalizeBillingInput(raw)` por `normalizeBillingInput(raw, await ownerPlanLimits(db, ownerId))`.

Em `patchBilling`, leia `const limits = await ownerPlanLimits(tx, ownerId);` dentro da transação e passe como segundo argumento da chamada de `normalizeBillingInput` daquele bloco.

Acrescente `channels?: ('push' | 'email')[];` ao `ReminderBody`.

O `RangeError` da validação já vira `400`. A mensagem de canal precisa virar `403`: no ponto onde o erro é traduzido, trate a mensagem de plano como `HttpForbiddenError`, mantendo o texto.

- [ ] **Step 4: Rode e confirme que passa**

```bash
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api run openapi:generate
```

- [ ] **Step 5: Revisão**

---

### Task 7: O canal viaja da etapa até o envio

Esta é a tarefa central, e é pequena porque a arquitetura atual já faz quase tudo.

**Files:**
- Modify: `packages/api/src/notifications/schedulers/charge-notify.ts`
- Modify: `packages/api/src/notifications/services/send.ts`
- Test: a spec de notificações

**Interfaces:**
- Consumes: `ReminderChannel` (Task 1).
- Produces: `ChargeNotifyEvent.channels`, `SendOptions.channels`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('pushes only, with no follow-up, when the step asks for push', async () => {
  await registerDevice(debtorToken);
  const result = await notifyWithChannels(['push']);

  expect(result.channels).toEqual(['push']);
  expect(await scheduledFollowUp(chargeId)).toBeUndefined();
});

it('falls back to e-mail when the step asks for push and no device took it', async () => {
  const result = await notifyWithChannels(['push']);

  expect(result.channels).toEqual(['email']);
});

it('sends e-mail straight away when the step asks for e-mail only', async () => {
  await registerDevice(debtorToken);
  const result = await notifyWithChannels(['email']);

  expect(result.channels).toEqual(['email']);
});

it('arms the two-hour follow-up when the step asks for both', async () => {
  await registerDevice(debtorToken);
  const result = await notifyWithChannels(['push', 'email']);

  expect(result.channels).toEqual(['push']);
  expect(await scheduledFollowUp(chargeId)).toBeDefined();
});

it('keeps today behaviour when the step has no channels', async () => {
  await registerDevice(debtorToken);
  const result = await notifyWithChannels(undefined);

  expect(result.channels).toEqual(['push']);
  expect(await scheduledFollowUp(chargeId)).toBeDefined();
});

it('carries the step channels from planReminders into the schedule', async () => {
  await setReminders(billingId, [{ offsetDays: 0, enabled: true, channels: ['email'] }]);
  await planReminders(db, notifySpy, atNoonBefore(dueDate));

  expect(notifySpy.lastEvent().channels).toEqual(['email']);
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Scheduler carrega o canal**

Em `charge-notify.ts`, acrescente ao `ChargeNotifySchedule`:

```ts
  channels?: ('push' | 'email')[];
```

E repasse `event.channels` na chamada de `notifyCharge` dentro do handler.

- [ ] **Step 4: `planReminders` coloca o canal no evento**

Em `send.ts`, dentro do laço de `effectiveReminders`:

```ts
      await notify.setEvent(notifyIdentifier(charge.id), {
        date: at,
        event: {
          chargeId: charge.id,
          template: 'reminder',
          stage: 'first',
          offsetDays: reminder.offsetDays,
          ...(reminder.channels ? { channels: reminder.channels } : {})
        }
      });
```

- [ ] **Step 5: `sendChargeNotice` honra a etapa**

`SendOptions` ganha o campo:

```ts
/** `channels` vem da etapa da régua. `channel` cobre o que não vem de etapa: 'email' no follow-up, 'both' no manual. */
export type SendOptions = { offsetDays?: number; channel?: 'auto' | 'email' | 'both'; channels?: NoticeChannel[] };
```

No cálculo dos dispositivos, o pedido da etapa entra junto do modo:

```ts
  const stepWantsPush = !options.channels || options.channels.includes('push');
  const devices =
    options.channel === 'email' || !stepWantsPush || context.config.pushAvailable === false
      ? []
      : (await db.device_tokens.findMany({ ... })).records;
```

E no e-mail, a regra de fallback continua intacta, só ganha o caso da etapa que pediu e-mail:

```ts
  const stepWantsEmail = !options.channels || options.channels.includes('email');
  const wantsEmail = options.channel === 'both' || stepWantsEmail || !channels.length;
```

- [ ] **Step 6: `notifyCharge` decide o follow-up**

```ts
export async function notifyCharge(
  db: DbClient,
  context: NoticeContext,
  chargeId: string,
  template: NoticeTemplate,
  now = Date.now(),
  offsetDays?: number,
  channels?: NoticeChannel[]
): Promise<SendResult> {
  const result = await sendChargeNotice(db, context, chargeId, template, now, { offsetDays, channel: 'auto', channels });

  // Only a step that asked for e-mail earns the follow-up; a push-only step is done when the push lands.
  const wantsFollowUp = !channels || channels.includes('email');

  if (wantsFollowUp && result.channels.includes('push')) {
    await context.notify.setEvent(...).catch(() => undefined);
  }

  return result;
}
```

O `followUpCharge` **não muda**.

- [ ] **Step 7: Rode e confirme que passa**

```bash
pnpm --filter @receivy/api exec vitest run src
pnpm --filter @receivy/api test:integration
```

- [ ] **Step 8: Revisão**

---

### Task 8: Editor de régua na web

**Files:**
- Create: `packages/web/src/components/app/reminder-rule-editor.tsx` e seu teste
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx`
- Modify: `packages/web/src/components/screens/profile-screen.tsx` e seu teste

**Interfaces:**
- Consumes: `REMINDER_CHANNELS`, `PLAN_LIMITS`, `PROFILE_DEFAULT_REMINDERS`, `AuthUser.plan`, `AuthUser.preferences`.
- Produces: `<ReminderRuleEditor value onChange limits />`.

- [ ] **Step 1: Escreva o teste que falha**

```tsx
import { PLAN_LIMITS } from '@receivy/common';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReminderRuleEditor } from './reminder-rule-editor';

describe('ReminderRuleEditor', () => {
  const rule = [{ offsetDays: 0, enabled: true, channels: ['push' as const] }];

  it('hides the channel toggles on the free plan', () => {
    render(<ReminderRuleEditor value={rule} onChange={vi.fn()} limits={PLAN_LIMITS.free} />);
    expect(screen.queryByLabelText('E-mail')).toBeNull();
  });

  it('toggles a channel on the pro plan', () => {
    const onChange = vi.fn();
    render(<ReminderRuleEditor value={rule} onChange={onChange} limits={PLAN_LIMITS.pro} />);
    fireEvent.click(screen.getByLabelText('E-mail'));
    expect(onChange).toHaveBeenCalledWith([{ offsetDays: 0, enabled: true, channels: ['push', 'email'] }]);
  });

  it('hides the add button at the plan ceiling', () => {
    const full = [{ offsetDays: -1, enabled: true }, { offsetDays: 0, enabled: true }];
    render(<ReminderRuleEditor value={full} onChange={vi.fn()} limits={PLAN_LIMITS.free} />);
    expect(screen.queryByRole('button', { name: 'Adicionar etapa' })).toBeNull();
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/web exec vitest run src/components/app/reminder-rule-editor.test.tsx
```

- [ ] **Step 3: Escreva o componente**

```tsx
'use client';

import { type BillingReminder, type PlanLimits, type ReminderChannel, REMINDER_CHANNELS } from '@receivy/common';

const CHANNEL_LABEL: Record<ReminderChannel, string> = { push: 'Notificação', email: 'E-mail' };

const offsetLabel = (offsetDays: number) => {
  if (offsetDays === 0) return 'No dia do vencimento';
  if (offsetDays < 0) return `${Math.abs(offsetDays)} dia(s) antes`;
  return `${offsetDays} dia(s) depois`;
};

type Props = { value: BillingReminder[]; onChange: (value: BillingReminder[]) => void; limits: PlanLimits };

export function ReminderRuleEditor({ value, onChange, limits }: Props) {
  const replace = (index: number, step: BillingReminder) => onChange(value.map((item, at) => (at === index ? step : item)));

  const toggleChannel = (index: number, channel: ReminderChannel) => {
    const step = value[index];
    const current = step.channels ?? [];
    const next = current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel];

    if (!next.length) {
      return;
    }

    replace(index, { ...step, channels: REMINDER_CHANNELS.filter((item) => next.includes(item)) });
  };

  const addStep = () => {
    const used = new Set(value.map((step) => step.offsetDays));
    const offsetDays = [0, -1, -3, -7, 1, 3, 7].find((candidate) => !used.has(candidate)) ?? 0;

    onChange([...value, { offsetDays, enabled: true, ...(limits.channels ? { channels: ['push' as const] } : {}) }]);
  };

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium text-slate-700">Quando avisar</legend>

      {value.map((step, index) => (
        <div className="flex flex-wrap items-center gap-3" key={step.offsetDays}>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input checked={step.enabled} onChange={() => replace(index, { ...step, enabled: !step.enabled })} type="checkbox" />
            {offsetLabel(step.offsetDays)}
          </label>

          {limits.channels
            ? REMINDER_CHANNELS.map((channel) => (
                <label className="flex items-center gap-1 text-sm text-slate-600" key={channel}>
                  <input
                    aria-label={CHANNEL_LABEL[channel]}
                    checked={(step.channels ?? []).includes(channel)}
                    onChange={() => toggleChannel(index, channel)}
                    type="checkbox"
                  />
                  {CHANNEL_LABEL[channel]}
                </label>
              ))
            : null}

          {value.length > 1 ? (
            <button className="text-sm text-slate-500 underline" onClick={() => onChange(value.filter((_, at) => at !== index))} type="button">
              Remover
            </button>
          ) : null}
        </div>
      ))}

      {value.length < limits.maxSteps ? (
        <button className="self-start text-sm font-medium text-slate-900 underline" onClick={addStep} type="button">
          Adicionar etapa
        </button>
      ) : null}
    </fieldset>
  );
}
```

- [ ] **Step 4: Ligue ao formulário e ao perfil**

No formulário de cobrança, passe `user.preferences.reminders ?? PROFILE_DEFAULT_REMINDERS` como terceiro argumento de `emptyBillingDraft`, e renderize o editor ligado a `draft.reminders`, convertendo `offsetDays` de texto para número na entrada e de volta na saída, do mesmo jeito que o formulário já faz na direção contrária ao carregar uma cobrança existente.

Em `profile-screen.tsx`, renderize o mesmo componente com `limits={PLAN_LIMITS[user.plan]}` e salve com `PUT /account/preferences` mandando `{ reminders }`.

- [ ] **Step 5: Rode a suíte da web**

```bash
pnpm --filter @receivy/web test
pnpm --filter @receivy/web run check-types
```

- [ ] **Step 6: Revisão**

---

### Task 9: Editor de régua no mobile

**Files:**
- Create: `packages/mobile/src/components/app/reminder-rule-editor.tsx` e seu teste
- Modify: `packages/mobile/src/components/forms/billing-form-screen.tsx`
- Modify: `packages/mobile/src/components/screens/profile-screen.tsx` e seu teste

- [ ] **Step 1: Escreva o teste que falha**

```tsx
import { PLAN_LIMITS } from '@receivy/common';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReminderRuleEditor } from './reminder-rule-editor';

describe('ReminderRuleEditor', () => {
  const rule = [{ offsetDays: 0, enabled: true, channels: ['push' as const] }];

  it('hides the channel toggles on the free plan', () => {
    render(<ReminderRuleEditor value={rule} onChange={jest.fn()} limits={PLAN_LIMITS.free} />);
    expect(screen.queryByLabelText('E-mail')).toBeNull();
  });

  it('toggles a channel on the pro plan', async () => {
    const onChange = jest.fn();
    render(<ReminderRuleEditor value={rule} onChange={onChange} limits={PLAN_LIMITS.pro} />);
    await fireEvent.press(screen.getByLabelText('E-mail'));
    expect(onChange).toHaveBeenCalledWith([{ offsetDays: 0, enabled: true, channels: ['push', 'email'] }]);
  });
});
```

`fireEvent` no mobile é aguardado com `await`, como os testes de `components/forms` já fazem.

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/mobile exec jest src/components/app/reminder-rule-editor.test.tsx
```

- [ ] **Step 3: Escreva o componente**

Mesma lógica da Task 8, com `Pressable` e `Text` no lugar de `input` e `label`, classes Uniwind, e `accessibilityLabel={CHANNEL_LABEL[channel]}` no `Pressable` do canal. Copie `offsetLabel`, `toggleChannel` e `addStep` sem alterar a lógica.

Em iOS o `accessibilityLabel` do `Pressable` esconde os textos internos para o matcher, então `getByLabelText` acha o toggle e não o texto dentro dele. É o comportamento desejado aqui.

- [ ] **Step 4: Ligue ao formulário e ao perfil**

Igual à Task 8, nos mesmos dois pontos.

- [ ] **Step 5: Rode a suíte do mobile**

```bash
pnpm --filter @receivy/mobile test
pnpm --filter @receivy/mobile run check-types
```

- [ ] **Step 6: Revisão**

---

### Task 10: Timeline e documentação

**Files:**
- Modify: `packages/api/src/timeline/`
- Modify: a tela de detalhe de cobrança em web e mobile
- Modify: `docs/notifications.md`

- [ ] **Step 1: Escreva o teste que falha**

```ts
it('reports the channels of each notice on the timeline', async () => {
  await promoteToPro(ownerId);
  await registerDevice(debtorToken);
  const charge = await chargeWithRule([{ offsetDays: 0, enabled: true, channels: ['push', 'email'] }]);

  const timeline = await client.get(`/charges/${charge.id}/timeline`, { token });

  expect(timeline.body.items.some((item: { channels?: string[] }) => item.channels?.includes('push'))).toBe(true);
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Implemente**

A timeline já lê `events`. Exponha `payload.channels` de cada `notice.sent` e `payload.reason` de cada `notice.skipped`, sem mudar o formato dos outros itens. Nas telas, mostre o rótulo do canal ao lado do horário, reaproveitando o `CHANNEL_LABEL` das Tasks 8 e 9, exportado de um ponto só para não duplicar texto de usuário.

Em `docs/notifications.md`, descreva a tabela de §6 da spec e o fato de que o follow-up passa a depender da etapa.

- [ ] **Step 4: Verificação final**

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api run openapi:check
```

- [ ] **Step 5: Revisão final**

Entregue o diff completo. Não commite.

---

## Cobertura da spec

| Seção da spec | Tarefa |
|---|---|
| §4.1 `channels` opcional, legado intacto | 1 |
| §4.2 validação e teto por parâmetro | 1, 6 |
| §4.3 `plan`, `preferences`, merge por chave | 2, 4, 5 |
| §5 `PROFILE_DEFAULT_REMINDERS` e semeadura | 1, 3, 8, 9 |
| §6 os três saltos até o envio | 7 |
| §6.1 follow-up inalterado | 7 |
| §7 API, web, mobile, timeline | 5, 6, 8, 9, 10 |
| §8 tetos e gate por plano | 1, 5, 6, 8, 9 |
| §9 testes | todas |
