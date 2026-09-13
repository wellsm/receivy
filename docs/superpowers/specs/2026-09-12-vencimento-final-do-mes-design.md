# Vencimento no final do mês

Decisões de 2026-09-12. Contas pagas no último dia do mês (aluguel) precisam vencer em 30 ou 31
conforme o mês. Hoje o dia vem da data de início com `min(dia, último dia do mês)`: começar em
30/09 gera 30/10, não 31/10, e editar o próximo vencimento para 30/11 perde o 31 para sempre.

## Escopo

- Vale para **Única**, **Mensal parcelado** (`until`) e **Mensal recorrente** (`indefinite`).
- **Anual** não oferece a opção; a API recusa `end_of_month` com `frequency = yearly`.
- Na Única a regra só é gravada para reabrir o formulário; o calendário não a usa.
- Trocar entre data fixa e final do mês na edição só existe na conta sem fim: Única e Parcelado
  geram todas as cobranças na criação e já recusam editar a data (`BillingSnapshotLockedError`).
- Fora do escopo: anual no fim do mês, "todo dia 30" independente do início, mexer em cobranças já geradas.

## Dados

```sql
ALTER TABLE billings ADD COLUMN due_rule text;
```

`billings.due_rule?: 'fixed' | 'end_of_month'`. Nula = `fixed`; sem backfill.

## Domínio (`@receivy/common`)

- `type BillingDueRule = 'fixed' | 'end_of_month'`.
- `BillingInput.dueRule?`, `BillingPatch.dueRule?` (ausente = `fixed` / sem mudança).
- `BillingSummary.dueRule?` e `BillingDetail.dueRule?`: a API sempre preenche; opcional no tipo para
  não mexer nas fixtures existentes, clientes leem `?? 'fixed'`.
- `BillingDraft.dueRule`, padrão `fixed`.
- `BillingCalendarRule.dueRule?`: em `billingDates`, `end_of_month` usa o último dia de cada mês;
  `fixed` continua `min(dia do início, último dia)`.
- `endOfMonth(date)`: último dia do mês da data.
- `endOfMonthOptions(today, count)`: `{ value, label, dueLabel }` do mês atual em diante
  (ex.: `{ value: '2026-09-30', label: 'Setembro de 2026', dueLabel: 'vence 30/09' }`).
- `normalizeBillingInput`:
  - `end_of_month` com Anual → `RangeError('Final do mês só vale para cobranças mensais.')`;
  - `end_of_month` com `startDate` que não é o último dia → `RangeError('Com final do mês, o vencimento deve ser o último dia do mês.')`;
  - `billingDueDates` recebe `dueRule`.
- `endDateFor` (N vezes do parcelado) passa `dueRule` para `billingDates`: 3 vezes a partir de
  30/09 = 30/09, 31/10, 30/11.

## API

- `BillingBody.dueRule?` e `PatchBody.dueRule?` (`'fixed' | 'end_of_month'`).
- Criação grava `due_rule: input.dueRule ?? 'fixed'`.
- `billingRequestFingerprint` inclui `dueRule` só quando é `end_of_month` (hashes antigos iguais).
- `BILLING_SELECT`/`BillingRow` com `due_rule`; `calendarRule(row)` passa `dueRule`, então preview,
  `nextMaterialization` e materialização seguem a regra; `summary`/`dto` expõem `dueRule`.
- `patchBilling`:
  - `dueRule` entra em `frozen` para Única e Parcelado;
  - par efetivo `dueRule = patch.dueRule ?? row.due_rule`, `startDate = patch.startDate ?? row.start_date`
    validado como na criação (Anual, último dia);
  - reagenda (cursor pelo `rescheduledCursor`) quando `startDate` **ou** `dueRule` mudam;
  - `materializeDue` após o commit também quando só `dueRule` mudou.
- `docs/api-oas.yml` regenerado.

## UI (web e mobile)

- Campo Vencimento / Próximo vencimento: chip **"Final do mês"** ao lado de "Hoje", visível em Única e
  Mensal; some em Anual (trocar para Anual com o modo ativo volta para `fixed`, mantendo a data).
- `fixed`: como hoje (data + "Hoje"; no mobile, texto + calendário).
- `end_of_month`: a data e o calendário somem; aparece o **seletor de meses** (mês atual + 12), gatilho
  "Setembro de 2026 · vence 30/09". "Hoje" volta para `fixed` com hoje; tocar de novo em
  "Final do mês" volta para `fixed` com a mesma data.
- `components/app/month-select.tsx` nos dois apps, no padrão do `CategorySelect`: web com um painel
  que é bottom sheet até `sm` e dropdown ancorado a partir de `sm`; mobile com `Modal` bottom sheet.
- `draftFromBilling` lê `billing.dueRule`; `buildBillingInput` envia `dueRule`; o patch da edição
  envia `dueRule` junto de `startDate`. `dueLocked` desabilita o fieldset inteiro.
- Detalhe: `typeTag` ganha `· final do mês` em "Parcelado (n/N)" e "Recorrente mensal".

## Testes

- common: `billingDates` com `end_of_month` (30/09 → 31/10 → 30/11 → 31/12 → 28/02; 29/02 em
  bissexto), validações, `endOfMonthOptions`, N vezes.
- API (integração, `test/billings/billings.spec.ts`): parcelado final do mês; conta sem fim trocando
  `fixed ↔ end_of_month` sem alterar cobranças geradas; recusas (Anual, dia errado, edição de parcelado).
- Web (Vitest) e mobile (RNTL): criar com final do mês escolhendo outubro (payload `2026-10-31` +
  `end_of_month`); Anual esconde o chip; edição de conta sem fim troca o modo.

## Docs

- `docs/recurrences.md`: variante `due_rule = end_of_month` na regra de dias 29–31.
- Linha nas notas do projeto.
