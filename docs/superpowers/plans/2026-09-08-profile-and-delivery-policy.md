# Perfil enxuto e política de entrega — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perfil com 3 abas no mobile e no web, remoção de sessões/export/preferências de notificação/lista de dispositivos da API e clientes, e nova política de entrega (lembrete 09:00 no fuso da cobrança, push antes do e-mail com 2 h de espera).

**Architecture:** `common` guarda o default de lembretes e os helpers de fuso. A API perde 8 rotas e uma tabela; o worker atual (`outbox.ts`/`worker.ts`) ganha a política de horário e o e-mail de follow-up. Web e mobile ganham uma `ProfileScreen` cada, o mobile extrai a `TabBar` do Feed.

**Tech Stack:** EZ4 0.52 + Postgres (`node:test` specs via `DatabaseTester`), Next 16 + vitest/jsdom, Expo SDK 56 + jest/RNTL, Biome (api/common), eslint (web).

**Spec:** `docs/superpowers/specs/2026-09-08-profile-and-delivery-policy-design.md`

## Global Constraints

- Nunca commitar `local.env`/`dev.env`/`prd.env`/`.env.local`; nunca logar códigos, tokens ou cookies.
- Sem dependência nova. Sem migração: banco local é recriado.
- Código, identificadores, comentários e commits em inglês; UI em pt-BR.
- Cada task roda lint + typecheck + testes do pacote antes de commitar. Mensagens de commit: Conventional Commits, sem atribuição a IA no corpo além dos trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_016BY3v9hkgmh7emjR6A5gG2`.
- Lembrete padrão: `[{ offsetDays: 0, enabled: true }]`. Hora do lembrete: `09:00` no `billings.timezone`. Follow-up de e-mail: 2 horas após o push. Adiamento do worker antes das 09:00: 15 minutos.
- Rotas que ficam: `PATCH /account/profile`, `DELETE /account`, `POST /devices`, `POST /charges/{id}/reminders`, `GET /charges/{id}/deliveries`. Funções que ficam: `assertActiveSession`, `revokeSession`, `disableSessionDevices`, `revokeFamilyByRefreshToken`, `registerDevice`.
- Textos e `accessibilityLabel`/`aria-label` do Perfil exatamente como na spec §3.
- Estilo: early returns, linhas em branco entre blocos, nada de componentes em uma linha (ver `packages/mobile/src/components/feed-screen.tsx` como referência).

---

### Task 1: Common — default de lembretes, helpers de fuso, contratos

**Files:**
- Modify: `packages/common/src/domain/billing.ts:10`
- Modify: `packages/common/src/domain/billing-calendar.ts`
- Modify: `packages/common/src/domain/account.ts`
- Modify: `packages/common/src/domain/notifications.ts`
- Test: `packages/common/src/domain/billing-calendar.test.ts` (criar se não existir; se existir, acrescentar)

**Interfaces:**
- Produces: `zonedInstant(localDate: string, time: string, timezone: string): string` (ISO UTC), `civilHour(now: number, timezone: string): number` (0–23), `DEFAULT_BILLING_REMINDERS = [{ offsetDays: 0, enabled: true }]`.
- Removes: `AccountSession`, `NotificationPreferences`.

- [ ] **Step 1: Failing tests**

```ts
// packages/common/src/domain/billing-calendar.test.ts (append or create)
import { describe, expect, it } from 'vitest';
import { civilHour, zonedInstant } from './billing-calendar';
import { DEFAULT_BILLING_REMINDERS } from './billing';

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
```

- [ ] **Step 2: Run** `pnpm --filter @receivy/common test -- billing-calendar` → FAIL (`zonedInstant` not exported; default mismatch).

- [ ] **Step 3: Implement**

```ts
// packages/common/src/domain/billing.ts:10
export const DEFAULT_BILLING_REMINDERS: BillingReminder[] = [{ offsetDays: 0, enabled: true }];
```

```ts
// packages/common/src/domain/billing-calendar.ts (append)
const CLOCK_PARTS: Intl.DateTimeFormatOptions = {
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
};

function zoneOffsetMs(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...CLOCK_PARTS }).formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));

  return asUtc - utcMs;
}

/** UTC instant of `localDate` at `time` (HH:mm) in `timezone`. Brazil has no DST, so one offset lookup is exact. */
export function zonedInstant(localDate: string, time: string, timezone: string): string {
  const guess = Date.parse(`${localDate}T${time}:00Z`);

  return new Date(guess - zoneOffsetMs(guess, timezone)).toISOString();
}

export function civilHour(now: number, timezone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit' }).format(now));
}
```

Remove `AccountSession` from `account.ts` and `NotificationPreferences` from `notifications.ts` (keep `DeviceRegistration`, `NotificationDevice`, `NotificationDelivery`). Check `packages/common/src/index.ts` re-exports still compile.

- [ ] **Step 4: Run** `pnpm --filter @receivy/common test && pnpm --filter @receivy/common lint && pnpm --filter @receivy/common check-types` → PASS. Typecheck of other packages will break until Tasks 2, 4, 5 — expected.

- [ ] **Step 5: Commit** `feat(common): due-date-only reminder default and zoned clock helpers`

---

### Task 2: API — remover sessões, export, preferências e lista de dispositivos

**Files:**
- Modify: `packages/api/src/routes/account.ts`, `packages/api/src/routes/notifications.ts`
- Modify: `packages/api/src/account/endpoints.ts`, `packages/api/src/account/repository.ts` (remover `createExportTicket`, `downloadExport`, `signature`, re-export de `listSessions`), `packages/api/src/account/sessions.ts` (remover `listSessions`), `packages/api/src/account/deletion.ts:135`
- Modify: `packages/api/src/notifications/endpoints.ts`, `packages/api/src/notifications/repository.ts` (remover `getPreferences`, `savePreferences`, `listDevices`, `removeDevice`), `packages/api/src/database.ts:41-45`, `packages/api/src/schemas/notification.ts` (`NotificationPreferenceSchema`)
- Modify: `packages/api/src/billings/repository.ts:85-94`, `packages/api/src/notifications/outbox.ts:141`, `packages/api/src/notifications/worker.ts:116-121,276`
- Modify: `packages/api/test/fixtures/financial.ts:55`, `packages/api/test/account/account.spec.ts`, `packages/api/test/billings/billings.spec.ts:310-330`, `packages/api/test/notifications/notifications.spec.ts` (casos 147, 377, 450, 553-600 que usam `savePreferences`/`removeDevice`)
- Modify: `docs/account-lifecycle.md`, `docs/superpowers/specs/2026-09-08-billings-and-queues-design.md` (§3 tabela `notification_preferences`, §4 "Lembretes", §6 `NotificationCron`)
- Regenerate: `docs/openapi.json` (`pnpm --filter @receivy/api openapi:generate`)

**Interfaces:**
- Consumes: `DEFAULT_BILLING_REMINDERS` (Task 1).
- Produces: `effectiveReminders(db, row)` sem acesso ao banco além do próprio row (`row.reminders ?? DEFAULT_BILLING_REMINDERS`); `planDelivery` sem preferências (e-mail sempre permitido; push quando há `device_tokens` ativos e `config.pushAvailable !== false`).

- [ ] **Step 1: Ajustar specs primeiro**

`billings.spec.ts:310-330` (caso de fallback de preferências): trocar por asserção de que um billing sem `reminders` materializa lembretes com `DEFAULT_BILLING_REMINDERS` (`[0]`).

`account.spec.ts`: remover os casos que chamam `listSessions`, `revokeSession` por id vindo de listagem, `createExportTicket`/`downloadExport` (`it('validates profile and exports only own data…')` vira só a validação de perfil). Manter `it('logout and refresh replay remove only corresponding push registrations…')` e o caso de exclusão.

`notifications.spec.ts`: remover chamadas a `savePreferences`/`getPreferences`/`removeDevice`. O caso `it('enforces ownership, preferences, registration removal and concurrent manual quota')` vira `it('enforces ownership and concurrent manual quota')`. O caso `it('freezes a billing with its own reminders, ignoring later preference changes')` vira "billing with own reminders keeps them; billing without reminders uses the due-date default". Casos que removem token via `removeDevice` (553-600) passam a desativar via `disableSessionDevices` ou via `db.device_tokens.updateOne({ data: { active: false } })`, preservando o que cada caso prova (token liberado para outra conta, histórico não transferido).

- [ ] **Step 2: Run** `pnpm --filter @receivy/api test` → FAIL nos casos ajustados (funções ainda existem mas asserções mudaram) — ok.

- [ ] **Step 3: Remover**

```ts
// packages/api/src/routes/account.ts
import type { deleteHandler, profileHandler } from '../account/endpoints';
export type AccountRoutes = [
  Http.UseRoute<{ name: 'updateProfile'; path: 'PATCH /account/profile'; authorizer: typeof sessionAuthorizer; handler: typeof profileHandler }>,
  Http.UseRoute<{ name: 'deleteAccount'; path: 'DELETE /account'; authorizer: typeof sessionAuthorizer; handler: typeof deleteHandler }>
];
```

```ts
// packages/api/src/routes/notifications.ts — keep only
registerDevice (POST /devices), manualReminder (POST /charges/{id}/reminders), listDeliveries (GET /charges/{id}/deliveries)
```

```ts
// packages/api/src/billings/repository.ts
export function effectiveReminders(row: Pick<BillingRow, 'reminders'>): BillingReminder[] {
  return parseReminders(row) ?? DEFAULT_BILLING_REMINDERS;
}
```
Atualizar todos os chamadores (`outbox.ts` `scheduleReminders`, e qualquer uso em `billings/repository.ts`/`request.ts`) para a assinatura síncrona.

`outbox.ts:141-152`: remover `preferences`; `devices` = tokens ativos se `config.pushAvailable !== false`; `reason` `no_enabled_channel` só quando `!devices.length && !inputs.email`.

`worker.ts`: remover o bloco `recipient_preference` (116-121) e a checagem de `emailEnabled` em `fallback` (276); remover import de `getPreferences`.

`database.ts`: remover a tabela `notification_preferences`; `schemas/notification.ts`: remover `NotificationPreferenceSchema`. `deletion.ts:135` e `fixtures/financial.ts:55`: remover as linhas.

`account/repository.ts`: remover `createExportTicket`, `downloadExport`, `signature` e o re-export de `listSessions`; `sessions.ts`: remover `listSessions`. `account/endpoints.ts`: remover handlers/tipos de sessões e export.

`notifications/endpoints.ts`: remover `getPreferencesHandler`, `savePreferencesHandler`, `listDevicesHandler`, `removeDeviceHandler`, `PreferencesRequest`, `PreferencesResponse`, `DevicesResponse`; `repository.ts`: remover `getPreferences`, `savePreferences`, `listDevices`, `removeDevice`.

- [ ] **Step 4: Docs**

`docs/account-lifecycle.md`: apagar "## Export" e as frases de listar/revogar sessões em "## Profile and sessions" (manter logout, refresh replay, exclusão). Spec de billings: §3 tirar `notification_preferences` da lista de tabelas que ficam; §4 "Lembretes": "`billings.reminders` (se não nulo) → `DEFAULT_BILLING_REMINDERS` (`[0]`)"; §6 `NotificationCron`: idem. Rodar `pnpm --filter @receivy/api openapi:generate`.

- [ ] **Step 5: Run** `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test` → PASS (Postgres via `docker` `receivy-pg`; usar `scripts/prepare-test-database.mjs` como as specs já fazem).

- [ ] **Step 6: Commit** `refactor(api)!: drop session listing, export and notification preferences` com corpo listando as rotas removidas.

---

### Task 3: API — política de entrega (09:00 local, push antes do e-mail)

**Files:**
- Modify: `packages/api/src/notifications/outbox.ts` (`scheduleReminders`, `expandOutbox`, `planDelivery`)
- Modify: `packages/api/src/notifications/worker.ts` (`fallback`)
- Test: `packages/api/test/notifications/notifications.spec.ts`

**Interfaces:**
- Consumes: `zonedInstant`, `civilHour` (Task 1); `planDelivery` sem preferências (Task 2).
- Produces: constantes `REMINDER_HOUR = 9`, `REMINDER_RETRY_MS = 15 * 60_000`, `EMAIL_FOLLOWUP_MS = 2 * 3600_000` em `outbox.ts`; `notification_deliveries.reason = 'push_followup'` para o e-mail agendado.

- [ ] **Step 1: Failing specs** (usar os fixtures e helpers já presentes em `notifications.spec.ts`: `runNotifications` com `clock` injetado, transporte fake, `registerDevice` para criar token)

```ts
it('schedules reminders at 09:00 in the billing timezone and holds them until then', async () => {
  // billing timezone America/Sao_Paulo, charge due 2026-09-10, no own reminders (default [0])
  // run at 2026-09-10T11:45:00Z (08:45 local): expect no delivery and the reminder event available_at moved +15min
  // run at 2026-09-10T12:00:00Z: expect one delivery created and sent
});

it('sends push first and the e-mail two hours later only while the charge is still pending', async () => {
  // recipient with active device + email; charge.created event
  // run at T: push delivery sent; email delivery exists with state pending, reason 'push_followup', available_at = T+2h
  // run at T+1h: email not sent
  // mark charge paid; run at T+2h: email suppressed with reason 'charge_or_capability_inactive'
});

it('sends the follow-up e-mail at T+2h when the charge stays pending', async () => {
  // same setup, run at T+2h: email sent once; second run does not resend
});

it('advances the follow-up e-mail when the push fails definitively', async () => {
  // transport push returns definitive failure (DeviceNotRegistered); expect email available_at <= now, then sent in the same/next run; no duplicate email row
});

it('e-mails immediately when the recipient has no active device', async () => {
  // no device: single email delivery, available_at = now, reason null
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
// outbox.ts
import { addCalendarDays, civilHour, zonedInstant } from '@receivy/common';

export const REMINDER_HOUR = 9;
export const REMINDER_RETRY_MS = 15 * 60_000;
export const EMAIL_FOLLOWUP_MS = 2 * 3600_000;
```

`scheduleReminders`: `available_at: zonedInstant(localDate, '09:00', billing.timezone)`; comentário: "Scan starts at 09:00 local; the worker re-checks the civil clock defensively."

`expandOutbox` (bloco `charge.reminder`):
```ts
const date = civilDate(now, schedule.timezone);
const early = date < schedule.localDate || (date === schedule.localDate && civilHour(now, schedule.timezone) < REMINDER_HOUR);

if (early) {
  await tx.outbox_events.updateOne({ where: { id: row.id }, data: { available_at: new Date(now + REMINDER_RETRY_MS).toISOString() } });
  return;
}
```

`planDelivery` — `recipients` passa a carregar `availableAt` e `reason`:
```ts
type Recipient = { channel: 'push' | 'email'; key: string; deviceId?: string; availableAt: number; reason?: string };

const recipients: Recipient[] = devices.length
  ? [
      ...devices.map((device) => ({ channel: 'push' as const, key: device.id, deviceId: device.id, availableAt: now })),
      ...(inputs.email ? [{ channel: 'email' as const, key: inputs.email, availableAt: now + EMAIL_FOLLOWUP_MS, reason: 'push_followup' }] : [])
    ]
  : [{ channel: 'email' as const, key: inputs.email ?? 'manual-only', availableAt: now }];
```
No insert da delivery: `available_at: new Date(recipient.availableAt).toISOString()`, `reason: reason ?? recipient.reason` (a razão de supressão `pix_required`/`charge_or_capability_inactive`/`no_enabled_channel` continua vencendo e mantendo o estado atual da delivery suprimida).

`worker.ts` `fallback`:
```ts
const email = rows.find((row) => row.channel === 'email');

if (rows.some((row) => row.channel === 'push' && row.state !== 'failed')) return;

if (email) {
  if (email.state === 'pending' && Date.parse(email.available_at) > now) {
    await db.notification_deliveries.updateOne({
      where: { id: email.id },
      data: { available_at: new Date(now).toISOString(), reason: 'push_failed_fallback', updated_at: new Date(now).toISOString() }
    });
  }

  return;
}
// existing insert path (recipient without follow-up row) stays, minus the preferences check
```
Manter a regra do dedup window (`DEDUP_WINDOW`) — o e-mail de follow-up entra em 2 h, bem abaixo.

- [ ] **Step 4: Run** `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api test` → PASS.

- [ ] **Step 5: Commit** `feat(api): remind at 09:00 local and e-mail two hours after push`

---

### Task 4: Web — Perfil, remoções, versão

**Files:**
- Create: `packages/web/src/components/profile-screen.tsx`, `packages/web/src/components/profile-screen.test.tsx`, `packages/web/src/app/(protected)/settings/pix/page.tsx`
- Modify: `packages/web/src/app/(protected)/settings/page.tsx`, `packages/web/src/components/app-shell.tsx:33-40` (`href="/settings"`), `packages/web/src/lib/financial-proxy.ts:11-14`, `packages/web/src/components/billing-form.tsx:100-115` (remover fetch de `notification-preferences` e o tipo), `packages/web/src/components/pix-settings-screen.tsx` (eyebrow "Ajustes" → "Perfil"), `packages/web/src/app/globals.css` (novas classes `.profile-*`, remover `.account-*`), `packages/web/src/a11y.test.tsx:83-91` (render `<ProfileScreen />`), `packages/web/next.config.mjs` (`env.NEXT_PUBLIC_APP_VERSION`), `packages/web/src/app/privacy/page.tsx` e `terms/page.tsx` (copy)
- Delete: `packages/web/src/components/account-settings.tsx`, `account-settings.test.tsx`, `notification-settings.tsx`, `notification-settings.test.tsx`

**Interfaces:**
- Consumes: `/api/auth/me` → `{ user: AuthUser }`; `PATCH /api/financial/account/profile`; `POST /api/auth/logout` (204); `DELETE /api/financial/account` body `{ confirmation: 'EXCLUIR' }` → `{ deleted: boolean }`; `ACCOUNT_DELETED`, `ACCOUNT_DELETION_UNCONFIRMED`.

- [ ] **Step 1: Failing test** `profile-screen.test.tsx` (padrão de `feed-screen.test.tsx`: `vi.mock("@/lib/auth/browser-fetch")`, `vi.stubGlobal("fetch")`, `next/navigation` mock com `replace`)

```tsx
it("shows identity and edits the name inline", async () => {
  // me → { user: { name: "Lucas Silveira", email: "lucas@email.com", timezone: "America/Sao_Paulo" ... } }
  render(<ProfileScreen version="1.0.0" />);
  expect(await screen.findByText("Lucas Silveira")).toBeInTheDocument();
  expect(screen.getByText("lucas@email.com")).toBeInTheDocument();
  expect(screen.getByText("L")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Editar nome" }));
  await user.clear(screen.getByRole("textbox", { name: "Nome" }));
  await user.type(screen.getByRole("textbox", { name: "Nome" }), "Lucas S.");
  await user.click(screen.getByRole("button", { name: "Salvar nome" }));
  // PATCH called with { name: "Lucas S.", locale: "pt-BR", country: "BR", timezone: <resolved tz> }
  expect(await screen.findByText("Lucas S.")).toBeInTheDocument();
});

it("links to contacts, pix keys, terms and privacy and shows the version", async () => {
  // links: "Gerenciar contatos" → /people, "Gerenciar chaves Pix" → /settings/pix, "Termos" → /terms, "Privacidade" → /privacy; text "Receivy v1.0.0"
});

it("logs out only after confirmation", async () => {
  // click "Sair da conta" → dialog "Deseja sair da sua conta?"; "Cancelar" → no fetch; "Sair" → POST /api/auth/logout then router.replace("/login")
});

it("deletes the account only with the literal confirmation", async () => {
  // click "Excluir conta" → dialog "Excluir conta?"; button "Confirmar exclusão" disabled; type EXCLUIR → enabled; click → DELETE /api/financial/account then POST logout; shows ACCOUNT_DELETED and link "Voltar ao login"
});

it("keeps a logout retry when the browser session cannot be cleared", async () => {
  // logout returns 500 after delete → notice + button "Tentar encerrar a sessão novamente"
});
```

- [ ] **Step 2: Run** `pnpm --filter @receivy/web test -- profile-screen` → FAIL.

- [ ] **Step 3: Implement `ProfileScreen`**

```tsx
"use client";

import { Check, ChevronRight, KeyRound, LogOut, Mail, Pencil, Trash2, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED, type AuthUser } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";

type Dialog = "logout" | "delete" | null;

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

export function ProfileScreen({ version }: { version: string }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [logoutRetry, setLogoutRetry] = useState<boolean | null>(null); // deleted flag when the logout after delete failed

  useEffect(() => { /* load /api/auth/me → setUser, setDraft(name ?? "") ; error → notice "Não foi possível carregar sua conta." */ }, []);

  async function saveName() { /* trim; empty → return; PATCH profile { name, locale: "pt-BR", country: "BR", timezone: deviceTimezone() }; ok → setUser(json.user), setEditing(false); else notice "Não foi possível salvar o nome." */ }

  async function finishLogout(deleted: boolean | null) {
    // POST /api/auth/logout via fetch; ok → setEnded(true), notice deleted === null ? "" : deleted ? ACCOUNT_DELETED : ACCOUNT_DELETION_UNCONFIRMED; deleted === null → router.replace("/login")
    // fail → deleted === null ? notice "Não foi possível sair. Tente novamente." : setLogoutRetry(deleted) + notice "Conta excluída, mas não foi possível encerrar a sessão neste navegador."
  }

  async function erase() { /* confirmation !== "EXCLUIR" → return; DELETE /api/financial/account { confirmation }; deleted = ok && json.deleted; await finishLogout(deleted) */ }

  const initial = (user?.name?.trim().charAt(0) || "R").toUpperCase();

  // JSX: <div className="profile-page"> header h1 "Perfil"; identity card; section "Gerenciamento" (list rows as <Link>); section "Segurança e Sessão" (buttons); footer; dialogs rendered as <div role="dialog" aria-modal="true" aria-labelledby=...> inside a ".profile-backdrop" when dialog !== null; ended → notice + <Link href="/login">Voltar ao login</Link>
}
```
Linhas de lista: `<Link className="profile-row" href="/people" aria-label="Gerenciar contatos"><span className="profile-row-icon"><Users/></span><span><strong>Meus Contatos</strong><small>Gerenciar pessoas e dados salvos de cobrança</small></span><ChevronRight/></Link>`; idem "Minhas Chaves Pix" → `/settings/pix` com `aria-label="Gerenciar chaves Pix"`. Botões "Sair da conta" / "Excluir conta" (`className="profile-row profile-row-danger"`). Rodapé: `Receivy v{version}`, frase, links `Termos` → `/terms`, `Privacidade` → `/privacy`.

Páginas:
```tsx
// settings/page.tsx
export default function SettingsPage() {
  return (
    <AppShell activePath="/settings">
      <ProfileScreen version={process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"} />
    </AppShell>
  );
}
// settings/pix/page.tsx
export default function PixSettingsPage() {
  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href="/settings">← Perfil</Link>
      <PixSettingsScreen />
    </AppShell>
  );
}
```
`next.config.mjs`: `import { createRequire } from "node:module"; const pkg = createRequire(import.meta.url)("./package.json"); … env: { NEXT_PUBLIC_APP_VERSION: pkg.version },` e subir `packages/web/package.json` `version` para `1.0.0`.

CSS (`globals.css`): `.profile-page` (grid, gap 20px, max-width 560px), `.profile-identity` (card centralizado, avatar 96px círculo `--color-primary-soft` com inicial em `--color-primary-strong`), `.profile-name-row`, `.profile-section-title` (uppercase, 11px, `--color-text-muted`), `.profile-list` (card com `> * + * { border-top }`), `.profile-row` (grid `40px 1fr 20px`, min-height 64px, padding 12px 16px), `.profile-row-danger strong { color: var(--color-danger) }`, `.profile-footer`, `.profile-backdrop` (fixed inset 0, `rgba(19,27,46,.4)`, flex center), `.profile-dialog` (card 360px, gap 12px). Remover `.account-settings`, `.account-session`, `.account-danger`.

Copy legal: em `privacy/page.tsx` trocar "preferências, sessões," por "sessões," e a frase "Você pode exportar um JSON privado, encerrar sessões, remover dispositivos e solicitar exclusão em Ajustes. A autorização da exportação expira em cinco minutos e exige sessão ativa; proteja a cópia que baixar." por "Você pode sair da conta e solicitar exclusão em Perfil."; em `terms/page.tsx` ajustar menções equivalentes se existirem.

Remoções: allowlist `financial-proxy.ts` (sessions, export, notification-preferences, `GET devices`, `DELETE devices/{id}`); `billing-form.tsx` sem fetch de preferências; `HeaderBell` `href="/settings"`; apagar os 4 arquivos; `a11y.test.tsx` renderiza `<ProfileScreen version="1.0.0" />` e espera o botão "Excluir conta" presente.

- [ ] **Step 4: Run** `pnpm --filter @receivy/web test && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web build` → PASS (`openapi-contract.test.ts` prova o allowlist contra o `docs/openapi.json` da Task 2).

- [ ] **Step 5: Commit** `feat(web): profile screen with three tabs and lean account actions`

---

### Task 5: Mobile — TabBar, Perfil, remoções, push automático, Maestro

**Files:**
- Create: `packages/mobile/src/components/tab-bar.tsx`, `packages/mobile/src/components/profile-screen.tsx`, `packages/mobile/src/components/profile-screen.test.tsx`, SVGs `packages/mobile/assets/images/auth/{group,key,logout,trash,edit,check,chevron,warning}.svg` (24×24, `fill="none" stroke="#000" stroke-width="1.8"`, lucide-style; tint via `tintColor`)
- Modify: `packages/mobile/src/components/feed-screen.tsx:41-47,422-443` (usar `<TabBar active="Feed" …/>`), `packages/mobile/src/app/settings.tsx`, `packages/mobile/src/components/session-gate.tsx` (registrar push ao ficar `ready`), `packages/mobile/src/account/client.ts` (remover `sessions`, `revoke`, `export`), `packages/mobile/src/notifications/client.ts` (remover `preferences`, `save`, `devices`, `remove`), `packages/mobile/src/components/billing-form-screen.tsx:125-140` (remover fetch de preferências), `packages/mobile/src/components/legal-text.tsx` (copy), `packages/mobile/src/components/pix-settings-screen.tsx` (mantém "← Perfil"), `packages/mobile/e2e/smoke/04-tabs.yaml`
- Delete: `packages/mobile/src/components/account-settings.tsx`, `account-settings.test.tsx`, `notification-settings.tsx`, `notification-settings.test.tsx`

**Interfaces:**
- Produces: `TabBar({ active, onOpenFeed, onOpenBillings, onOpenSettings })` com `accessibilityRole="button"`, `accessibilityLabel` = label, `accessibilityState={{ selected }}`; `ProfileScreen` props abaixo.

- [ ] **Step 1: Failing tests** `profile-screen.test.tsx`

```tsx
const user = { id: "u1", email: "lucas@email.com", name: "Lucas Silveira", avatarUrl: null, locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL" } as const;

it("shows identity, edits the name inline and remembers it", async () => {
  const save = jest.fn().mockResolvedValue({ ...user, name: "Lucas S." });
  const remember = jest.fn();
  await render(<ProfileScreen client={{ profile: jest.fn().mockResolvedValue(user), save, logout: jest.fn(), erase: jest.fn() }} store={{ remember }} version="1.0.0" />);
  expect(await screen.findByText("Lucas Silveira")).toBeOnTheScreen();
  expect(screen.getByText("L")).toBeOnTheScreen();
  expect(screen.getByText("lucas@email.com")).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("Editar nome"));
  await fireEvent.changeText(screen.getByLabelText("Nome"), "Lucas S.");
  await fireEvent.press(screen.getByLabelText("Salvar nome"));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "Lucas S.", locale: "pt-BR", country: "BR" })));
  expect(remember).toHaveBeenCalled();
  expect(await screen.findByText("Lucas S.")).toBeOnTheScreen();
  expect(screen.getByText("Receivy v1.0.0")).toBeOnTheScreen();
});

it("navigates to contacts, pix keys and tabs", async () => {
  // press "Gerenciar contatos" → onOpenPeople; "Gerenciar chaves Pix" → onOpenPix; tab "Feed" → onOpenFeed; tab "Cobranças" → onOpenBillings; tab "Perfil" selected
});

it("logs out only after confirming", async () => {
  // press "Sair da conta" → text "Deseja sair da sua conta?"; press "Cancelar" → logout not called; press "Sair da conta" then "Sair" → logout called, onLoggedOut called
});

it("deletes the account only with the literal confirmation", async () => {
  // press "Excluir conta" → "Excluir conta?" visible; "Confirmar exclusão" disabled; changeText "Digite EXCLUIR para confirmar" → "EXCLUIR"; press → erase called; ACCOUNT_DELETED shown; onLoggedOut called
});
```

- [ ] **Step 2: Run** `pnpm --filter @receivy/mobile test -- profile-screen` → FAIL.

- [ ] **Step 3: Implement**

`tab-bar.tsx` — mover `TAB_ICONS`, `ACTIVE_TINT`, `MUTED_TINT` e o JSX de `feed-screen.tsx:422-443`:
```tsx
type Tab = "Feed" | "Cobranças" | "Perfil";
type TabBarProps = { active: Tab; onOpenFeed?: () => void; onOpenBillings?: () => void; onOpenSettings?: () => void };
export function TabBar({ active, onOpenFeed, onOpenBillings, onOpenSettings }: TabBarProps) { /* same markup; selected = label === active; onPress undefined for the active tab */ }
```
`feed-screen.tsx` usa `<TabBar active="Feed" onOpenBillings={onOpenBillings} onOpenSettings={onOpenSettings} />` (a sino segue igual).

`profile-screen.tsx`:
```tsx
type ProfileScreenProps = {
  client?: Pick<AccountClient, "profile" | "save" | "logout" | "erase">;
  store?: Pick<ProfileStore, "remember">;
  version?: string;
  onOpenPeople?: () => void;
  onOpenPix?: () => void;
  onOpenFeed?: () => void;
  onOpenBillings?: () => void;
  onOpenNotifications?: () => void;
  onLoggedOut?: () => void;
};
```
Defaults: `client = accountClient`, `store = profileStore`, `version = Constants.expoConfig?.version ?? "1.0.0"`. Estrutura: `SafeAreaView` → cabeçalho (espaço 40px, `Text accessibilityRole="header"` "Perfil", sino `accessibilityLabel="Notificações"` → `onOpenNotifications`) → `ScrollView` com card identidade (círculo `h-24 w-24 rounded-full bg-primary-soft` com inicial `text-primary-strong`; nome + `Pressable accessibilityLabel="Editar nome"` com `edit.svg`; em edição `TextInput accessibilityLabel="Nome"` + `Pressable accessibilityLabel="Salvar nome"` com `check.svg`; e-mail com `mail.svg`), seção "GERENCIAMENTO" (`Row` com ícone, título, subtítulo, chevron; `accessibilityLabel` "Gerenciar contatos"/"Gerenciar chaves Pix"), seção "SEGURANÇA E SESSÃO" ("Sair da conta"/"Excluir conta"), rodapé (`Receivy v{version}`, frase, links "Termos"/"Privacidade" → `LegalSheet`), `<TabBar active="Perfil" onOpenFeed onOpenBillings />`. Modais RN (`Modal transparent animationType="fade"`): logout ("Deseja sair da sua conta?" botões "Sair"/"Cancelar") e exclusão ("Excluir conta?", texto da spec, `TextInput accessibilityLabel="Digite EXCLUIR para confirmar" autoCapitalize="characters"`, botão "Confirmar exclusão" `disabled={confirmation !== "EXCLUIR" || busy}`, "Cancelar"). Fluxos: `saveName` (trim vazio → return; `client.save({ name, locale: "pt-BR", country: "BR", timezone: deviceTimezone() })`; `store.remember(saved)`; erro → "Não foi possível salvar o nome."); `logout` (`client.logout()` → `onLoggedOut`; erro → "Não foi possível sair. Tente novamente."); `erase` (como o `AccountSettings` atual: `confirmed = await client.erase()` em try/catch, notice `ACCOUNT_DELETED`/`ACCOUNT_DELETION_UNCONFIRMED`, depois `onLoggedOut`). `deviceTimezone()` igual ao web, via `Intl`.

`app/settings.tsx`:
```tsx
export default function SettingsRoute() {
  const router = useRouter();
  const [section, setSection] = useState<"profile" | "pix">("profile");

  if (section === "pix") {
    return <PixSettingsScreen onBack={() => setSection("profile")} />;
  }

  return (
    <ProfileScreen
      onOpenPeople={() => router.push("/people")}
      onOpenPix={() => setSection("pix")}
      onOpenFeed={() => router.replace("/")}
      onOpenBillings={() => router.push("/billings")}
      onOpenNotifications={() => {}}
      onLoggedOut={() => router.replace("/login")}
    />
  );
}
```
Sino no Perfil: sem ação além de manter o layout (`onOpenNotifications` opcional; no Perfil não faz nada).

`session-gate.tsx`: ao entrar em `ready`, `void registerPushDevice(notificationClient.register).catch(() => {})` uma vez (guardar em `useRef` para não repetir); `session-gate.test.tsx` mocka `@/notifications/register`.

Clients: `account/client.ts` fica `{ profile, save, erase, logout }`; `notifications/client.ts` fica `{ register, remind, deliveries }`; `billing-form-screen.tsx` deixa de chamar `preferences()`. `legal-text.tsx`: trocar "Em Ajustes você pode exportar dados em JSON, encerrar sessões e excluir sua conta" por "Em Perfil você pode sair da conta e excluir sua conta" e "preferências, sessões," por "sessões,".

`04-tabs.yaml`:
```yaml
appId: dev.receivy.local
---
- tapOn: "Perfil"
- extendedWaitUntil:
    visible: "Meus Contatos"
    timeout: 15000
- assertVisible: "Sair da conta"
- scrollUntilVisible:
    element:
      text: "Excluir conta"
    direction: DOWN
- scrollUntilVisible:
    element:
      text: "Minhas Chaves Pix"
    direction: UP
- tapOn: "Gerenciar chaves Pix"
- extendedWaitUntil:
    visible: "Suas chaves Pix"
    timeout: 15000
- assertVisible: ${EMAIL}
- tapOn: "← Perfil"
- extendedWaitUntil:
    visible: "Meus Contatos"
    timeout: 15000
- tapOn: "Cobranças"
- extendedWaitUntil:
    visible: "Nova cobrança"
    timeout: 15000
- tapOn: "Feed"
- extendedWaitUntil:
    visible: "A RECEBER"
    timeout: 15000
```
`03-contact-charge.yaml`: onde havia "← Perfil" → "← Feed" após salvar contato, agora após "← Perfil" tocar a aba "Feed" (verificar o trecho e ajustar só o passo de volta ao feed).

- [ ] **Step 4: Run** `pnpm --filter @receivy/mobile test && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile check-types` → PASS (se `check-types` reclamar de rotas tipadas, iniciar o Metro uma vez para regenerar `.expo/types/router.d.ts`).

- [ ] **Step 5: Commit** `feat(mobile): profile screen with shared tab bar and automatic push registration`

---

## Self-review

- Spec §3 (Perfil) → Tasks 4, 5. §4 (remoções) → Tasks 1, 2, 4, 5. §5 (política) → Tasks 1, 3. §6 (dados) → Task 2. §7 (testes) → todas. Push automático (§4 mobile) → Task 5.
- Assinaturas: `effectiveReminders(row)` síncrona (Task 2) usada em `outbox.ts` (Task 3); `zonedInstant`/`civilHour` (Task 1) usados na Task 3; `ProfileScreen` web recebe `version`, mobile recebe callbacks + `version` opcional; `TabBar.active` é `"Feed" | "Cobranças" | "Perfil"`.
- Sem placeholders: os trechos com comentário `/* … */` descrevem o corpo exato a escrever com os textos da spec; textos de UI são os da spec §3.
