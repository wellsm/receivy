# Perfil enxuto e política de entrega de avisos — design

Complementa `2026-09-08-billings-and-queues-design.md` (fatia 1 entregue).
Três blocos: (1) tela Perfil com 3 abas no mobile e no web, (2) remoção de
sessões, export e preferências de notificação da API e dos clientes,
(3) política de entrega dos avisos (horário comercial, push antes do e-mail).

## 1. Objetivo

- Perfil igual ao mockup aprovado: identidade, Gerenciamento (Contatos,
  Chaves Pix), Segurança e Sessão (Sair, Excluir), rodapé com versão e
  Termos/Privacidade. Sem foto, sem fuso horário, sem sessões, sem export,
  sem preferências de notificação.
- API sem superfícies que a UI não usa mais: listar/revogar sessões, export,
  preferências de notificação, listar/remover dispositivos push.
- Avisos previsíveis para quem paga: aviso de nova cobrança na hora;
  lembrete só no dia do vencimento às 09:00 no fuso da cobrança; push
  primeiro, e-mail 2 horas depois se ainda pendente.

## 2. Escopo

Dentro: `packages/api`, `packages/common`, `packages/web`, `packages/mobile`,
`docs/openapi.json`, `docs/account-lifecycle.md`, Maestro `04-tabs.yaml`.
Fora: filas SQS (fatia 2 herda a política daqui), foto de perfil, edição de
fuso horário, notificações de comprovante/pagamento (continuam só no feed).

## 3. Perfil

Mesma estrutura nas duas plataformas. Web dentro do `AppShell` (aba Perfil
ativa, sino no cabeçalho passa a apontar para `/settings`). Mobile é a rota
`/settings`, com a mesma barra de 3 abas do Feed (Feed, Cobranças, Perfil) e
sem botão "← Feed": a barra hoje é JSX inline em `feed-screen.tsx` e vira o
componente `TabBar` (`components/tab-bar.tsx`, prop `active`) usado pelos dois.

### Cabeçalho

Título "Perfil" centralizado; sino à direita (mesmo comportamento do Feed:
abre Perfil/notificações, ponto vermelho se `proofsToReview > 0` quando o
resumo estiver disponível; no Perfil o sino não tem ponto).

### Card de identidade

- Círculo com a inicial do nome (fallback "R" sem nome). Sem upload de foto.
- Nome em destaque + botão lápis (`accessibilityLabel="Editar nome"`).
  Ao tocar vira campo de texto + botão check (`accessibilityLabel="Salvar nome"`).
  Salvar → `PATCH account/profile` com `{ name, locale: 'pt-BR', country: 'BR', timezone }`
  onde `timezone` = fuso do dispositivo (`Intl.DateTimeFormat().resolvedOptions().timeZone`,
  fallback `America/Sao_Paulo`). Nome vazio não salva. Sucesso atualiza o
  `profileStore` (mobile) e o label; erro mostra "Não foi possível salvar o nome."
- E-mail completo abaixo, com ícone de envelope.

### Gerenciamento

Lista em card com divisores, cada linha ícone + título + subtítulo + chevron:
- "Meus Contatos" / "Gerenciar pessoas e dados salvos de cobrança" →
  `/people` (mobile `router.push`, web `Link`). `accessibilityLabel="Gerenciar contatos"`.
- "Minhas Chaves Pix" / "Chaves cadastradas para receber pagamentos" →
  tela de chaves Pix (mobile `PixSettingsScreen` com voltar "← Perfil";
  web rota `/settings/pix` com a `PixSettingsScreen` atual).
  `accessibilityLabel="Gerenciar chaves Pix"`.

### Segurança e Sessão

- "Sair da conta" / "Encerrar sessão ativa neste dispositivo" → confirmação
  ("Deseja sair da sua conta?" com "Sair" / "Cancelar"). Confirmar chama o
  logout da sessão atual (mobile `authClient.logout()` e volta ao login;
  web `POST /api/auth/logout` e `router.replace('/login')`; no mobile o
  `authClient.logout()` não navega, então a tela faz `router.replace('/login')`). Falha mostra
  "Não foi possível sair. Tente novamente." e mantém a tela.
- "Excluir conta" (vermelho) / "Remover histórico, vínculos e dados permanentemente"
  → modal: ícone de alerta, título "Excluir conta?", texto
  "Esta ação é irreversível. Suas cobranças, contatos e chaves Pix serão
  apagados. Registros compartilhados podem ser preservados com referências
  anonimizadas.", campo "Digite EXCLUIR para confirmar", botão
  "Confirmar exclusão" (habilita só com `EXCLUIR`) e "Cancelar". Fluxo de
  exclusão e mensagens `ACCOUNT_DELETED` / `ACCOUNT_DELETION_UNCONFIRMED`
  continuam os atuais (mobile via `accountClient.erase`; web mantém a
  tentativa de logout com retry).

### Rodapé

"Receivy v<versão>" (mobile `expo-constants` `expoConfig.version`; web
`NEXT_PUBLIC_APP_VERSION` injetado do `package.json` em `next.config.mjs`),
frase "Lembretes inteligentes e conciliação financeira descomplicada." e
links "Termos" / "Privacidade" (mobile `LegalSheet` do login; web `Link`
para as páginas `/terms` e `/privacy` existentes). O texto legal (mobile
`legal-text.tsx` e páginas web) deixa de citar exportação em JSON e
encerramento de sessões; passa a citar só "excluir sua conta em Perfil".

### Ícones

Mobile: SVGs em `assets/images/auth/` (`group.svg`, `key.svg`, `logout.svg`,
`trash.svg`, `edit.svg`, `check.svg`, `mail.svg` existente, `chevron.svg`,
`warning.svg`) renderizados com `expo-image` + `tintColor`. Web: `lucide-react`
(`Users`, `KeyRound`, `LogOut`, `Trash2`, `Pencil`, `Check`, `Mail`,
`ChevronRight`, `TriangleAlert`).

## 4. Remoções

### API (`packages/api`)

| Sai | Detalhe |
|---|---|
| `GET /account/sessions`, `DELETE /account/sessions/{id}` | `sessionsHandler`, `revokeHandler`, `listSessions`, tipos `SessionsResponse`/`RevokeRequest` |
| `POST /account/export`, `POST /account/export/download` | `exportHandler`, `downloadHandler`, `createExportTicket`, `downloadExport`, tipos `TicketResponse`/`DownloadRequest`/`DownloadResponse` |
| `GET/PATCH /notification-preferences` | handlers, `getPreferences`, `savePreferences`, tabela `notification_preferences` (`database.ts`, `NotificationPreferenceSchema`), limpeza em `account/deletion.ts` e `test/fixtures/financial.ts` |
| `GET /devices`, `DELETE /devices/{id}` | `listDevicesHandler`, `removeDeviceHandler`, `listDevices`, `removeDevice`, audit `notifications.device_removed` |

Fica: `PATCH /account/profile`, `DELETE /account`, `POST /devices`
(registro no login), `POST /charges/{id}/reminders`, `GET /charges/{id}/deliveries`,
`assertActiveSession`, `revokeSession`, `disableSessionDevices`,
`revokeFamilyByRefreshToken` (logout/refresh/exclusão dependem).

Comportamento sem preferências: e-mail sempre habilitado; push habilitado
quando há `device_tokens` ativos e `config.pushAvailable !== false`.
`effectiveReminders` → `billings.reminders` ou `DEFAULT_BILLING_REMINDERS`.

### Common

- `AccountSession`, `NotificationPreferences` saem. `NotificationDevice`
  fica (resposta do `POST /devices`). `DeviceRegistration` fica.
- `DEFAULT_BILLING_REMINDERS` passa a `[{ offsetDays: 0, enabled: true }]`.

### Web

- `financial-proxy.ts`: remove `account/sessions*`, `account/export*`,
  `notification-preferences`, `GET devices`, `DELETE devices/{id}`.
- `account-settings.tsx`, `notification-settings.tsx` (+ testes) saem;
  `billing-form.tsx` deixa de buscar `notification-preferences` (usa só
  `billing.reminders ?? DEFAULT_BILLING_REMINDERS`).
- `openapi-contract.test.ts` continua provando o allowlist contra o OpenAPI.

### Mobile

- `account/client.ts`: fica `profile`, `save`, `logout`, `erase`.
- `notifications/client.ts`: fica `register`, `remind`, `deliveries`.
- Registro de push deixa de ser manual ("Ativar push neste dispositivo"):
  `SessionGate` chama `registerPushDevice(notificationClient.register)` uma
  vez ao chegar em `ready`, best-effort (erro ou permissão negada só é
  ignorado). Pedido de permissão aparece no primeiro acesso após o login.
- `account-settings.tsx`, `notification-settings.tsx` (+ testes) saem;
  `billing-form-screen.tsx` deixa de buscar preferências.
- Maestro `04-tabs.yaml`: substitui "Exportar dados" por "Sair da conta" e
  mantém "Excluir conta", "Gerenciar chaves Pix", "← Perfil".

### Docs

`docs/openapi.json` regenerado (`pnpm openapi:generate`).
`docs/account-lifecycle.md`: seções de sessões (listar/revogar) e Export saem;
logout e exclusão permanecem. Spec de billings §4 "Lembretes" e §6
`NotificationCron` passam a citar `DEFAULT_BILLING_REMINDERS` em vez de
`notification_preferences`.

## 5. Política de entrega

Aplica-se aos três eventos entregues hoje (`charge.created`,
`charge.reminder`, `charge.manual_reminder`) no worker atual
(`outbox.ts`/`worker.ts`). A fatia 2 move o mecanismo para SQS mantendo
estas regras.

### Quando

| Evento | Disponível em |
|---|---|
| Nova cobrança (`charge.created`) | imediato, qualquer hora |
| Lembrete manual ("Lembrar") | imediato |
| Lembrete automático (`charge.reminder`) | `localDate` (due_date + offset) às **09:00** no `billings.timezone`; só se a cobrança ainda estiver `pending` |

Implementação do horário: `outbox_events.available_at` do lembrete recebe o
instante UTC de `localDate 09:00` no fuso (helper `zonedInstant(localDate, 'T09:00', timezone)`
em `billing-calendar.ts`, calculado via `Intl` sem dependência nova). O
worker mantém a checagem defensiva por dia civil, comparando também a hora
local (`civilClock(now, tz)` → `{ date, hour }`): se `date < localDate` ou
(`date === localDate` e `hour < 9`) adia 15 minutos.

### Canal

Para cada evento elegível (cobrança `pending`, Pix e link válidos):

1. Há `device_tokens` ativos do destinatário e push disponível → uma
   delivery `push` por dispositivo (até 10) com `available_at = now`, **e**
   uma delivery `email` com `available_at = now + 2h`, `reason = 'push_followup'`,
   se houver e-mail.
2. Sem push → delivery `email` com `available_at = now`.
3. Push falha em definitivo (`failed`) e existe a delivery `email` de
   follow-up ainda `pending` → `available_at` dela é antecipado para `now`
   (o `fallback` atual, que insere e-mail novo, passa a antecipar o existente
   quando ele existe e a inserir só quando não existe).
4. O e-mail de follow-up só sai se a cobrança continuar `pending` no momento
   do envio (regra já existente no worker: `suppressed`, `charge_or_capability_inactive`).
   Push `accepted` ou `uncertain` não cancela o follow-up.

Idempotência mantida: `digest(`${eventId}/${channel}/${key}`)`. O follow-up
usa a mesma chave que o fallback usaria (`${eventId}/email/${email}`), então
nunca há dois e-mails para o mesmo evento.

### Destinatário sem conta

Continua e-mail (`recipient_email_snapshot`) imediato/09:00; sem push.

## 6. Dados

Tabela `notification_preferences` some (`database.ts`, schema). Banco local é
recriado sem migração, como combinado na fatia 1. `notification_deliveries`
ganha o valor de `reason` `push_followup` (coluna já é texto livre).

## 7. Testes

- `packages/common`: `DEFAULT_BILLING_REMINDERS` = `[0]`; `zonedInstant`
  (`America/Sao_Paulo` 09:00 → 12:00Z; `America/Manaus` → 13:00Z).
- `packages/api` `notifications.spec.ts`: lembrete agendado às 09:00 local e
  não entregue antes; push + e-mail em 2h; e-mail suprimido se paga antes das
  2h; push falho antecipa o e-mail; sem dispositivos → e-mail imediato; casos
  de preferências, `removeDevice` e `savePreferences` saem ou viram o novo
  comportamento. `billings.spec.ts`: fallback de lembretes usa o default `[0]`.
  `account.spec.ts`: casos de listar/revogar sessão por id e export saem;
  logout/refresh replay e exclusão ficam.
- `packages/web`: `profile-screen.test.tsx` (nome inline, sair com confirmação,
  excluir com EXCLUIR, links), `app-shell.test.tsx` inalterado, `a11y.test.tsx`
  cobre `/settings`, `openapi-contract.test.ts` verde com allowlist reduzido.
- `packages/mobile`: `profile-screen.test.tsx` equivalente; `billing-form-screen`
  sem preferências; Maestro 04 atualizado e verde no iOS.

## 8. Decisões

- Notificações sem preferências: simplicidade > controle fino; quem não quer
  aviso não deve ser cobrado pelo app.
- Lembrete padrão só no dia: menos ruído; quem quiser antes/depois define
  na cobrança.
- E-mail 2 h após push: dá tempo de pagar pelo push antes de duplicar canal.
- 09:00 fixo no fuso da cobrança: "começo do dia em horário comercial";
  sem janela configurável.
- Aviso de nova cobrança imediato: quem cria acabou de combinar com quem paga.
- Sessões/export removidos da API inteira, não só da UI: menos superfície
  autenticada para manter e testar.
