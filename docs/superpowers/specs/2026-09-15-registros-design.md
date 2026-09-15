# Registros: valor já recebido ou já pago, com contraparte só pelo nome

Data: 2026-09-15. Parte C de três (A: pagamento em análise; B: sem avisos; ambas implementadas). Usa a regra de
envio das partes A e B.

## Problema

- Não há como registrar um dinheiro que já entrou ou já saiu. Toda conta a receber exige participantes e toda
  cobrança nasce pendente, com avisos.
- A contraparte precisa ser um contato com usuário. Um salário de uma empresa, um aluguel pago a uma imobiliária
  ou uma venda avulsa não têm pessoa para cadastrar.
- Sem registros, "Recebido" e "Pago" do mês não refletem a renda e as despesas reais.

## Decisões

1. Um **registro** é uma conta só do dono, a receber ou a pagar, marcada como já quitada (`settled`), com a
   contraparte em **texto livre** (`counterpart_label`). Não cria contato nem usuário.
2. Vale para avulsa e recorrente. A avulsa aceita data no passado. A recorrente começa hoje ou depois, sem gerar
   meses antigos.
3. Cada cobrança de um registro fica quitada **no dia do vencimento**: nasce quitada se vence até hoje; se vence
   depois, nasce pendente e o cron diário a quita na data.
4. Registros nunca geram aviso: nem inicial, nem lembrete, nem manual, nem para o próprio dono em conta a pagar.
5. Contas com contatos não mudam: continuam com "Marcar como pago" e "Não notificar" (parte B).
6. Categoria nova "Salário e renda", disponível para qualquer conta.
7. `settled` não muda depois de criado; o nome livre é editável.

## Fora de escopo

- Registro com participantes ou recebedor com conta.
- Transformar uma conta existente em registro, ou o contrário.
- Registros retroativos em recorrentes (meses antes de hoje).
- Contraparte em texto livre para contas que não são registros.
- Extrato por contraparte em texto livre.

## 1. Dados e contrato

### Banco

Colunas novas, nulas (vazio conta como `false` / sem nome). A migração é do usuário:

```sql
ALTER TABLE billings ADD COLUMN counterpart_label text;
ALTER TABLE billings ADD COLUMN settled boolean;
```

- `counterpart_label`: nome livre, 1 a 120 caracteres depois de aparar espaços. Só existe em registros.
- `settled`: `true` só em registros.

### `@receivy/common`

- `BillingInput` ganha `settled?: boolean` e `counterpartLabel?: string`.
- `normalizeBillingInput` com `settled: true`:
  - exige `counterpartLabel` com 1 a 120 caracteres depois de aparar (mensagem "Informe de quem é o valor." na
    conta a receber, "Informe para quem é o valor." na conta a pagar);
  - recusa `split` com partes `User`, `payeeUserId`, `paymentMethodId`, `pix`, `reminders` (mensagem "Registro não
    tem participantes nem avisos.");
  - conta a receber usa o split só do dono (`{ mode: Equal, parts: [{ kind: Owner }] }`), como a conta a pagar sem
    recebedor já faz;
  - avulsa (`BillingType.Once`) aceita `startDate` no passado;
  - recorrente (`Until`, `Indefinite`) exige `startDate` hoje ou depois (mensagem "Registro recorrente começa hoje
    ou depois.").
- Sem `settled`, conta a receber sem participante continua recusada ("Selecione ao menos um contato.").
- `BillingSummary`, `BillingDetail` e `ChargeSummary` ganham `settled: boolean` e `counterpartLabel: string | null`
  (opcionais no tipo, sempre enviados pela API).
- `BillingCategory.Income = 'income'`, rótulo "Salário e renda", com cor em `BILLING_CATEGORY_COLORS` e ícone nos
  clientes onde as categorias têm ícone.
- `BillingDraft` ganha `settled?: boolean` e `counterpartLabel?: string`; `buildBillingInput` envia os dois e omite
  participantes, recebedor, Pix e lembretes quando `settled`.
- `canRemind(charge)` (`charge-text.ts`, regra do botão "Lembrar") passa a devolver `false` quando `charge.settled`.

## 2. API

### Rotas existentes que mudam

- `POST /billings` com `settled`:
  - grava `settled = true` e `counterpart_label` aparado;
  - as cobranças nascem sem devedor (`debtor_user_id` nulo); na conta a pagar `payer = owner`, como hoje;
  - na mesma transação, cada cobrança com `due_date` até hoje (no fuso da conta) é quitada: `state = paid`,
    `paid_at` = início do dia do vencimento no fuso da conta, evento `charge.paid { via: 'registered' }`;
  - cobranças futuras nascem pendentes.
- `PATCH /billings/{id}`:
  - aceita `counterpartLabel` só em registros (mesma validação); em conta comum responde 409 `SETTLED_LOCKED`;
  - `settled` no corpo, diferente do valor gravado, responde 409 `SETTLED_LOCKED`;
  - edições que criam cobranças (reagendar, mês novo) seguem a regra de quitação da criação.
- `GET /billings`, `GET /billings/{id}`, `GET /charges/{id}`, timeline: `settled` e `counterpartLabel`.
- `ChargeRepository.counterpartName`: sem devedor e com `counterpart_label`, devolve o nome livre (hoje devolve
  "Você").
- `POST /charges/{id}/pay` e `POST /charges/{id}/reopen`: sem mudança. Reabrir um registro deixa a cobrança
  pendente.
- `POST /charges/{id}/reminders`: cobrança de registro responde 409 `SETTLED_NO_REMINDERS`.

### Cron

- `BillingCron` (05:00 UTC), depois de `materializeDueBillings`, chama `BillingRepository.settleRegistered(db, now)`:
  quita cada cobrança `pending` de conta `settled` com `due_date` até hoje no fuso da conta, com a mesma regra da
  criação.
- Cobrança com evento `charge.reopened` não é quitada pelo cron (quem reabriu decidiu que não entrou); só volta a
  quitar por "Marcar como pago".
- Idempotente. Conta pausada não gera ocorrência; encerrada mantém as quitadas.
- `materializeNextOccurrence` e as materializações inline (criação, patch) aplicam a mesma quitação às cobranças
  que criam.

### Erros

| Status | Código | Quando |
| --- | --- | --- |
| 409 | `SETTLED_LOCKED` | mudar `settled` de uma conta existente, ou `counterpartLabel` em conta comum; mensagem "Não dá para mudar um registro depois de criado." |
| 409 | `SETTLED_NO_REMINDERS` | lembrete manual de cobrança de registro; mensagem "Registros não têm avisos." |

As classes ficam em `billings/errors.ts` (`SettledLockedError`) e `charges/errors.ts` (`SettledNoRemindersError`,
ao lado de `ChargeInReviewError`, que o lembrete manual já lança).

## 3. Notificações

- `sendChargeNotice`: depois do gate `silenced`, cobrança de conta `settled` grava
  `notice.skipped { template, reason: 'settled' }` (mais `offsetDays` quando houver) e não envia, em qualquer canal.
- `announceCharges` e `planReminders`: pulam cobranças de contas `settled` antes de agendar, sem evento.
- `followUpCharge`: pula cobrança de conta `settled`, sem evento.
- `NotificationRepository.manualReminder`: lança `SettledNoRemindersError` antes de enviar.
- Repositórios continuam sem importar serviços de notificação.

## 4. Interface (web e mobile, mesmo comportamento)

### Formulário (`billing-form-screen`)

- Abaixo de "Vou receber" / "Vou pagar", chave "Já recebi" (receber) ou "Já paguei" (pagar).
- Ligada:
  - troca o bloco de participantes (receber) ou recebedor (pagar) pelo campo "De quem" (receber) / "Para quem"
    (pagar), obrigatório, placeholder "Ex.: Empresa X";
  - esconde Pix, lembretes e "Não notificar";
  - avulsa aceita data passada; recorrente tem data mínima hoje;
  - texto de apoio: "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento."
- Edição de registro: chave visível e travada com "Não dá para mudar depois de criada."; nome editável.
- Categoria "Salário e renda" na lista de categorias.

### Listas, feed e detalhe da cobrança

- O nome livre aparece onde hoje aparece a contraparte.
- Selo "Registro" junto ao status.
- Escondidos em cobrança de registro: "Lembrar", link público, comprovante, "Não notificar". "Reabrir" e "Marcar
  como pago" seguem as regras atuais.

### Detalhe da conta

- Cabeçalho "De {nome}" (receber) / "Para {nome}" (pagar) no lugar da lista de participantes.
- Escondidos: convite e ações por participante.

## 5. Testes

- API (integração):
  - avulsa settled no passado nasce quitada (`via: 'registered'`, `paid_at` no vencimento, sem devedor); avulsa
    futura nasce pendente e `settleRegistered` quita no dia;
  - recorrente começa hoje ou depois (passado recusado); ocorrência materializada pelo cron é quitada no mesmo
    passe; cobrança reaberta não é quitada de novo; segunda execução não muda nada;
  - validação: settled sem nome, com participante, recebedor, Pix ou lembretes é recusado; receber só do dono sem
    settled continua recusado;
  - `PATCH`: muda o nome; mudar `settled` ou mandar nome em conta comum responde 409 `SETTLED_LOCKED`;
  - avisos: `notice.skipped` com `settled`; `planReminders`/`announceCharges` não agendam; lembrete manual responde
    409 `SETTLED_NO_REMINDERS`;
  - leitura: `counterpartName` devolve o nome livre; timeline soma em recebido/pago no mês do vencimento.
- Common: `normalizeBillingInput` com e sem settled, `BillingCategory.Income` com rótulo e cor, draft e input.
- Web e mobile: chave e campo de nome no formulário (participantes/Pix escondidos, corpo enviado, data mínima na
  recorrente); selo "Registro" e "Lembrar" escondido na cobrança; "De {nome}" no detalhe da conta.

## 6. Documentação e dados de teste

- OpenAPI regenerado (campos novos; nenhuma rota nova, BFF e cliente mobile sem mudança).
- `docs/notifications.md`: seção "Registros" com o gate `settled` e o 409 do manual.
- `docs/api-errors.md`: `SETTLED_LOCKED` e `SETTLED_NO_REMINDERS`.
- `docs/manual-qa-script.md`: seção `## 21. Registros` (salário recorrente, avulso no passado, reabrir, lembrar
  bloqueado).
- Seed local: salário mensal "Empresa X" em "Salário e renda" (receber, settled) e um pagamento avulso quitado no
  mês passado (pagar, settled).
