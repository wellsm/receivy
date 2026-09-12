# Canal WhatsApp na régua — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar `whatsapp` como terceiro canal, alcançando só quem deu opt-in verificado, dentro de uma cota por ciclo, degradando para e-mail quando não puder enviar.

**Architecture:** O cliente da Meta vive em `src/vendors/meta`, no molde de `vendors/expo`. `notifications/services/transport.ts` liga e desliga por variável. A decisão de canal e o envio acontecem no mesmo instante dentro de `sendChargeNotice`, então a cota é consumida exatamente quando a mensagem sai e a degradação cai na regra de fallback que já existe. O status vem por webhook assinado e vira evento; não há máquina de estados nem varredura.

**Tech Stack:** TypeScript, pnpm workspaces, turbo, EZ4 0.52.0 (gateway, database, scheduler), Postgres, Meta Cloud API v21.0 via `fetch`, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-09-10-canal-whatsapp-design.md`

**Depende de:** `docs/superpowers/plans/2026-09-10-regua-cobranca.md` inteiro.

**Escrito contra o código de 11/09/2026.** A versão anterior deste plano tinha doze tarefas, incluindo um spike sobre corpo cru e uma varredura de timeout. As duas sumiram: `Http.RawBody` resolve a assinatura, e sem tabela de entrega não há estado preso para varrer.

## Global Constraints

- **Nunca commitar, nunca dar push, nunca rodar migração, nunca fazer deploy.** Onde o passo diz "Revisão", pare e entregue o diff.
- **Nenhuma dependência nova.** A Meta Cloud API é HTTP com `fetch`, igual ao Expo.
- **Nenhuma credencial em log, resposta ou erro.** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` não aparecem nem parcialmente. Corpo e erro da Meta ficam dentro de `vendors/meta/`, como `vendors/expo/client.ts` já declara para o Expo.
- **Nenhuma conta na Meta é necessária para implementar.** Tudo roda com `NOTIFICATION_WHATSAPP_TRANSPORT=disabled` e `fetch` injetado nos testes.
- Colunas novas são **opcionais**, nunca `NOT NULL`.
- Estrutura de pasta do `CLAUDE.md`.
- Antes de fechar cada tarefa: `pnpm lint`, `pnpm check-types` e o teste da tarefa.

---

### Task 1: Canal e cota em `packages/common`

**Files:**
- Modify: `packages/common/src/domain/billing.ts`
- Test: `packages/common/src/domain/billing-calendar.test.ts`

**Interfaces:**
- Consumes: `ReminderChannel`, `PLAN_LIMITS` da fatia anterior.
- Produces: `ReminderChannel` com `'whatsapp'`, `PlanLimits.whatsappPerCycle`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('accepts whatsapp as a step channel on the pro plan', () => {
  const result = normalizeBillingInput({ ...base, reminders: [{ offsetDays: 0, enabled: true, channels: ['whatsapp'] }] }, PLAN_LIMITS.pro);
  expect(result.reminders?.[0].channels).toEqual(['whatsapp']);
});

it('sorts channels in the canonical order', () => {
  const result = normalizeBillingInput(
    { ...base, reminders: [{ offsetDays: 0, enabled: true, channels: ['whatsapp', 'push'] }] },
    PLAN_LIMITS.pro
  );
  expect(result.reminders?.[0].channels).toEqual(['push', 'whatsapp']);
});

it('carries the quota of each plan', () => {
  expect(PLAN_LIMITS.free.whatsappPerCycle).toBe(0);
  expect(PLAN_LIMITS.pro.whatsappPerCycle).toBe(50);
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/common exec vitest run src/domain/billing-calendar.test.ts
```

- [ ] **Step 3: Implemente**

```ts
export type ReminderChannel = 'push' | 'email' | 'whatsapp';

export const REMINDER_CHANNELS: ReminderChannel[] = ['push', 'email', 'whatsapp'];

export type PlanLimits = {
  maxSteps: number;
  channels: boolean;
  /** WhatsApp messages allowed per subscription cycle; 0 disables the channel. */
  whatsappPerCycle: number;
};

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: { maxSteps: 2, channels: false, whatsappPerCycle: 0 },
  pro: { maxSteps: 5, channels: true, whatsappPerCycle: 50 }
};
```

`NoticeChannel` em `notifications/services/send.ts` passa a ser importado de `@receivy/common` em vez de declarado localmente, para que exista um tipo de canal só no monorepo.

- [ ] **Step 4: Rode e confirme que passa**

```bash
pnpm test && pnpm check-types
```

- [ ] **Step 5: Revisão**

---

### Task 2: Consentimento em `users`

**Files:**
- Modify: `packages/api/src/users/schemas/user.ts`
- Create: `packages/api/src/users/services/whatsapp-consent.ts` e seu teste
- Modify: o mapeador de `AuthUser` em `users/repositories/`
- Modify: `packages/common/src/auth/auth.ts`

**Interfaces:**
- Consumes: nada.
- Produces: colunas de consentimento, `plan_cycle_anchor`, `hasWhatsappConsent(row)`, `AuthUser.whatsapp`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
describe('hasWhatsappConsent', () => {
  const consented = {
    whatsapp_phone: '+5511999999999',
    whatsapp_verified_at: '2026-03-01T00:00:00.000Z',
    whatsapp_opt_in_at: '2026-03-01T00:00:00.000Z'
  };

  it('needs phone, verification and opt-in together', () => {
    expect(hasWhatsappConsent(consented)).toBe(true);
    expect(hasWhatsappConsent({ ...consented, whatsapp_verified_at: undefined })).toBe(false);
    expect(hasWhatsappConsent({})).toBe(false);
  });

  it('lets a newer opt-out beat the opt-in', () => {
    expect(hasWhatsappConsent({ ...consented, whatsapp_opt_out_at: '2026-04-01T00:00:00.000Z' })).toBe(false);
    expect(hasWhatsappConsent({ ...consented, whatsapp_opt_out_at: '2026-02-01T00:00:00.000Z' })).toBe(true);
  });
});
```

Mais um de integração:

```ts
it('reports no consent for a fresh account', async () => {
  const response = await client.get('/auth/me', { token });
  expect(response.body.user.whatsapp).toEqual({ optedIn: false, last4: null });
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Colunas**

Em `users/schemas/user.ts`, antes de `created_at`:

```ts
  /** E.164, proved by code; distinct from `phone`, which is typed at onboarding. */
  whatsapp_phone?: String.Max<20>;
  whatsapp_verified_at?: String.DateTime;
  /** Record of the consent; absent means never accepted. */
  whatsapp_opt_in_at?: String.DateTime;
  /** Beats the opt-in when more recent than it. */
  whatsapp_opt_out_at?: String.DateTime;
  /** Plan cycle start; written by hand today, by the subscription later. */
  plan_cycle_anchor?: String.Date;
```

- [ ] **Step 4: Regra de consentimento**

```ts
// packages/api/src/users/services/whatsapp-consent.ts
export type ConsentRow = {
  whatsapp_phone?: string;
  whatsapp_verified_at?: string;
  whatsapp_opt_in_at?: string;
  whatsapp_opt_out_at?: string;
};

/** Opt-out beats opt-in whenever it is the more recent of the two. */
export function hasWhatsappConsent(row: ConsentRow): boolean {
  if (!row.whatsapp_phone || !row.whatsapp_verified_at || !row.whatsapp_opt_in_at) {
    return false;
  }

  return !row.whatsapp_opt_out_at || Date.parse(row.whatsapp_opt_out_at) < Date.parse(row.whatsapp_opt_in_at);
}
```

Em `AuthUser`:

```ts
  /** Never carries the full number: the UI only needs the last four digits. */
  whatsapp: { optedIn: boolean; last4: string | null };
```

E no mapeador, com os quatro campos acrescentados a todo `select` que o alimenta:

```ts
    whatsapp: { optedIn: hasWhatsappConsent(row), last4: row.whatsapp_phone ? row.whatsapp_phone.slice(-4) : null },
```

- [ ] **Step 5: Rode e confirme que passa**

- [ ] **Step 6: Revisão**

---

### Task 3: Ciclo do plano e contador de cota

**Files:**
- Create: `packages/api/src/users/schemas/plan-usage.ts`
- Create: `packages/api/src/users/repositories/plan-usage.ts` e seu teste
- Modify: `packages/api/src/database.ts`

**Interfaces:**
- Consumes: `PLAN_LIMITS` (Task 1), `plan_cycle_anchor` (Task 2).
- Produces: `cycleStart(anchor, today)`, `takeWhatsappQuota(db, ownerId, now)`.

- [ ] **Step 1: Escreva os testes de ciclo**

```ts
describe('cycleStart', () => {
  it('walks the anchor forward month by month', () => {
    expect(cycleStart('2026-01-12', '2026-03-20')).toBe('2026-03-12');
    expect(cycleStart('2026-01-12', '2026-03-11')).toBe('2026-02-12');
  });

  it('returns the anchor itself on its own day', () => {
    expect(cycleStart('2026-01-12', '2026-01-12')).toBe('2026-01-12');
  });

  it('clamps a day that does not exist in the month', () => {
    expect(cycleStart('2026-01-31', '2026-02-28')).toBe('2026-02-28');
  });

  it('falls back to the first of the month without an anchor', () => {
    expect(cycleStart(undefined, '2026-03-20')).toBe('2026-03-01');
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/api exec vitest run src/users/repositories/plan-usage.test.ts
```

- [ ] **Step 3: `cycleStart`**

```ts
/** The cycle containing `today`, anchored on the subscription start. */
export function cycleStart(anchor: string | undefined, today: string): string {
  if (!anchor) {
    return `${today.slice(0, 7)}-01`;
  }

  const [anchorYear, anchorMonth, anchorDay] = anchor.split('-').map(Number) as [number, number, number];
  const [year, month, day] = today.slice(0, 10).split('-').map(Number) as [number, number, number];
  const months = (year - anchorYear) * 12 + (month - anchorMonth);
  // A cycle that would start this month has not begun while today is earlier than the anchor day.
  const elapsed = day >= Math.min(anchorDay, lastDayOf(year, month)) ? months : months - 1;
  const start = new Date(Date.UTC(anchorYear, anchorMonth - 1 + elapsed, 1));
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const startDay = Math.min(anchorDay, lastDayOf(startYear, startMonth));

  return `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
```

- [ ] **Step 4: Tabela e contador**

```ts
// packages/api/src/users/schemas/plan-usage.ts
export interface PlanUsageSchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  /** First day of the cycle, derived from users.plan_cycle_anchor. */
  cycle_start: String.Date;
  whatsapp_sent: number;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
```

Em `database.ts`, no formato das tabelas vizinhas:

```ts
    Database.UseTable<{
      name: 'plan_usage';
      schema: PlanUsageSchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: { id: Index.Primary; 'user_id:cycle_start': Index.Unique };
    }>,
```

```ts
/**
 * Takes one unit from the owner's cycle. Called at send time, inside the send transaction: the
 * decision and the message leave together, so a unit is never spent on a message that never went out.
 */
export async function takeWhatsappQuota(db: DbClient, ownerId: string, now: number): Promise<boolean> {
  const owner = await db.users.findOne({
    select: { plan: true, plan_cycle_anchor: true, timezone: true },
    where: { id: ownerId, deleted_at: { isNull: true } },
    lock: true
  });

  if (!owner) {
    return false;
  }

  const limit = PLAN_LIMITS[owner.plan ?? 'free'].whatsappPerCycle;

  if (limit <= 0) {
    return false;
  }

  const start = cycleStart(owner.plan_cycle_anchor, civilDate(now, owner.timezone));
  const stamp = new Date(now).toISOString();
  const current = await db.plan_usage.findOne({
    select: { id: true, whatsapp_sent: true },
    where: { user_id: ownerId, cycle_start: start },
    lock: true
  });

  if (!current) {
    await db.plan_usage.insertOne({
      data: { id: crypto.randomUUID(), user: { id: ownerId }, cycle_start: start, whatsapp_sent: 1, created_at: stamp, updated_at: stamp }
    });

    return true;
  }

  if (current.whatsapp_sent >= limit) {
    return false;
  }

  await db.plan_usage.updateOne({ where: { id: current.id }, data: { whatsapp_sent: current.whatsapp_sent + 1, updated_at: stamp } });

  return true;
}
```

`civilDate` vem de `notifications/services/planner.ts`. Como `send.ts` vai importar `takeWhatsappQuota` na Task 6 e `planner.ts` não importa `users/`, não há ciclo de import. **Confirme isso antes de seguir**, porque ciclo de import neste repositório já derrubou o serviço local no primeiro tique de cron.

- [ ] **Step 5: Testes de cota**

```ts
it('lets the quota through up to the plan ceiling and no further', async () => {
  await promoteToPro(ownerId);
  for (let taken = 0; taken < 50; taken++) {
    expect(await takeWhatsappQuota(db, ownerId, Date.now())).toBe(true);
  }
  expect(await takeWhatsappQuota(db, ownerId, Date.now())).toBe(false);
});

it('refuses every message on the free plan', async () => {
  expect(await takeWhatsappQuota(db, ownerId, Date.now())).toBe(false);
});

it('starts over on the next cycle', async () => {
  await promoteToPro(ownerId, { anchor: '2026-01-10' });
  await takeWhatsappQuota(db, ownerId, Date.parse('2026-02-15T12:00:00Z'));

  const usage = await db.plan_usage.findMany({ where: { user_id: ownerId } });

  expect(usage.records.map((row) => row.cycle_start)).toEqual(['2026-02-10']);
});
```

- [ ] **Step 6: Rode e confirme que passa**

- [ ] **Step 7: Revisão**

---

### Task 4: Cliente da Meta em `vendors/meta`

**Files:**
- Create: `packages/api/src/vendors/meta/{client.ts,types.ts,utils.ts}` e `client.test.ts`
- Modify: `packages/api/src/notifications/services/transport.ts`
- Modify: `packages/api/src/notifications/provider.ts`, `ez4.project.js`, `local.env.example`, `dev.env.example`

**Interfaces:**
- Consumes: `SendResult` de `notifications/services/transport.ts`.
- Produces: `createMetaWhatsappClient(env, request)`, `NotificationTransport.whatsapp`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
const message = {
  to: '+5511999999999',
  name: 'charge_reminder',
  language: 'pt_BR' as const,
  params: ['Ana', 'R$ 40,00', '10/03/2026', 'Netflix'],
  urlParam: 'abc123'
};

it('is disabled without the variable', async () => {
  expect(await notificationTransport({}, failFetch).whatsapp(message)).toEqual({ status: 'disabled' });
});

it('returns the wamid as the accepted id', async () => {
  const transport = notificationTransport(env, jsonFetch({ messages: [{ id: 'wamid.ABC' }] }));
  expect(await transport.whatsapp(message)).toEqual({ status: 'accepted', id: 'wamid.ABC' });
});

it('maps 429 and 5xx to transient and 4xx to permanent', async () => {
  expect(await notificationTransport(env, statusFetch(429)).whatsapp(message)).toEqual({ status: 'transient' });
  expect(await notificationTransport(env, statusFetch(503)).whatsapp(message)).toEqual({ status: 'transient' });
  expect(await notificationTransport(env, statusFetch(400)).whatsapp(message)).toEqual({ status: 'permanent' });
});

it('swallows a thrown error instead of leaking it', async () => {
  const transport = notificationTransport(env, () => Promise.reject(new Error('boom')));
  expect(await transport.whatsapp(message)).toEqual({ status: 'uncertain' });
});
```

Os helpers seguem o padrão que `transport.test.ts` já usa para o Expo. `env` traz `NOTIFICATION_WHATSAPP_TRANSPORT: 'meta'`, `WHATSAPP_PHONE_NUMBER_ID: '123'`, `WHATSAPP_ACCESS_TOKEN: 'token'`.

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/api exec vitest run src/notifications/services/transport.test.ts
```

- [ ] **Step 3: O cliente**

`vendors/meta/utils.ts` reaproveita a forma de `vendors/expo/utils.ts`:

```ts
export function httpFailure(status: number): 'transient' | 'permanent' {
  return status === 429 || status >= 500 ? 'transient' : 'permanent';
}
```

```ts
// vendors/meta/client.ts
const API = 'https://graph.facebook.com/v21.0';

export interface MetaWhatsappClient {
  send(input: WhatsappTemplateMessage): Promise<SendResult>;
}

/** Meta bodies/errors never escape this boundary or enter logs. */
export function createMetaWhatsappClient(env: Record<string, string | undefined>, request: typeof fetch): MetaWhatsappClient {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;

  return {
    async send(input) {
      if (!phoneNumberId || !accessToken) {
        return { status: 'disabled' };
      }

      try {
        const response = await request(`${API}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: input.to,
            type: 'template',
            template: {
              name: input.name,
              language: { code: input.language },
              components: [
                { type: 'body', parameters: input.params.map((text) => ({ type: 'text', text })) },
                { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: input.urlParam }] }
              ]
            }
          }),
          signal: AbortSignal.timeout(15_000)
        });

        if (!response.ok) {
          return { status: httpFailure(response.status) };
        }

        const body = (await response.json()) as { messages?: { id?: string }[] };
        const id = body.messages?.[0]?.id;

        return id ? { status: 'accepted', id } : { status: 'uncertain' };
      } catch {
        return { status: 'uncertain' };
      }
    }
  };
}
```

Em `transport.ts`, no molde do Expo:

```ts
  whatsapp(input: WhatsappTemplateMessage): Promise<SendResult>;
```

```ts
    async whatsapp(input) {
      if (env.NOTIFICATION_WHATSAPP_TRANSPORT !== 'meta') {
        return { status: 'disabled' };
      }

      return meta.send(input);
    }
```

Declare as seis variáveis no provider do domínio e os defaults literais em `ez4.project.js` e nos dois `.env.example`. O default de `NOTIFICATION_WHATSAPP_TRANSPORT` é `disabled`.

- [ ] **Step 4: Rode e confirme que passa**

- [ ] **Step 5: Revisão**

---

### Task 5: `renderWhatsapp`

**Files:**
- Modify: `packages/api/src/notifications/services/render.ts` e `render.test.ts`

- [ ] **Step 1: Escreva o teste que falha**

```ts
describe('renderWhatsapp', () => {
  const input = { ...baseInputs, name: 'Ana', description: 'Netflix', cents: 4000, dueDate: '2026-03-10' };

  it('builds the reminder template with positional params', () => {
    const rendered = renderWhatsapp(input, 'reminder', 'secret');

    expect(rendered.name).toBe('charge_reminder');
    expect(rendered.language).toBe('pt_BR');
    expect(rendered.params).toEqual(['Ana', 'R$ 40,00', '10/03/2026', 'Netflix']);
    expect(rendered.urlParam).not.toContain('/');
  });

  it('uses the created template for the initial notice', () => {
    expect(renderWhatsapp(input, 'initial', 'secret').name).toBe('charge_created');
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Implemente**

```ts
/** Positional params follow the order approved at Meta; changing it breaks live messages. */
export function renderWhatsapp(
  input: RenderInputs,
  template: 'initial' | 'reminder',
  secret: string
): { name: string; language: 'pt_BR'; params: string[]; urlParam: string } {
  const amount = `R$ ${Math.floor(input.cents / 100)},${String(input.cents % 100).padStart(2, '0')}`;
  const [year, month, day] = input.dueDate.split('-');
  const token = issuePublicChargeToken({
    publicId: input.publicId,
    version: input.version,
    expiresAtSeconds: input.expires,
    secret,
    purpose: 'charge'
  });

  return {
    name: template === 'initial' ? 'charge_created' : 'charge_reminder',
    language: 'pt_BR',
    params: [input.name, amount, `${day}/${month}/${year}`, input.description],
    // The approved template's URL button is `<origin>/pay/{{1}}`, so only the token travels.
    urlParam: token
  };
}
```

`renderNotice` **não muda**.

- [ ] **Step 4: Rode e confirme que passa**

- [ ] **Step 5: Revisão**

---

### Task 6: WhatsApp dentro de `sendChargeNotice`

**Files:**
- Modify: `packages/api/src/notifications/services/send.ts`
- Test: a spec de notificações

**Interfaces:**
- Consumes: Tasks 1 a 5.
- Produces: `channels` podendo conter `whatsapp`, `providerId` no payload do evento.

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('sends whatsapp when consent, quota and transport all allow', async () => {
  await promoteToPro(ownerId);
  await giveWhatsappConsent(debtorId);

  const result = await notifyWithChannels(['whatsapp']);

  expect(result.channels).toEqual(['whatsapp']);
  expect(await lastNoticeEvent(chargeId)).toMatchObject({ payload: { providerId: 'wamid.ABC' } });
});

it('falls back to e-mail when the transport is off', async () => {
  await promoteToPro(ownerId);
  await giveWhatsappConsent(debtorId);

  expect((await notifyWithChannels(['whatsapp'], { whatsapp: 'disabled' })).channels).toEqual(['email']);
});

it('falls back to e-mail without consent', async () => {
  await promoteToPro(ownerId);
  expect((await notifyWithChannels(['whatsapp'])).channels).toEqual(['email']);
});

it('lets a newer opt-out beat the opt-in', async () => {
  await promoteToPro(ownerId);
  await giveWhatsappConsent(debtorId);
  await optOutWhatsapp(debtorId);

  expect((await notifyWithChannels(['whatsapp'])).channels).toEqual(['email']);
});

it('falls back to e-mail when the cycle quota is gone', async () => {
  await promoteToPro(ownerId);
  await giveWhatsappConsent(debtorId);
  await exhaustQuota(ownerId);

  expect((await notifyWithChannels(['whatsapp'])).channels).toEqual(['email']);
});

it('records why it degraded', async () => {
  await promoteToPro(ownerId);
  const event = await lastNoticeEvent(chargeId);

  expect(event.payload.reason).toBe('no_whatsapp_consent');
});

it('sends whatsapp and push at the same instant', async () => {
  await promoteToPro(ownerId);
  await giveWhatsappConsent(debtorId);
  await registerDevice(debtorToken);

  expect((await notifyWithChannels(['push', 'whatsapp'])).channels).toEqual(['push', 'whatsapp']);
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Implemente**

Em `sendChargeNotice`, depois do bloco de push e antes do bloco de e-mail:

```ts
  const stepWantsWhatsapp = options.channels?.includes('whatsapp') ?? false;
  let whatsappReason: string | undefined;

  if (stepWantsWhatsapp) {
    const consent = await db.users.findOne({
      select: {
        whatsapp_phone: true,
        whatsapp_verified_at: true,
        whatsapp_opt_in_at: true,
        whatsapp_opt_out_at: true
      },
      where: { id: target.id }
    });

    if (context.config.whatsappAvailable === false) {
      whatsappReason = 'whatsapp_disabled';
    } else if (!consent || !hasWhatsappConsent(consent)) {
      whatsappReason = 'no_whatsapp_consent';
    } else if (!(await takeWhatsappQuota(db, charge.creditor_id, now))) {
      whatsappReason = 'quota_exhausted';
    } else {
      const message = renderWhatsapp({ ...renderInputs }, template === 'initial' ? 'initial' : 'reminder', context.config.secret);
      const result = await context.transport.whatsapp({ to: consent.whatsapp_phone as string, ...message });

      if (result.status === 'accepted') {
        channels.push('whatsapp');
        providerId = result.id;
      } else {
        whatsappReason = 'whatsapp_send_failed';
      }
    }
  }
```

Acrescente `whatsappAvailable` a `NotificationConfig` e preencha em `notificationConfigFrom` a partir de `NOTIFICATION_WHATSAPP_TRANSPORT === 'meta'`.

**A degradação não precisa de ramo novo.** A linha que decide o e-mail já é
`options.channel === 'both' || stepWantsEmail || !channels.length`: se o WhatsApp
não entrou e o push não entrou, `channels` está vazio e o e-mail sai sozinho.

No `recordEvent` final, acrescente `providerId` e `whatsappReason` ao payload,
sem mexer no resto:

```ts
    payload: {
      ...payload,
      channels,
      ...(providerId ? { providerId } : {}),
      ...(whatsappReason ? { reason: whatsappReason } : {}),
      ...(channels.length ? {} : { reason: whatsappReason ?? 'no_channel' })
    },
```

- [ ] **Step 4: Rode e confirme que passa**

```bash
pnpm --filter @receivy/api exec vitest run src
pnpm --filter @receivy/api test:integration
```

- [ ] **Step 5: Revisão**

---

### Task 7: Webhook de status e opt-out

**Files:**
- Create: `packages/api/src/notifications/endpoints/whatsapp-webhook.ts` e seu teste
- Create: `packages/api/src/notifications/services/whatsapp-events.ts`
- Modify: `packages/api/src/notifications/routes.ts`

**Interfaces:**
- Consumes: `providerId` no payload (Task 6), consentimento (Task 2).
- Produces: `whatsappVerifyHandler`, `whatsappEventHandler`, `isOptOut(text)`.

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('echoes the challenge when the verify token matches', async () => {
  const response = await whatsappVerifyHandler({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'segredo', 'hub.challenge': '42' } }, context);
  expect(response.body).toBe('42');
});

it('refuses a wrong verify token', async () => {
  await expect(whatsappVerifyHandler({ query: { 'hub.verify_token': 'errado', 'hub.challenge': '42' } }, context)).rejects.toThrow();
});

it('refuses a body whose signature does not match', async () => {
  await expect(whatsappEventHandler(unsignedEvent('wamid.ABC', 'delivered'), context)).rejects.toThrow();
});

it('records delivered and failed for a known wamid', async () => {
  await whatsappEventHandler(signedEvent('wamid.ABC', 'delivered'), context);
  expect(await eventsOfType('notice.delivered')).toHaveLength(1);

  await whatsappEventHandler(signedEvent('wamid.ABC', 'failed'), context);
  expect(await eventsOfType('notice.failed')).toHaveLength(1);
});

it('ignores an unknown wamid, sent and read', async () => {
  await whatsappEventHandler(signedEvent('wamid.NOPE', 'delivered'), context);
  await whatsappEventHandler(signedEvent('wamid.ABC', 'sent'), context);
  await whatsappEventHandler(signedEvent('wamid.ABC', 'read'), context);
  expect(await eventsOfType('notice.delivered')).toHaveLength(0);
});

it.each(['SAIR', 'sair', ' Sair! ', 'PARAR', 'stop'])('records the opt-out for %s', async (text) => {
  await whatsappEventHandler(signedMessage('+5511999999999', text), context);
  expect(await userByWhatsappPhone('+5511999999999')).toMatchObject({ whatsapp_opt_out_at: expect.any(String) });
});

it('ignores any other inbound message', async () => {
  await whatsappEventHandler(signedMessage('+5511999999999', 'oi'), context);
  expect(await userByWhatsappPhone('+5511999999999')).toMatchObject({ whatsapp_opt_out_at: null });
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Opt-out**

```ts
const OPT_OUT_WORDS = new Set(['SAIR', 'PARAR', 'STOP']);

/** Matches the word regardless of accents, case, spacing or trailing punctuation. */
export function isOptOut(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}]/gu, '')
    .toUpperCase();

  return OPT_OUT_WORDS.has(normalized);
}
```

- [ ] **Step 4: Handlers**

O corpo cru chega porque a rota declara `body: string`, que é `Http.RawBody`.

```ts
declare class WhatsappEventRequest implements Http.Request {
  headers: { 'x-hub-signature-256'?: String.Max<200> };
  body: string;
}
```

`whatsappEventHandler`, nesta ordem: calcula `sha256=` mais o HMAC-SHA256 do corpo cru com `WHATSAPP_APP_SECRET`, compara com `timingSafeEqual` sobre buffers de mesmo tamanho, lança `HttpNotFoundError` quando não bate, e só então dá `JSON.parse`. Nunca devolve mensagem que confirme o formato esperado.

Depois: para cada `statuses[]`, busca o `notice.sent` cujo `payload.providerId` bate; `delivered` grava `notice.delivered`, `failed` grava `notice.failed` e chama `sendChargeNotice` daquele evento com `channel: 'email'`; `sent` e `read` não fazem nada. Para cada `messages[]`, se `isOptOut(text)` grava `whatsapp_opt_out_at` no usuário cujo `whatsapp_phone` bate com o remetente normalizado. `wamid` desconhecido é ignorado e o handler responde `200`.

`whatsappVerifyHandler` compara `hub.verify_token` com `WHATSAPP_VERIFY_TOKEN` em tempo constante e devolve `hub.challenge` como texto.

- [ ] **Step 5: Rotas**

```ts
  Http.UseRoute<{ name: 'whatsappVerify'; path: 'GET /webhooks/whatsapp'; handler: typeof whatsappVerifyHandler }>,
  Http.UseRoute<{
    name: 'whatsappEvent';
    path: 'POST /webhooks/whatsapp';
    handler: typeof whatsappEventHandler;
    preferences: { namingStyle: 'snake' };
  }>
```

Sem autorizador, como as rotas públicas já são.

- [ ] **Step 6: Rode e confirme que passa**

```bash
pnpm --filter @receivy/api exec vitest run src
pnpm --filter @receivy/api run openapi:generate
```

- [ ] **Step 7: Revisão**

---

### Task 8: Opt-in na página pública e opt-out autenticado

**Files:**
- Create: `packages/api/src/users/schemas/whatsapp-verification.ts`
- Create: `packages/api/src/public/endpoints/whatsapp-code.ts` e `whatsapp-confirm.ts`
- Create: `packages/api/src/users/endpoints/whatsapp-opt-out.ts`
- Modify: `packages/api/src/public/routes.ts`, `users/routes.ts`, `common/utils/throttle.ts`, `database.ts`

**Interfaces:**
- Consumes: `resolvePublicCharge`, throttle, `transport.whatsapp` (Task 4).
- Produces: as três rotas.

- [ ] **Step 1: Escreva os testes que falham**

```ts
it('sends a code and records the opt-in once confirmed', async () => {
  await client.post(`/public/charges/${token}/whatsapp/code`, { body: { phone: '11999999999' } });
  const code = await lastWhatsappCode(debtorId);

  const response = await client.post(`/public/charges/${token}/whatsapp/confirm`, { body: { code } });

  expect(response.body.whatsapp).toEqual({ optedIn: true, last4: '9999' });
  expect(await userById(debtorId)).toMatchObject({ whatsapp_phone: '+5511999999999' });
});

it('blocks after five wrong codes', async () => {
  await client.post(`/public/charges/${token}/whatsapp/code`, { body: { phone: '11999999999' } });
  for (let attempt = 0; attempt < 5; attempt++) {
    await client.post(`/public/charges/${token}/whatsapp/confirm`, { body: { code: '000000' } });
  }
  const response = await client.post(`/public/charges/${token}/whatsapp/confirm`, { body: { code: await lastWhatsappCode(debtorId) } });
  expect(response.status).toBe(400);
});

it('refuses an invalid public token without creating a verification', async () => {
  const response = await client.post('/public/charges/lixo/whatsapp/code', { body: { phone: '11999999999' } });
  expect(response.status).toBe(404);
  expect(await verificationCount()).toBe(0);
});

it('never returns the full number', async () => {
  const response = await client.get(`/public/charges/${token}`);
  expect(JSON.stringify(response.body)).not.toContain('999999999');
});

it('records an opt-out from the authenticated route', async () => {
  const response = await client.post('/account/whatsapp/opt-out', { token: debtorToken });
  expect(response.body.user.whatsapp.optedIn).toBe(false);
});
```

- [ ] **Step 2: Rode e confirme que falha**

- [ ] **Step 3: Tabela**

```ts
export interface WhatsappVerificationSchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  phone: String.Max<20>;
  code_hash: String.Max<128>;
  attempts: number;
  expires_at: String.DateTime;
  consumed_at?: String.DateTime;
  created_at: String.DateTime;
}
```

Registre em `database.ts` no formato das vizinhas, com índice secundário em `user_id`.

- [ ] **Step 4: Endpoints**

O de código resolve a cobrança pelo token público, normaliza o telefone com o `normalizePhone` que `users/` já tem (exporte-o em vez de duplicar), consome qualquer verificação viva do usuário, grava a nova com hash e dez minutos de validade, e manda `WHATSAPP_TEMPLATE_VERIFY`.

O de confirmação confere o código, incrementa `attempts`, recusa acima de cinco, e no acerto grava `whatsapp_phone`, `whatsapp_verified_at` e `whatsapp_opt_in_at`, limpando `whatsapp_opt_out_at`, registra um evento de conta e dispara o e-mail de aviso pelo transporte de e-mail já existente.

Dois baldes novos em `common/utils/throttle.ts`, no padrão dos existentes:

```ts
export const WHATSAPP_CODE: TokenBucket = { scope: 'whatsapp-code', limit: 5 };
export const WHATSAPP_CONFIRM: TokenBucket = { scope: 'whatsapp-confirm', limit: 20 };
```

A rota autenticada de opt-out grava `whatsapp_opt_out_at` e devolve o `AuthUser` atualizado.

- [ ] **Step 5: Rode e confirme que passa**

```bash
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api run openapi:generate
```

- [ ] **Step 6: Revisão**

---

### Task 9: Bloco de opt-in na web, toggle na régua e documentação

**Files:**
- Modify: `packages/web/src/app/pay/[token]/page.tsx` e a tela que ela renderiza
- Modify: `packages/web/src/components/screens/profile-screen.tsx`
- Modify: os dois `reminder-rule-editor.tsx`
- Modify: `docs/notifications.md`, `docs/environments.md`

- [ ] **Step 1: Escreva os testes que falham**

```tsx
it('offers the whatsapp opt-in and hides the field once confirmed', async () => {
  render(<PublicChargeScreen charge={charge} />);

  fireEvent.click(screen.getByLabelText('Avisar no WhatsApp'));
  fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '11999999999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));

  fireEvent.change(await screen.findByLabelText('Código'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

  expect(await screen.findByText(/final 9999/i)).toBeVisible();
  expect(screen.queryByLabelText('Telefone')).toBeNull();
});

it('offers whatsapp as a step channel', () => {
  render(<ReminderRuleEditor value={rule} onChange={vi.fn()} limits={PLAN_LIMITS.pro} />);
  expect(screen.getByLabelText('WhatsApp')).toBeVisible();
});
```

- [ ] **Step 2: Rode e confirme que falha**

```bash
pnpm --filter @receivy/web test
```

- [ ] **Step 3: Implemente**

`CHANNEL_LABEL` das duas plataformas ganha `whatsapp: 'WhatsApp'`. Como o editor já percorre `REMINDER_CHANNELS`, o toggle aparece sozinho depois da Task 1.

Na página pública, o bloco de opt-in é renderizado sempre que a cobrança está pendente, independente do template que trouxe a pessoa até ali. Depois de confirmado, mostre apenas `WhatsApp ativo, final 9999`.

No perfil, mostre o consumo do ciclo e o botão de opt-out.

Em `docs/notifications.md`, descreva o canal novo, o bloco de §8 da spec e o fato de que não existe varredura de status. Em `docs/environments.md`, documente as seis variáveis, deixando claro que nenhuma é necessária para rodar local.

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
| §3 onde cada coisa mora | todas |
| §4 variáveis e liga/desliga | 4 |
| §5 consentimento, fluxo, risco aceito | 8 |
| §6.1 colunas de consentimento e âncora | 2 |
| §6.2 `whatsapp_verifications` | 8 |
| §6.3 `plan_usage` | 3 |
| §6.4 eventos novos | 6, 7 |
| §7 templates e `renderWhatsapp` | 5 |
| §8 envio, degradação sem ramo novo | 6 |
| §9 webhook, assinatura, opt-out | 7 |
| §9.4 ausência de varredura | 7 |
| §10 ciclo, contagem e limites | 1, 3 |
| §11 régua e editor | 1, 9 |
| §12 segurança | 4, 7, 8 |
| §13 testes | todas |
