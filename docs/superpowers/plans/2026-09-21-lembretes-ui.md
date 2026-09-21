# Lembretes configuráveis — UI Implementation Plan (web + mobile)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editor de lembretes no perfil (até 5 regras, ±14 dias, chips E-mail/WhatsApp, bloco do manual), bloco "Lembretes" na conta que herda ou personaliza, telefone e consentimento no contato, modal do "Lembrar" que mostra os canais e motivos vindos do preview, e a página pública de opt-out de e-mail. Web e mobile.

**Architecture:** Um editor compartilhado por estado (`ReminderConfig` do `@receivy/common`) e duas implementações visuais, uma por plataforma, em `components/app/reminder-editor`. O perfil lê `GET /account/reminders` e grava com `PUT`/`DELETE`. O form da conta guarda `reminders: null` (herda) ou um array (próprio) e mostra a config efetiva (`BillingDetail.effectiveReminders`) quando herda. O modal do manual chama `GET /charges/{id}/reminders/preview` ao abrir e envia com `POST`; a resposta traz `channels` e `dropped`. A página `/opt-out/[token]` é um server component que chama a API pública e oferece "Voltar a receber".

**Tech Stack:** Next 16 app router + Tailwind + vitest/Testing Library; Expo Router + Uniwind + jest/RNTL; `@receivy/common`.

**Spec:** `docs/superpowers/specs/2026-09-21-lembretes-configuraveis-design.md` (§5, §6). API entregue pelo plano `2026-09-21-lembretes-api.md`: `GET/PUT/DELETE account/reminders` → `ReminderSettings { config, inherited, whatsappAvailable }`; `GET charges/{id}/reminders/preview` e `POST charges/{id}/reminders` → `ManualReminderResult { channels, dropped }` (o POST não devolve mais `queued`); `PATCH billings/{id}` aceita `reminders` (com `channels`) e `clearReminders: true`; `BillingDetail.reminders: ReminderRule[] | null` e `effectiveReminders`; `PATCH/POST contacts` aceitam `phone` e `whatsappConsent`; `Contact.phone` (efetivo), `phoneSource`, `whatsappConsentAt`; `POST/DELETE public/notices/opt-out/{token}`.

## Global Constraints

- Copy (verbatim). Perfil: título "Lembretes"; subtítulo da linha no perfil "Quando e por onde avisar quem te deve"; disclaimer "Notificação no app vai sempre que a pessoa permitir no celular dela."; bloco "Lembrete manual" com a frase "É o que sai quando você toca em Lembrar"; botões "Adicionar lembrete", "Voltar ao padrão", "Salvar"; chips "E-mail" e "WhatsApp"; rótulos de dias `reminderOffsetLabel(offsetDays)`: "no dia", "1 dia antes", "N dias antes", "1 dia depois", "N dias depois"; chip WhatsApp bloqueado: "Plano Básico" (Grátis) ou "Em breve" (`whatsappAvailable === false`); erro de teto: `REMINDERS_INVALID_MESSAGE` do common. Conta: bloco "Lembretes" com "Usando seu padrão: {resumo}" e botões "Personalizar" / "Voltar ao padrão"; resumo = regras habilitadas como "no dia (e-mail), 2 dias depois (WhatsApp)". Contato: campo "WhatsApp", nota "Número informado pela própria pessoa" quando `phoneSource === 'person'`, checkbox "Essa pessoa concordou em receber cobranças por WhatsApp". Modal Lembrar: "Vai por: {canais}" com nomes "notificação no app", "e-mail", "WhatsApp"; linha por queda "{Canal}: {motivo}" com motivos `dropReasonText`: `no_email` "sem e-mail", `no_phone` "sem número no contato", `no_consent` "sem consentimento no contato", `opted_out` "a pessoa pediu para não receber", `unavailable` "em breve"; sem canal: "Ninguém alcançável. Compartilhe o link direto." e botão desabilitado. Opt-out: título "Avisos por e-mail", texto "Você não recebe mais e-mails de cobrança. Quem te cobra ainda pode te mandar o link direto.", botão "Voltar a receber", estado revertido "Você voltou a receber e-mails de cobrança.".
- Helpers de copy compartilhados vivem em `@receivy/common` (`domain/reminders-copy.ts`): `reminderOffsetLabel`, `channelLabel`, `dropReasonText`, `reminderSummary(rules)`. Nunca literal duplicado nas duas plataformas.
- Const enum pelos membros (`PlanTier.Free`, `NoticeChannel.Email` do common). Sem dependência nova.
- Web: `browserFetch` para o BFF, `responseMessage` como fallback, erro inline `role="alert"`; eslint `curly` + `padding-line-between-statements`; Tailwind só em componentes; controles nativos (`<input type="checkbox" role="switch">`, botões `role="radio"`), sem lib de UI.
- Mobile: clientes injetados por props nos testes (`client`), `await render`, `await fireEvent`; erros inline em `<Text accessibilityRole="alert">`; `Switch` do RN; sem `Alert.alert` informativo (o confirm do manual vira sheet).
- Contrato OpenAPI (`packages/web/src/lib/openapi-contract.test.ts`): allowlist ganha `GET|PUT|DELETE account/reminders` e `GET charges/{p}/reminders/preview`; `DEDICATED_BFF` ganha `POST public/notices/opt-out/{p}` e `DELETE public/notices/opt-out/{p}`; o scanner nativo cobre os novos caminhos.
- Verificação por task: web `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`; mobile `pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test`; common `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`.
- Nunca `git stash/checkout/restore`; re-ler antes de editar; diffs mínimos; nada de `biome --write`; nunca commitar.

---

### Task 1: Common — copy e tipos compartilhados dos lembretes

**Files:**
- Create: `packages/common/src/domain/reminders-copy.ts`, `packages/common/src/domain/reminders-copy.test.ts`
- Modify: `packages/common/src/domain/notifications.ts` (declarar `NoticeChannel`, `DropReason`, `ManualReminderResult` se o plano da API ainda não os colocou aí), `packages/common/src/index.ts`

**Interfaces:**
- Produces: `NoticeChannel { Push = 'push', Email = 'email', WhatsApp = 'whatsapp' }`, `DropReason { NoEmail = 'no_email', NoPhone = 'no_phone', NoConsent = 'no_consent', OptedOut = 'opted_out', Unavailable = 'unavailable' }`, `ManualReminderResult = { channels: NoticeChannel[]; dropped: { channel: NoticeChannel; reason: DropReason }[] }`, `ReminderSettings` (já do plano da API), `reminderOffsetLabel(offsetDays: number): string`, `channelLabel(channel: NoticeChannel): string`, `dropReasonText(reason: DropReason): string`, `reminderSummary(rules: ReminderRule[]): string`, `whatsappLockLabel(gate: { available: boolean; planAllows: boolean }): string | null`, `remindLines(preview: ManualReminderResult): { going: string; dropped: string[] }`, `NOBODY_REACHABLE`, `PUSH_DISCLAIMER`. Web e mobile importam tudo daqui; nenhuma plataforma redeclara.

- [ ] **Step 1: Testes**

```ts
// packages/common/src/domain/reminders-copy.test.ts
import { describe, expect, it } from 'vitest';
import { DropReason, NoticeChannel } from './notifications';
import { channelLabel, dropReasonText, NOBODY_REACHABLE, remindLines, reminderOffsetLabel, reminderSummary, whatsappLockLabel } from './reminders-copy';

describe('reminder copy', () => {
  it('labels offsets in Portuguese', () => {
    expect(reminderOffsetLabel(0)).toBe('no dia');
    expect(reminderOffsetLabel(-1)).toBe('1 dia antes');
    expect(reminderOffsetLabel(-3)).toBe('3 dias antes');
    expect(reminderOffsetLabel(1)).toBe('1 dia depois');
    expect(reminderOffsetLabel(14)).toBe('14 dias depois');
  });

  it('names channels and drop reasons', () => {
    expect(channelLabel(NoticeChannel.Push)).toBe('notificação no app');
    expect(channelLabel(NoticeChannel.Email)).toBe('e-mail');
    expect(channelLabel(NoticeChannel.WhatsApp)).toBe('WhatsApp');
    expect(dropReasonText(DropReason.NoPhone)).toBe('sem número no contato');
    expect(dropReasonText(DropReason.Unavailable)).toBe('em breve');
  });

  it('locks WhatsApp by plan first, then by availability', () => {
    expect(whatsappLockLabel({ available: false, planAllows: false })).toBe('Plano Básico');
    expect(whatsappLockLabel({ available: false, planAllows: true })).toBe('Em breve');
    expect(whatsappLockLabel({ available: true, planAllows: true })).toBeNull();
  });

  it('builds the manual reminder lines from a preview', () => {
    expect(remindLines({ channels: [NoticeChannel.Push, NoticeChannel.Push, NoticeChannel.Email], dropped: [{ channel: NoticeChannel.WhatsApp, reason: DropReason.NoPhone }] })).toEqual({
      going: 'notificação no app, e-mail',
      dropped: ['WhatsApp: sem número no contato']
    });
    expect(NOBODY_REACHABLE).toBe('Ninguém alcançável. Compartilhe o link direto.');
  });

  it('summarises enabled rules with their channels, skipping disabled ones', () => {
    const rules = [
      { offsetDays: -3, enabled: false, channels: { email: true, whatsapp: true } },
      { offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } },
      { offsetDays: 2, enabled: true, channels: { email: true, whatsapp: true } }
    ];

    expect(reminderSummary(rules)).toBe('no dia (e-mail), 2 dias depois (e-mail e WhatsApp)');
    expect(reminderSummary([{ offsetDays: 0, enabled: true, channels: { email: false, whatsapp: false } }])).toBe('no dia (só notificação no app)');
    expect(reminderSummary([])).toBe('nenhum lembrete');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/common test -- reminders-copy`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// packages/common/src/domain/reminders-copy.ts
import { DropReason, NoticeChannel } from './notifications';
import type { ReminderRule } from './reminders';

export function reminderOffsetLabel(offsetDays: number): string {
  if (offsetDays === 0) {
    return 'no dia';
  }

  const days = Math.abs(offsetDays);
  const unit = days === 1 ? 'dia' : 'dias';

  return `${days} ${unit} ${offsetDays < 0 ? 'antes' : 'depois'}`;
}

const CHANNEL_LABELS: Record<NoticeChannel, string> = {
  [NoticeChannel.Push]: 'notificação no app',
  [NoticeChannel.Email]: 'e-mail',
  [NoticeChannel.WhatsApp]: 'WhatsApp'
};

export function channelLabel(channel: NoticeChannel): string {
  return CHANNEL_LABELS[channel];
}

const DROP_TEXTS: Record<DropReason, string> = {
  [DropReason.NoEmail]: 'sem e-mail',
  [DropReason.NoPhone]: 'sem número no contato',
  [DropReason.NoConsent]: 'sem consentimento no contato',
  [DropReason.OptedOut]: 'a pessoa pediu para não receber',
  [DropReason.Unavailable]: 'em breve'
};

export function dropReasonText(reason: DropReason): string {
  return DROP_TEXTS[reason];
}

function ruleChannels(rule: ReminderRule): string {
  const names = [...(rule.channels.email ? ['e-mail'] : []), ...(rule.channels.whatsapp ? ['WhatsApp'] : [])];

  if (!names.length) {
    return 'só notificação no app';
  }

  return names.join(' e ');
}

/** One line for cards and the inherited block: "no dia (e-mail), 2 dias depois (e-mail e WhatsApp)". */
export function reminderSummary(rules: ReminderRule[]): string {
  const enabled = rules.filter((rule) => rule.enabled);

  if (!enabled.length) {
    return 'nenhum lembrete';
  }

  return enabled.map((rule) => `${reminderOffsetLabel(rule.offsetDays)} (${ruleChannels(rule)})`).join(', ');
}

export const PUSH_DISCLAIMER = 'Notificação no app vai sempre que a pessoa permitir no celular dela.';

export const NOBODY_REACHABLE = 'Ninguém alcançável. Compartilhe o link direto.';

/** The plan lock wins over the transport lock: a free user sees the upsell, a paid one sees "Em breve". */
export function whatsappLockLabel(gate: { available: boolean; planAllows: boolean }): string | null {
  if (!gate.planAllows) {
    return 'Plano Básico';
  }

  if (!gate.available) {
    return 'Em breve';
  }

  return null;
}

/** What the manual-reminder confirm shows: the channels going out (push once, however many devices) and one line per drop. */
export function remindLines(preview: ManualReminderResult): { going: string; dropped: string[] } {
  const going = [...new Set(preview.channels)].map(channelLabel).join(', ');
  const dropped = preview.dropped.map((drop) => `${channelLabel(drop.channel).replace(/^./, (c) => c.toUpperCase())}: ${dropReasonText(drop.reason)}`);

  return { going, dropped };
}
```
(`ManualReminderResult` importado de `./notifications`.)
`notifications.ts`: se o plano da API não declarou, acrescentar os dois const enums e `ManualReminderResult` conforme as Interfaces. Exportar `reminders-copy` no `index.ts`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
Expected: PASS.

---

### Task 2: Web — editor de lembretes e página Perfil > Lembretes

**Files:**
- Create: `packages/web/src/components/app/reminder-editor.tsx`, `packages/web/src/components/screens/reminders-screen.tsx`, `packages/web/src/components/screens/reminders-screen.test.tsx`, `packages/web/src/app/(protected)/settings/reminders/page.tsx`
- Modify: `packages/web/src/components/screens/profile-screen.tsx:437-441` (nova `Row`), `packages/web/src/lib/financial-proxy.ts:11-28`, `packages/web/src/lib/openapi-contract.test.ts`

**Interfaces:**
- Produces: `ReminderEditor` props `{ rules: ReminderDraft[]; onChange(rules: ReminderDraft[]): void; whatsapp: { available: boolean; planAllows: boolean }; disabled?: boolean }` onde `ReminderDraft` é o do common (offset como string); `RemindersScreen` sem props (lê `/api/financial/account/reminders`); rota `/settings/reminders`.
- Consumes: Task 1; `ReminderSettings`, `REMINDER_MAX_RULES`, `REMINDER_MAX_OFFSET`, `REMINDERS_INVALID_MESSAGE`, `validateReminderConfig` do common; `PlanTier`, `planName`, `GET /api/financial/plan` (já existe) para saber se o plano permite WhatsApp (`PLAN_LIMITS[plan].whatsapp > 0`; enquanto o plano da fase 2 não existir, `planAllows = plan === PlanTier.Basic`).

- [ ] **Step 1: Testes**

```tsx
// packages/web/src/components/screens/reminders-screen.test.tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SYSTEM_REMINDER_CONFIG } from "@receivy/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { RemindersScreen } from "./reminders-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const fetchMock = vi.mocked(browserFetch);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function arrange(settings = { config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }, plan = "free") {
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith("/account/reminders") && (!init?.method || init.method === "GET")) { return json(settings); }
    if (path.endsWith("/plan")) { return json({ plan, usage: { indefinite: { used: 0, limit: 5 } } }); }
    if (path.endsWith("/account/reminders") && init?.method === "PUT") { return json({ ...settings, config: JSON.parse(String(init.body)), inherited: false }); }
    if (path.endsWith("/account/reminders") && init?.method === "DELETE") { return json({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }); }
    return json({}, 404);
  });
}

describe("RemindersScreen", () => {
  it("shows the default rule, the disclaimer and a locked WhatsApp chip on the free plan", async () => {
    arrange();
    render(<RemindersScreen />);

    expect(await screen.findByText("no dia")).toBeTruthy();
    expect(screen.getByText("Notificação no app vai sempre que a pessoa permitir no celular dela.")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: /WhatsApp/ })[0]).toHaveProperty("disabled", true);
    expect(screen.getAllByText("Plano Básico").length).toBeGreaterThan(0);
  });

  it("adds up to five rules and refuses the sixth", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    const add = await screen.findByRole("button", { name: "Adicionar lembrete" });

    for (let i = 0; i < 4; i++) { await userEvent.click(add); }

    expect(screen.queryByRole("button", { name: "Adicionar lembrete" })).toBeNull();
    expect(screen.getAllByRole("spinbutton", { name: /Dias/ })).toHaveLength(5);
  });

  it("saves the config with channels and clears it back to the default", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "WhatsApp no lembrete no dia" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");

      expect(put).toBeTruthy();
      expect(JSON.parse(String(put![1]!.body)).reminders[0].channels).toEqual({ email: true, whatsapp: true });
    });

    await userEvent.click(screen.getByRole("button", { name: "Voltar ao padrão" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
  });

  it("refuses an offset beyond 14 days inline", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    const days = await screen.findByRole("spinbutton", { name: "Dias do lembrete 1" });

    await userEvent.clear(days);
    await userEvent.type(days, "20");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Lembretes inválidos");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- reminders-screen`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `ReminderEditor`**

```tsx
// packages/web/src/components/app/reminder-editor.tsx
"use client";

import { PUSH_DISCLAIMER, REMINDER_MAX_OFFSET, REMINDER_MAX_RULES, type ReminderDraft, reminderOffsetLabel, whatsappLockLabel } from "@receivy/common";
import { Trash2 } from "lucide-react";

type WhatsappGate = { available: boolean; planAllows: boolean };

type ReminderEditorProps = {
  rules: ReminderDraft[];
  onChange: (rules: ReminderDraft[]) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
};

const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold";
const CHIP_ON = `${CHIP} border-primary bg-primary-soft text-primary-strong`;
const CHIP_OFF = `${CHIP} border-outline text-muted`;

function ChannelChip({ label, checked, locked, disabled, name, onChange }: { label: string; checked: boolean; locked: string | null; disabled?: boolean; name: string; onChange: (value: boolean) => void }) {
  const off = disabled || locked !== null;

  return (
    <label className={`${checked && !locked ? CHIP_ON : CHIP_OFF} ${off ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" className="sr-only" aria-label={name} checked={checked && !locked} disabled={off} onChange={event => onChange(event.target.checked)} />
      {label}
      {locked && <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted">{locked}</span>}
    </label>
  );
}

export function ReminderEditor({ rules, onChange, whatsapp, disabled }: ReminderEditorProps) {
  const lock = whatsappLockLabel(whatsapp);

  function patch(index: number, next: Partial<ReminderDraft>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  }

  function add() {
    if (rules.length >= REMINDER_MAX_RULES) {
      return;
    }

    onChange([...rules, { offsetDays: "", enabled: true, channels: { email: true, whatsapp: false } }]);
  }

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule, index) => {
        const offset = Number(rule.offsetDays);
        const human = rule.offsetDays === "" || Number.isNaN(offset) ? "" : reminderOffsetLabel(offset);

        return (
          <div key={index} className="flex flex-col gap-2.5 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                min={-REMINDER_MAX_OFFSET}
                max={REMINDER_MAX_OFFSET}
                aria-label={`Dias do lembrete ${index + 1}`}
                className="h-9 w-20 rounded-lg border border-outline bg-canvas px-2 text-sm text-ink"
                value={rule.offsetDays}
                disabled={disabled}
                onChange={event => patch(index, { offsetDays: event.target.value })}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{human}</span>
              <input type="checkbox" role="switch" aria-label={`Lembrete ${index + 1} ativo`} className="h-5 w-5 accent-primary" checked={rule.enabled} disabled={disabled} onChange={event => patch(index, { enabled: event.target.checked })} />
              <button type="button" aria-label={`Remover lembrete ${index + 1}`} className="text-muted" disabled={disabled || rules.length === 1} onClick={() => onChange(rules.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <ChannelChip label="E-mail" name={`E-mail no lembrete ${human || index + 1}`} checked={rule.channels.email} locked={null} disabled={disabled} onChange={value => patch(index, { channels: { ...rule.channels, email: value } })} />
              <ChannelChip label="WhatsApp" name={`WhatsApp no lembrete ${human || index + 1}`} checked={rule.channels.whatsapp} locked={lock} disabled={disabled} onChange={value => patch(index, { channels: { ...rule.channels, whatsapp: value } })} />
            </div>
          </div>
        );
      })}

      {rules.length < REMINDER_MAX_RULES && (
        <button type="button" className="self-start text-sm font-semibold text-primary" disabled={disabled} onClick={add}>
          Adicionar lembrete
        </button>
      )}

      <p className="m-0 text-[11px] text-muted">{PUSH_DISCLAIMER}</p>
    </div>
  );
}

export function ManualChannels({ value, onChange, whatsapp, disabled }: { value: { email: boolean; whatsapp: boolean }; onChange: (value: { email: boolean; whatsapp: boolean }) => void; whatsapp: WhatsappGate; disabled?: boolean }) {
  const lock = whatsappLockLabel(whatsapp);

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[11px] text-muted">É o que sai quando você toca em Lembrar</p>
      <div className="flex flex-wrap gap-2">
        <ChannelChip label="E-mail" name="E-mail no lembrete manual" checked={value.email} locked={null} disabled={disabled} onChange={email => onChange({ ...value, email })} />
        <ChannelChip label="WhatsApp" name="WhatsApp no lembrete manual" checked={value.whatsapp} locked={lock} disabled={disabled} onChange={whatsapp => onChange({ ...value, whatsapp })} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implementar `RemindersScreen` e a rota**

`reminders-screen.tsx`: carrega em paralelo `/api/financial/account/reminders` e `/api/financial/plan` (mesmo `request<T>` do `plan-screen.tsx:36-45`); estado `rules: ReminderDraft[]` (offset → `String`), `manual`, `inherited`, `whatsappAvailable`, `plan`; `whatsapp = { available: whatsappAvailable, planAllows: plan === PlanTier.Basic }`. "Salvar": converte com `Number(offsetDays)`, roda `validateReminderConfig` num `try/catch` (erro → `setError(message)` em `<p role="alert">`), `PUT` com o JSON, atualiza estado. "Voltar ao padrão": `DELETE`, recarrega o estado da resposta. Layout: título "Lembretes", seção "Lembretes automáticos" com `ReminderEditor`, seção "Lembrete manual" com `ManualChannels`, rodapé com os dois botões (Salvar primário, Voltar ao padrão secundário, este oculto quando `inherited`). Rota `app/(protected)/settings/reminders/page.tsx` igual a `settings/plan/page.tsx` com `title="Lembretes"` e `back="/settings"`.

Perfil (`profile-screen.tsx` após a `Row` de "Meios de pagamento"):
```tsx
<div className="mx-4 h-px bg-outline/60 md:mx-0" />
<Row icon={Bell} tone="primary" label="Configurar lembretes" title="Lembretes" subtitle="Quando e por onde avisar quem te deve" href="/settings/reminders" />
```
(`Bell` de `lucide-react`.)

`financial-proxy.ts`: `["GET", /^account\/reminders$/], ["PUT", /^account\/reminders$/], ["DELETE", /^account\/reminders$/]`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test -- reminders-screen openapi-contract`
Expected: PASS (o contrato ainda acusa `preview` e `opt-out`: entram nas Tasks 4 e 6).

---

### Task 3: Web — bloco "Lembretes" no form da conta

**Files:**
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx:195-233,506-540` e o JSX perto do bloco de "Não notificar" (~1083-1106), `packages/web/src/components/forms/billing-form-screen.test.tsx`

**Interfaces:**
- Consumes: `ReminderEditor` (Task 2); `BillingDetail.reminders | null`, `effectiveReminders`; `BillingPatch.clearReminders`; `reminderSummary`.
- Produces: `draftFromBilling` mapeia `reminders: billing.reminders ? billing.reminders.map(...) : null`; `patchBody` envia `reminders` quando array, `clearReminders: true` quando o draft é `null` e a conta tinha regras próprias.

- [ ] **Step 1: Testes** (no test do form, com o mesmo `arrange` de fetch usado pelos testes existentes)

```tsx
it("shows the inherited default and only sends reminders after customising", async () => {
  arrangeBilling({ reminders: null, effectiveReminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }] });
  render(<BillingFormScreen billingId={ID} />);

  expect(await screen.findByText("Usando seu padrão: no dia (e-mail)")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

  const patch = lastPatchBody();

  expect(patch.reminders).toBeUndefined();
  expect(patch.clearReminders).toBeUndefined();
});

it("customises, sends the rules, and clears back to the default", async () => {
  arrangeBilling({ reminders: [{ offsetDays: 3, enabled: true, channels: { email: true, whatsapp: false } }], effectiveReminders: [{ offsetDays: 3, enabled: true, channels: { email: true, whatsapp: false } }] });
  render(<BillingFormScreen billingId={ID} />);

  expect(await screen.findByRole("spinbutton", { name: "Dias do lembrete 1" })).toHaveProperty("value", "3");
  await userEvent.click(screen.getByRole("button", { name: "Voltar ao padrão" }));
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

  expect(lastPatchBody().clearReminders).toBe(true);
});
```
(`arrangeBilling` e `lastPatchBody` = helpers já existentes ou a criar no arquivo de teste, seguindo o padrão de mock de `browserFetch` do arquivo.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- billing-form-screen`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`draftFromBilling`: `reminders: billing.reminders ? billing.reminders.map(reminder => ({ ...reminder, offsetDays: String(reminder.offsetDays) })) : null`. Guardar `effective = billing.effectiveReminders` em estado para o resumo. `patchBody` (bloco `editable`):
```tsx
      ...(input.reminders ? { reminders: input.reminders } : billing?.reminders ? { clearReminders: true } : {}),
```
(`buildBillingInput` já omite `reminders` quando o draft é `null`.) JSX, novo bloco antes do de "Não notificar":
```tsx
<section className="flex flex-col gap-2">
  <h3 className="m-0 text-xs font-semibold tracking-[0.06em] text-muted">LEMBRETES</h3>
  {draft.reminders === null ? (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
      <span className="text-sm text-ink">Usando seu padrão: {reminderSummary(effective)}</span>
      <button type="button" className="text-sm font-semibold text-primary" disabled={locked} onClick={() => update({ reminders: effective.map(rule => ({ ...rule, offsetDays: String(rule.offsetDays) })) })}>Personalizar</button>
    </div>
  ) : (
    <>
      <ReminderEditor rules={draft.reminders} onChange={reminders => update({ reminders })} whatsapp={whatsappGate} disabled={locked} />
      <button type="button" className="self-start text-sm font-semibold text-muted" disabled={locked} onClick={() => update({ reminders: null })}>Voltar ao padrão</button>
    </>
  )}
</section>
```
`whatsappGate`: o form já carrega o plano para as travas de InfinitePay/PagBank (`PlanPaywall`); reaproveitar o mesmo estado: `{ available: false, planAllows: plan === PlanTier.Basic }` (`available` vem de `GET /account/reminders` só na tela do perfil; no form fica `false` nesta fase, com o chip "Em breve"). Para conta nova, `effective` = `SYSTEM_REMINDER_CONFIG.reminders` até o usuário ter padrão; buscar `GET /api/financial/account/reminders` no mount do form para o resumo correto (uma chamada, `config.reminders`).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test -- billing-form-screen`
Expected: PASS.

---

### Task 4: Web — modal Lembrar com preview, contato com telefone e consentimento

**Files:**
- Modify: `packages/web/src/components/screens/charge-detail-screen.tsx:290-305,634-645`, `packages/web/src/components/screens/charge-detail-screen.test.tsx`, `packages/web/src/components/forms/contact-form-screen.tsx` (campos + submit), `packages/web/src/components/forms/contact-form-screen.test.tsx`, `packages/web/src/lib/financial-proxy.ts`, `packages/web/src/lib/openapi-contract.test.ts`
- Create: `packages/web/src/components/app/remind-dialog.tsx`

**Interfaces:**
- Produces: `RemindDialog` props `{ recipientName: string; preview: ManualReminderResult | null; loading: boolean; busy: boolean; onConfirm(): void; onCancel(): void }` (composto sobre `ConfirmDialog` ou irmão dele em `components/app`).

- [ ] **Step 1: Testes**

```tsx
// charge-detail-screen.test.tsx — acrescentar
it("previews the reminder channels before sending and reports what went out", async () => {
  arrange(charge(), {
    "GET reminders/preview": { channels: ["push", "email"], dropped: [{ channel: "whatsapp", reason: "no_phone" }] },
    "POST reminders": { channels: ["push", "email"], dropped: [{ channel: "whatsapp", reason: "no_phone" }] },
  });
  render(<ChargeDetailScreen chargeId={ID} />);

  await userEvent.click(await screen.findByRole("button", { name: "Lembrar" }));

  expect(await screen.findByText("Vai por: notificação no app, e-mail")).toBeTruthy();
  expect(screen.getByText("WhatsApp: sem número no contato")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Enviar lembrete" }));

  expect(await screen.findByText(/Lembrete enviado/)).toBeTruthy();
});

it("disables sending when nobody is reachable", async () => {
  arrange(charge(), { "GET reminders/preview": { channels: [], dropped: [{ channel: "email", reason: "no_email" }] } });
  render(<ChargeDetailScreen chargeId={ID} />);

  await userEvent.click(await screen.findByRole("button", { name: "Lembrar" }));

  expect(await screen.findByText("Ninguém alcançável. Compartilhe o link direto.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Enviar lembrete" })).toHaveProperty("disabled", true);
});
```
```tsx
// contact-form-screen.test.tsx — acrescentar
it("sends the phone and the consent flag, and locks the phone the person typed", async () => {
  arrangeContact({ phone: null, phoneSource: null, whatsappConsentAt: null });
  render(<ContactFormScreen contactId={ID} />);

  await userEvent.type(await screen.findByLabelText("WhatsApp"), "11988887777");
  await userEvent.click(screen.getByLabelText("Essa pessoa concordou em receber cobranças por WhatsApp"));
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

  const body = lastBody("PATCH");

  expect(body.phone).toBe("+5511988887777");
  expect(body.whatsappConsent).toBe(true);

  cleanup();
  arrangeContact({ phone: "+5511977776666", phoneSource: "person", whatsappConsentAt: null });
  render(<ContactFormScreen contactId={ID} />);

  expect(await screen.findByText("Número informado pela própria pessoa")).toBeTruthy();
  expect(screen.getByLabelText("WhatsApp")).toHaveProperty("disabled", true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- charge-detail-screen contact-form-screen`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`remind-dialog.tsx`:
```tsx
"use client";

import { type ManualReminderResult, NOBODY_REACHABLE, remindLines } from "@receivy/common";
import { Bell } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type RemindDialogProps = { recipientName: string; preview: ManualReminderResult | null; loading: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void };

export function RemindDialog({ recipientName, preview, loading, busy, onConfirm, onCancel }: RemindDialogProps) {
  const lines = preview ? remindLines(preview) : null;
  const nobody = preview !== null && preview.channels.length === 0;

  return (
    <ConfirmDialog
      title={`Lembrar ${recipientName}?`}
      icon={Bell}
      tone="primary"
      explanation={loading || !lines ? "Conferindo por onde avisar…" : nobody ? NOBODY_REACHABLE : `Vai por: ${lines.going}. Só um lembrete a cada 24 horas.`}
      details={lines?.dropped}
      confirmLabel="Enviar lembrete"
      busy={busy}
      disabled={loading || nobody}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
```
Se `ConfirmDialog` não tiver `details`/`disabled`, acrescentar as duas props opcionais nele (`details` renderiza `<ul>` de linhas `text-xs text-muted`; `disabled` desabilita o botão de confirmar). `charge-detail-screen.tsx`: ao abrir (`setConfirmRemind(true)`), `GET ${base}/reminders/preview` → `setPreview`; `remind()` lê `ManualReminderResult` e mostra `channels.length ? \`Lembrete enviado para ${name}.\` : NOBODY_REACHABLE`; substituir o bloco 634-645 por `<RemindDialog … />`.

Contato: campo `WhatsApp` (`<input type="tel" aria-label="WhatsApp">`, máscara simples de dígitos, desabilitado com nota quando `phoneSource === "person"`) e checkbox de consentimento (`checked = Boolean(whatsappConsentAt)` inicial); submit passa `phone` (só quando editável) e `whatsappConsent` por `normalizeContact` (que já normaliza E.164).

`financial-proxy.ts`: `["GET", new RegExp(\`^charges/${ID}/reminders/preview$\`)]`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: PASS (contrato ainda acusa `opt-out`, Task 6).

---

### Task 5: Mobile — editor, tela Lembretes, bloco na conta, contato, sheet do manual

**Files:**
- Create: `packages/mobile/src/components/app/reminder-editor.tsx`, `packages/mobile/src/components/screens/reminders-screen.tsx`, `packages/mobile/src/components/screens/reminders-screen.test.tsx`, `packages/mobile/src/app/(protected)/settings/reminders.tsx`, `packages/mobile/src/components/app/remind-sheet.test.tsx`
- Modify: `packages/mobile/src/account/client.ts`, `packages/mobile/src/notifications/client.ts:38-41`, `packages/mobile/src/components/screens/profile-screen.tsx` (nova `Row` e prop `onOpenReminders`), `packages/mobile/src/app/(protected)/(tabs)/settings.tsx`, `packages/mobile/src/components/forms/billing-form-screen.tsx:248-267,618-650` + JSX do bloco de notificar (~1295-1319), `packages/mobile/src/components/forms/contact-form-screen.tsx`, `packages/mobile/src/components/screens/charge-detail-screen.tsx:315-332,577`, `packages/mobile/src/components/app/remind-sheet.tsx`, `packages/mobile/src/components/screens/feed-screen.tsx:495-505`, testes vizinhos

**Interfaces:**
- Produces: `accountClient.reminders(): Promise<ReminderSettings>`, `accountClient.saveReminders(config: ReminderConfig): Promise<ReminderSettings>`, `accountClient.clearReminders(): Promise<ReminderSettings>`; `notificationClient.remind(id): Promise<ManualReminderResult>`, `notificationClient.remindPreview(id): Promise<ManualReminderResult>`; `ReminderEditor` (RN) com as mesmas props do web; `RemindSheet` ganha `preview: ManualReminderResult | null` e `loading: boolean` e mostra "Vai por: …" e as quedas; `ProfileScreen.onOpenReminders`.

- [ ] **Step 1: Testes**

```tsx
// reminders-screen.test.tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SYSTEM_REMINDER_CONFIG } from "@receivy/common";
import { RemindersScreen } from "./reminders-screen";

jest.mock("expo-router", () => ({ useFocusEffect: (effect: () => void) => require("react").useEffect(effect, []), useRouter: () => ({ back: jest.fn() }) }));

function client(overrides: Partial<ReturnType<typeof base>> = {}) {
  return { ...base(), ...overrides };
}

function base() {
  return {
    reminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }),
    saveReminders: jest.fn().mockImplementation(async (config) => ({ config, inherited: false, whatsappAvailable: false })),
    clearReminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }),
  };
}

const plans = { plan: jest.fn().mockResolvedValue({ plan: "basic", usage: { indefinite: { used: 0, limit: 30 } } }) };

describe("RemindersScreen", () => {
  it("loads the default rule with the disclaimer and caps the list at five", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);

    expect(await screen.findByText("no dia")).toBeTruthy();
    expect(screen.getByText("Notificação no app vai sempre que a pessoa permitir no celular dela.")).toBeTruthy();

    for (let i = 0; i < 4; i++) { await fireEvent.press(screen.getByLabelText("Adicionar lembrete")); }

    expect(screen.queryByLabelText("Adicionar lembrete")).toBeNull();
  });

  it("saves channels and clears back to the default", async () => {
    const api = client();

    await render(<RemindersScreen client={api} plans={plans} />);
    await fireEvent(await screen.findByLabelText("WhatsApp no lembrete no dia"), "valueChange", true);
    await fireEvent.press(screen.getByLabelText("Salvar"));

    expect(api.saveReminders).toHaveBeenCalledWith(expect.objectContaining({ reminders: [expect.objectContaining({ channels: { email: true, whatsapp: true } })] }));

    await fireEvent.press(await screen.findByLabelText("Voltar ao padrão"));

    expect(api.clearReminders).toHaveBeenCalled();
  });

  it("locks WhatsApp on the free plan", async () => {
    await render(<RemindersScreen client={client()} plans={{ plan: jest.fn().mockResolvedValue({ plan: "free", usage: { indefinite: { used: 0, limit: 5 } } }) }} />);

    expect(await screen.findByText("Plano Básico")).toBeTruthy();
    expect(screen.getByLabelText("WhatsApp no lembrete no dia").props.accessibilityState.disabled).toBe(true);
  });
});
```
```tsx
// remind-sheet.test.tsx
it("shows the channels from the preview and the drops with a reason", async () => {
  await render(<RemindSheet charge={summary()} today="2026-10-01" loading={false} preview={{ channels: ["push"], dropped: [{ channel: "email", reason: "no_email" }] }} onSend={jest.fn()} onClose={jest.fn()} />);

  expect(screen.getByText("Vai por: notificação no app")).toBeTruthy();
  expect(screen.getByText("E-mail: sem e-mail")).toBeTruthy();
});

it("disables sending when nobody is reachable", async () => {
  await render(<RemindSheet charge={summary()} today="2026-10-01" loading={false} preview={{ channels: [], dropped: [] }} onSend={jest.fn()} onClose={jest.fn()} />);

  expect(screen.getByText("Ninguém alcançável. Compartilhe o link direto.")).toBeTruthy();
  expect(screen.getByLabelText("Enviar lembrete").props.accessibilityState.disabled).toBe(true);
});
```
No `charge-detail-screen.test.tsx` do mobile: o teste do "Lembrar" passa a esperar a sheet (`await screen.findByText(/Vai por/)`) e o cliente injetado ganha `remindPreview`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/mobile test -- reminders-screen remind-sheet`
Expected: FAIL.

- [ ] **Step 3: Implementar clientes**

`account/client.ts`:
```ts
  reminders: () => request<ReminderSettings>("account/reminders"),
  saveReminders: (config: ReminderConfig) => request<ReminderSettings>("account/reminders", { method: "PUT", body: JSON.stringify(config) }),
  clearReminders: () => request<ReminderSettings>("account/reminders", { method: "DELETE" }),
```
`notifications/client.ts`:
```ts
    remind: (id: string) => request<ManualReminderResult>(`charges/${id}/reminders`, { method: "POST" }),
    remindPreview: (id: string) => request<ManualReminderResult>(`charges/${id}/reminders/preview`),
```

- [ ] **Step 4: Implementar `ReminderEditor` (RN)**

Mesma lógica do web, com `View`/`Text`/`TextInput` (`keyboardType="number-pad"`, `accessibilityLabel={\`Dias do lembrete ${index + 1}\`}`), `Switch` para ativo (`accessibilityLabel={\`Lembrete ${index + 1} ativo\`}`), chips como `Pressable accessibilityRole="switch" accessibilityState={{ checked, disabled }} accessibilityLabel="WhatsApp no lembrete no dia"` com `className` `rounded-full border px-3 h-8` e as cores `border-primary bg-primary-soft` quando ligado; rótulo bloqueado num `Text` pequeno ao lado, vindo de `whatsappLockLabel` do common; `PUSH_DISCLAIMER` também do common. `ManualChannels` igual.

- [ ] **Step 5: Implementar `RemindersScreen`, rota e Perfil**

`RemindersScreen({ client = accountClient, plans = financialClient })`: header `useTabHeader`/`Stack.Screen` com título "Lembretes" (seguir `settings/payment-methods.tsx`); carrega `client.reminders()` e `plans.plan()`; seções "LEMBRETES AUTOMÁTICOS" e "LEMBRETE MANUAL" (`Section` local igual ao do perfil), botão "Salvar" (`accessibilityLabel="Salvar"`), "Voltar ao padrão" quando `!inherited`; erro inline `<Text accessibilityRole="alert">`. Rota `app/(protected)/settings/reminders.tsx` renderiza `<RemindersScreen />`. Perfil: `Row icon="bell" tone="primary" label="Configurar lembretes" title="Lembretes" subtitle="Quando e por onde avisar quem te deve" onPress={onOpenReminders}` após "Meios de pagamento"; `settings.tsx` passa `onOpenReminders={() => router.push("/settings/reminders")}`. Se `ICONS` não tiver `bell`, reaproveitar o asset já usado pelo `ActionTile` "Lembrar" (`ICONS.bell` do detalhe da cobrança).

- [ ] **Step 6: Bloco na conta, contato e sheet**

`billing-form-screen.tsx`: mesmas mudanças da Task 3 do web (draft `null`, `clearReminders`, bloco "LEMBRETES" com "Usando seu padrão: …", "Personalizar", editor, "Voltar ao padrão"); `effective` vem de `billing.effectiveReminders` ou de `accountClient.reminders()` em conta nova; `whatsappGate.planAllows` do plano já carregado pelo form (`financialClient.plan()`), `available: false`.

`contact-form-screen.tsx`: `Field label="WhatsApp"` com `TextInput keyboardType="phone-pad" accessibilityLabel="WhatsApp"` (desabilitado + hint "Número informado pela própria pessoa" quando `phoneSource === "person"`) e `Switch accessibilityLabel="Essa pessoa concordou em receber cobranças por WhatsApp"`; `input` inclui `phone` (quando editável) e `whatsappConsent`.

`remind-sheet.tsx`: props `+ preview: ManualReminderResult | null; loading: boolean`; substituir a frase "Avisa por notificação no app ou por e-mail…" por `loading ? "Conferindo por onde avisar…" : nobody ? NOBODY_REACHABLE : \`Vai por: ${going}. Um lembrete a cada 24 horas.\``; abaixo da PRÉVIA, uma linha por queda (`Text className="text-[12px] text-muted"`); botão "Enviar lembrete" com `disabled={loading || nobody}` e `accessibilityState={{ disabled }}`. `remindLines` e `NOBODY_REACHABLE` vêm do common.

`charge-detail-screen.tsx` (mobile): trocar `Alert.alert` por estado `remindTarget` + `RemindSheet`; ao abrir, `notifications.remindPreview(id)` → `preview`; `onSend` chama `remind` e mostra `channels.length ? \`Lembrete enviado para ${name}.\` : NOBODY_REACHABLE`. `feed-screen.tsx`: mesma carga de preview ao definir `remindTarget`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test`
Expected: PASS. Se o router acusar rota nova sem tipo, regenerar `router.d.ts` via `router-server` (nota de memória).

---

### Task 6: Web — página pública de opt-out e contrato

**Files:**
- Create: `packages/web/src/app/opt-out/[token]/page.tsx`, `packages/web/src/components/app/opt-out-panel.tsx`, `packages/web/src/app/api/public/opt-out/[token]/route.ts`, `packages/web/src/components/app/opt-out-panel.test.tsx`
- Modify: `packages/web/src/lib/openapi-contract.test.ts` (`DEDICATED_BFF` + `NATIVE_DEFERRED`)

**Interfaces:**
- Produces: rota `GET /opt-out/[token]` (server component: chama `POST public/notices/opt-out/{token}` via `authApiFetch` sem sessão; 404 → `notFound()`); `OptOutPanel { token: string; optedOut: boolean }` com o botão "Voltar a receber", que chama a rota BFF `DELETE /api/public/opt-out/[token]` (repassa `DELETE public/notices/opt-out/{token}`). A página só anda numa direção: quem voltou a receber e mudar de ideia abre o link do e-mail de novo.

- [ ] **Step 1: Teste**

```tsx
// opt-out-panel.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OptOutPanel } from "./opt-out-panel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("confirms the opt-out and lets the person opt back in", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ optedOut: false }), { status: 200 }));

  render(<OptOutPanel token="abc.def" optedOut />);

  expect(screen.getByText("Você não recebe mais e-mails de cobrança. Quem te cobra ainda pode te mandar o link direto.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Voltar a receber" }));

  expect(fetchSpy).toHaveBeenCalledWith("/api/public/opt-out/abc.def", expect.objectContaining({ method: "DELETE" }));
  expect(await screen.findByText("Você voltou a receber e-mails de cobrança.")).toBeTruthy();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- opt-out-panel`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`page.tsx` (espelhar o cabeçalho de `app/pay/[token]/page.tsx`: `metadata` com `robots: { index: false }`, `dynamic = "force-dynamic"`, `PAGE`/`SHELL`, `Brand`):
```tsx
export default async function OptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = await authApiFetch(`public/notices/opt-out/${encodeURIComponent(token)}`, { method: "POST" });

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error("opt-out failed");
  }

  return (
    <main className={PAGE}>
      <div className={SHELL}>
        <Brand />
        <h1 className="m-0 text-xl font-bold text-ink">Avisos por e-mail</h1>
        <OptOutPanel token={token} optedOut />
      </div>
    </main>
  );
}
```
`opt-out-panel.tsx` (`"use client"`): estado `optedOut`; texto conforme o estado; botão "Voltar a receber" faz `fetch(\`/api/public/opt-out/${token}\`, { method: "DELETE" })` e, com 200, `setOptedOut(false)`; erro inline `role="alert"` "Não foi possível alterar. Tente de novo pelo link do e-mail.". `route.ts`: `export async function DELETE(_: Request, { params }: { params: Promise<{ token: string }> })` → `authApiFetch(\`public/notices/opt-out/${token}\`, { method: "DELETE" })` e devolve o status.

Contrato: `DEDICATED_BFF` ganha `"POST public/notices/opt-out/{p}", "DELETE public/notices/opt-out/{p}"` com o comentário `// The e-mail footer lands on /opt-out/[token], a server component; the "Voltar a receber" button goes through /api/public/opt-out.`; `NATIVE_DEFERRED` ganha `"public/notices/opt-out/{p}": "the e-mail footer always opens in the browser"`. O scanner nativo (`extractPathTemplates`) já reconhece `public` e `account`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test && pnpm --filter @receivy/web build`
Expected: PASS, contrato verde.

---

### Task 7: Verificação final e relatório

- [ ] **Step 1: Rodar tudo**

```bash
pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test
pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test && pnpm --filter @receivy/web build
pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test
```
Expected: verde, salvo baselines conhecidas.

- [ ] **Step 2: Smoke manual (dono)**

Listar no relatório o roteiro: perfil → Lembretes → adicionar 5, tentar a 6ª; salvar com WhatsApp no Básico; conta nova mostra "Usando seu padrão"; Personalizar e Voltar ao padrão; contato com telefone e consentimento; Lembrar mostra "Vai por" e quedas; e-mail de lembrete com "Parar de receber" abrindo `/opt-out/<token>` e "Voltar a receber".

- [ ] **Step 3: Relatório**

O que mudou por plataforma, o que ficou "Em breve" (chip WhatsApp), e o que a fase 2 (cota) precisa da UI: contador de mensagens na tela de Lembretes e no plano. Nada commitado.
