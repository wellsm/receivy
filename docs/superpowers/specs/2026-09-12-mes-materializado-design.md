# Mês materializado

Decisões de 2026-09-12. A conta recorrente (`indefinite`) só vira cobrança no vencimento (ou antes, pelo
menor offset de lembrete), e o Feed deixou de mostrar prévias: o mês corrente precisa aparecer como
cobranças reais. Hoje, porém, criar uma cobrança dispara o aviso inicial na hora; materializar o mês
cedo avisaria o devedor dias antes. O Parcelado já sofre disso: 10 parcelas mandam 10 avisos na criação.

## Escopo

- Toda ocorrência que vence **até o fim do mês corrente** (fuso do billing) existe como cobrança.
- Aviso inicial só para cobrança que vence hoje (ou antes), ou que nenhum lembrete ainda alcança;
  as demais recebem o primeiro contato pelos lembretes do cron.
- Pausar e Encerrar perguntam o que fazer com as pendentes.
- Editar uma recorrente pergunta se as cobranças do mês que ainda não venceram também mudam.
- Totais do Feed e do extrato do contato **não mudam**: já somam as cobranças criadas e pendentes.
- Fora do escopo: cron mensal separado, recriar cobranças canceladas ao retomar, avisar o devedor de
  uma edição, janela configurável (N dias) no lugar do fim do mês.

## Dados

Nenhuma coluna nova. O índice único `charges(billing_id, debtor_user_id, due_date)` vale também para
cobranças canceladas: por isso a edição atualiza a cobrança existente em vez de cancelar e recriar.

## Domínio (`@receivy/common`)

- `billing.ts`:
  - `export const enum PendingChargesAction { Keep = 'keep', Cancel = 'cancel' }`.
  - `export const enum EditScope { CurrentMonth = 'current_month', NextMonth = 'next_month' }`.
  - `BillingPatch.pendingCharges?: PendingChargesAction` — só com `state` `paused`/`ended`.
  - `BillingPatch.applyTo?: EditScope` — só em recorrente; ausente = `NextMonth`.
- `billing-calendar.ts`: `materializationDate(dueDate, reminders)` passa a ser o menor entre o dia 1 do
  mês do vencimento e `dueDate + menor offset habilitado`. `preview` e `nextMaterialization` herdam a regra.

## API

### Materialização

- `dueOccurrences` (`billings/repositories/billing.ts`): `latest = max(endOfMonth(today), today - menor offset)`.
  O fim do mês é a regra nova; o offset continua para lembretes que cruzam o mês (−5 do dia 3 cai no dia 28).
- Recorrente criada no meio do mês cria na hora as ocorrências restantes do mês. O `BillingCron`
  diário (05:00 UTC) cria o mês no dia 1. Anual só quando o mês dela chega.
- Única e Parcelado: sem mudança na materialização (tudo na criação).
- Retomar: sem mudança; o cursor `processed_through` já está no fim do mês, então nada é recriado
  neste mês, inclusive cobranças canceladas na pausa.

### Aviso inicial

- Função pura `shouldSendInitialNotice({ dueDate, today, reminders, now, timezone })` em
  `notifications/services/planner.ts`: `true` quando
  1. `dueDate <= today`; ou
  2. `dueDate > today` e nenhum lembrete habilitado tem instante (06:00 local de `dueDate + offset`)
     depois de `now` — inclui "sem lembretes".
- `announceCharges` (`notifications/services/send.ts`) lê `due_date` da cobrança e `timezone`/`reminders`
  do billing, e só chama `notifyCharge(..., Initial)` quando a função retorna `true`. Conta a pagar
  continua fora. Vale para os quatro pontos de chamada (criação, cron, convite, convidado).
- O link público continua nascendo no primeiro envio (aviso ou lembrete).

### Pausar e Encerrar

- `PatchBody.pendingCharges?: PendingChargesAction`. Enviado sem `state` `paused`/`ended` →
  `PendingChargesWithoutStateError` (422, `billings/errors.ts`, listado em `httpErrors` do `api.ts`).
- Ausente: comportamento atual (Pausar mantém; Encerrar cancela todas).
- Pausar nunca cancela pendentes por conta própria: ausente e `Keep` têm o mesmo efeito (mantém tudo).
  Só `Cancel` cancela. Isso vale mesmo quando uma pendente já foi materializada no mês seguinte por um
  lembrete de offset negativo (ex.: −5 no dia 3 já existe em 28) — pausar nunca a derruba, e retomar
  não a recriaria (o cursor já passou dela).
- Encerrar mantém o padrão atual: ausente cancela todas. `Keep` aplica o estado e cancela só as
  pendentes com `due_date > endOfMonth(today)`; no Parcelado encerrado, cancela as parcelas dos meses
  seguintes. As mantidas seguem pagáveis e recebendo lembretes.
- `Cancel` (Pausar ou Encerrar): aplica o estado e cancela todas as pendentes (atrasadas e com
  comprovante em análise inclusive), como o Encerrar atual.
- `charge.cancelled` com `payload.reason` `billing_paused` ou `billing_ended`.
- `cancelPendingCharges` ganha o filtro opcional de data e o motivo.

### Edição

- `PatchBody.applyTo?: EditScope`. Enviado para Única ou Parcelado → `EditScopeNotRecurringError`
  (422, `billings/errors.ts`, `httpErrors`).
- `NextMonth` (ou ausente): comportamento atual.
- `CurrentMonth`, dentro da transação do `patch`, depois de gravar o billing:
  - Elegíveis (fuso do billing): pendentes, `today < due_date <= endOfMonth(today)`, `proof_state`
    nulo ou `rejected`.
  - Para cada `due_date` elegível, recalcula o plano com os dados novos (`planBillingCharges`: total,
    divisão, descrição, Pix/payee) e compara por `debtor_user_id`:
    - mesma pessoa: `updateOne` de `amount_cents`, `description`, snapshots de Pix, `updated_at`;
      evento `charge.edited`; id e `public_id` preservados;
    - pessoa que saiu: cancela com `reason: 'billing_edited'`;
    - pessoa nova: `persistChargePlan` para a data, depois `announceCharges` (o gate decide).
  - Reagendamento (`startDate`/`dueRule`): a nova data **do mesmo mês** vira o `due_date` da cobrança
    elegível. Se colidir com outra cobrança da mesma pessoa (índice único), essa cobrança fica como
    está; a edição não falha.
  - Lembretes e categoria não tocam cobranças.
  - Nenhum aviso ao devedor; a página pública lê a cobrança e já mostra o novo valor.
- `docs/api-oas.yml` regenerado; `docs/api-errors.md` com os dois 422.

### Esclarecimentos (levantados no plano)

- **Remarcar dentro de um mês que já tem cobrança** (qualquer escopo): o cursor vai para o fim desse
  mês, então o mês não ganha uma segunda cobrança. Sem isso, trocar o vencimento de 15 para 30 no dia 16
  criaria a de 30 na hora, ao lado da de 15.
- **Convite aceito em recorrente** (`joinSplit`): muda as alocações; as cobranças já criadas do mês
  ficam como estão (mesmo efeito de `NextMonth`).
- **Aviso inicial liberado ao publicar o Pix** (`PublicLinkRepository.createOrRotate`): passa pelo mesmo
  gate via `announceCharges`; cobrança futura segue esperando o lembrete.
- **Pessoa nova na edição com cobrança cancelada da mesma pessoa e data** (índice único): a criação é
  pulada, como na colisão do reagendamento.
- **Pausar nunca cancela** (achado da revisão final): ausente e `Keep` têm o mesmo efeito no Pausar —
  mantêm toda pendente, inclusive a que um lembrete de offset negativo já materializou no mês seguinte.
  Só `Cancel` cancela no Pausar. Encerrar continua como descrito acima (ausente cancela, `Keep` só
  depois do fim do mês, `Cancel` cancela tudo).
- **`CurrentMonth` só muda o que o patch pediu** (achado da revisão final): `due_date` só é recalculado
  quando o patch reagenda (`startDate` e/ou `dueRule`); sem isso, o dia atual da cobrança elegível é
  preservado, mesmo que o billing carregue um `start_date`/`due_rule` deixado por um `NextMonth`
  anterior. Os snapshots de Pix (`pix_key_snapshot` e companhia) só são regravados quando o patch mexe
  em Pix (`paymentMethodId`, `clearPaymentMethod`, `pix` ou `clearPix`); um edit de valor/descrição não
  troca a chave de um link já compartilhado. Valor e descrição continuam seguindo o plano novo.
- **`CurrentMonth` valida só quem entra** (achado da revisão final): a revalidação de contato/chave
  Pix dentro do `applyTo` alcança apenas as pessoas de `changes.create` (quem vai ganhar uma cobrança
  nova neste mês) e, quando necessário um snapshot de Pix, a fonte do Pix. Atualizar uma cobrança de
  quem já estava no billing nunca falha por causa de outro participante ou da chave armazenada terem
  sido arquivados depois. O `payer` de `planBillingCharges` continua vindo de `payableOf(row)`, sem
  disparar a validação completa quando ninguém entra.
- **`applyTo` num billing não ativo não faz nada** (achado da revisão final): quando o estado efetivo
  do patch (`patch.state ?? row.state`) não é `active` — por exemplo, pausar e editar a divisão no
  mesmo patch, ou editar um billing já pausado — o `applyTo` é ignorado sem erro; nenhuma cobrança nova
  é criada para quem entrou na divisão.

## UI (web e mobile)

- Componente de escolha: `web/src/components/app/scope-dialog.tsx` e
  `mobile/src/components/app/scope-modal.tsx` — título, explicação, ação primária, ação secundária
  (tom `danger` opcional) e **Voltar**. Três usos: Pausar, Encerrar, edição.
- Contagens saem de `billing.charges` já carregado na tela, sem request extra.

### Detalhe da conta

- **Pausar** com pendentes: "Pausar conta?" — "Novas cobranças deixam de ser geradas. E as pendentes de
  “{descrição}”?" — **Manter as deste mês** (primária) · **Cancelar pendentes (N)** (danger) · Voltar.
  Sem pendentes: pausa direto.
- **Encerrar**: "Encerrar conta?", subtítulo "Esta ação não pode ser desfeita.", mesmas ações.
  Sem pendentes: confirmação simples atual. Substitui o `ConfirmDialog` do web e o `Modal` inline do mobile.
- **Retomar**: sem modal.

### Formulário de edição

- Recorrente que muda descrição, valor, divisão, Pix/chave, payee ou vencimento **e** tem ≥ 1 cobrança
  elegível: "Aplicar às cobranças deste mês?" — "N cobranças de {mês} ainda não venceram." —
  **Aplicar também às deste mês** (primária) · **Só a partir do mês seguinte** · Voltar.
- Caso contrário salva direto, sem `applyTo`.

## Testes

### Atualizar

- `test/scheduling/crons.spec.ts`: `:123-124` (recorrente criada no mês já tem a cobrança do mês),
  `:133-141` (aviso inicial só para a de hoje), `:197-200` (retomar não cria), `:239-244` (patch que
  chega em hoje, pelo gate). `:136` e `:319-330` continuam.
- `test/billings/billings.spec.ts`: `:230-232` (cobrança do mês na criação; `nextMaterialization` = dia 1
  do mês seguinte), `:244-257`, teste da timeline de recorrente.
- `test/notifications/notifications.spec.ts:292-311`: aviso inicial pelo gate.
- `common/src/domain/billing-calendar.test.ts`: `materializationDate`.

### Novos (integração)

1. Mensal dia 20 criada no dia 5: cobrança do dia 20 existe, sem aviso inicial, lembrete armado às 06:00 do dia 20.
2. Gate: vence hoje → avisa; futuro com lembrete por vir → não; futuro sem lembrete alcançável → avisa.
3. Parcelado 10×: só a parcela de hoje é avisada.
4. `Keep`/`Cancel` em Pausar e Encerrar; Encerrar + `Keep` no Parcelado cancela meses seguintes;
   `pendingCharges` sem `state` → 422.
5. `CurrentMonth`: mesmo id com novo valor; removida → cancelada; nova → criada sem aviso; com
   comprovante em análise ou vencendo hoje → intacta; vencimento muda no mês; colisão → pula;
   `NextMonth` não mexe; `applyTo` em finito → 422.

### Novos (unitários)

- `shouldSendInitialNotice` (vitest).
- Web e mobile: `scope-dialog`/`scope-modal`; detalhe (Pausar com e sem pendentes envia
  `pendingCharges`; Encerrar); formulário (edição com elegíveis envia `applyTo`; sem elegíveis ou só
  categoria salva direto).

### Docs

- `docs/api-errors.md`, `docs/api-oas.yml`, seção nova em `docs/manual-qa-script.md`.
