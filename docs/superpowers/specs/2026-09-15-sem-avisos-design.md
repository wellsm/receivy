# Sem avisos: "não notificar" por participante e por cobrança

Data: 2026-09-15. Parte B de três (A: pagamento em análise, implementada; C: registro já recebido/pago com
contraparte só por nome, spec própria). Usa a regra de envio da parte A: nenhum aviso sai fora do pendente sem
análise.

## Problema

- Quem cobra não tem como impedir os avisos automáticos para uma pessoa: um valor já combinado por fora, alguém
  que não quer ser lembrado, uma cobrança que só serve de registro.
- A única saída hoje é desligar os lembretes da conta inteira (`billings.reminders`), que vale para todos os
  participantes e não evita o aviso inicial.

## Decisões

1. "Não notificar" silencia só os **avisos automáticos para quem deve**: aviso inicial, lembretes agendados e o
   e-mail de reforço de 2 h. O "Lembrar" manual continua possível. Os pushes de pagamento da parte A ("Pagamento
   informado/confirmado/não identificado", "Comprovante recebido") seguem normais.
2. A escolha é **por participante na conta**: na criação (e na edição) cada participante tem sua chave. Não há
   padrão global no contato.
3. No detalhe da conta, a chave de um participante **grava nas cobranças**: aplica a todas as cobranças pendentes
   dele naquela conta e às futuras. Depois, cada cobrança pode ser ajustada sozinha. Quem decide o envio é só o
   valor da cobrança.
4. Só vale para conta a receber. Conta a pagar não tem participantes e seus avisos vão para o próprio dono.
5. Reativar não reenvia nada: o próximo lembrete agendado volta a sair. Lembrete cujo dia passou fica perdido
   (mesma regra de "Em análise").
6. Quem deve não vê diferença. Quem cobra vê o selo "Sem avisos" nos detalhes da conta e da cobrança.

## Fora de escopo

- Padrão "não notificar" guardado no contato.
- Selo ou filtro "Sem avisos" no feed e nas listas.
- Silenciar pushes de pagamento da parte A ou o "Lembrar" manual.
- Silenciar avisos do dono em conta a pagar.
- Registro já pago e contraparte sem contato (parte C).

## 1. Dados e contrato

### Banco

Colunas novas, nulas (vazio conta como `false`), sem `NOT NULL` para não esbarrar nas linhas existentes. A
migração é do usuário:

```sql
ALTER TABLE allocations ADD COLUMN silenced boolean;
ALTER TABLE charges ADD COLUMN silenced boolean;
```

- `allocations.silenced`: padrão do participante (`kind = 'user'`) para as cobranças geradas daqui para frente.
  Sempre vazio na parte do dono.
- `charges.silenced`: o único valor lido pela regra de envio.

### `@receivy/common`

- `SplitParty` e as partes `SplitPartKind.User` dos quatro modos de `BillingSplit` ganham `silenced?: boolean`
  (ausente = `false`). `resolveBillingSplit` repassa o campo sem validar nada além de ser booleano.
- `BillingAllocation` ganha `silenced: boolean`.
- `ChargeSummary` (e por extensão `ChargeDetail`) ganha `silenced: boolean`.
- Helper `canSilenceCharge(charge)`: credor, conta a receber, cobrança pendente. Usado por web e mobile para
  mostrar a ação na cobrança.

## 2. API

### Rotas existentes que mudam

- `POST /billings`: cada parte `User` com `silenced: true` grava a allocation com `silenced = true`. Parte do dono
  ignora o campo.
- Toda cobrança nasce copiando `silenced` da allocation do seu devedor: na criação, no processamento mensal e nas
  cobranças criadas por uma edição (`persistChargePlan` / `planBillingCharges`).
- `PATCH /billings/{id}` com split novo: a recriação das allocations (`billings/repositories/billing.ts`, hoje
  `deleteMany` + `insertOne`) preserva `silenced` de cada `userId` que continua na conta quando a parte enviada não
  traz o campo. Quando a parte traz o campo, o valor enviado vale e também grava as cobranças pendentes daquele
  devedor (mesma regra da rota nova). Quem entra usa o valor enviado (ausente = `false`).
- `GET /billings/{id}`: `allocations[].silenced` e `charges[].silenced`.
- `GET /charges/{id}`, timeline e ledger do contato: `silenced` em cada cobrança.

### Rotas novas

- `PUT /billings/{id}/participants/{userId}/silenced`, corpo `{ silenced: boolean }`, sessão.
  - Só o dono. Outro usuário ou conta inexistente: 404. Conta a pagar: 409 `SILENCE_UNAVAILABLE`. `userId` que não
    é participante (`kind = 'user'`) da conta: 404.
  - Numa transação: grava `allocations.silenced` e `charges.silenced` de todas as cobranças `pending` daquele
    devedor na conta. Pagas e canceladas não mudam.
  - Evento na conta: `billing.participant_silenced` ou `billing.participant_unsilenced`, payload `{ userId }`.
    Mesmo valor já gravado: responde sucesso sem evento.
  - Resposta: `BillingDetail` atualizado (como `PATCH /billings/{id}`).
- `PUT /charges/{id}/silenced`, corpo `{ silenced: boolean }`, sessão.
  - Só o credor (`creditor_id`). Outro usuário: 404. Conta a pagar (`payer = owner`): 409 `SILENCE_UNAVAILABLE`.
    Cobrança não pendente: 409 `ChargeClosedError` existente.
  - Grava só `charges.silenced`. Evento `charge.silenced` ou `charge.unsilenced`; mesmo valor: sucesso sem evento.
  - Resposta: `ChargeDetail` atualizado (como `GET /charges/{id}`).

### Erros

| Status | Código | Quando |
| --- | --- | --- |
| 409 | `SILENCE_UNAVAILABLE` | silenciar participante ou cobrança de conta a pagar; mensagem "Só uma conta a receber tem avisos automáticos para pausar." |

`SilenceUnavailableError` fica em `charges/errors.ts` e é usado pelas duas rotas.

### BFF (web)

`financial-proxy` permite `PUT billings/{id}/participants/{id}/silenced` e `PUT charges/{id}/silenced`, ancorados
como as rotas existentes.

## 3. Notificações

- `sendChargeNotice` (`notifications/services/send.ts`): depois do gate `in_review`, se `charges.silenced` e o
  canal não for `'both'` (o "Lembrar" manual), grava `notice.skipped { template, reason: 'silenced' }` (mais
  `offsetDays` quando houver) e não envia.
- `planReminders`: seleciona `silenced` e pula a cobrança antes de agendar, como faz com `proof_state`.
- `announceCharges`: pula cobrança silenciada antes do aviso inicial.
- `followUpCharge`: lê `silenced`; silenciada entre o push e o reforço não recebe o e-mail.
- Agendamento já armado para uma cobrança silenciada depois: o disparo passa por `sendChargeNotice` e cai no gate.
  Nenhum agendamento é cancelado.
- `pushPaymentNotice` (parte A) e `manualReminder` não mudam.
- Repositórios continuam sem importar serviços de notificação (teste de import cycle).

## 4. Interface (web e mobile, mesmo comportamento)

### Formulário de conta (`billing-form-screen`)

- Só em conta a receber. Cada participante escolhido ganha a chave "Não notificar", desligada por padrão, com o
  texto de apoio "Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente."
- Na edição, a chave vem com o valor atual de cada participante; o valor vai no split enviado.

### Detalhe da conta (`billing-detail-screen`)

- Cada linha de cobrança silenciada (`charge.silenced`): selo "Sem avisos".
- Ação por participante (dono, conta a receber), uma vez por participante na primeira linha dele: "Não notificar"
  / "Voltar a notificar", conforme `allocation.silenced`.
- Silenciar pede confirmação: título "Não notificar {nome}?", texto "Os lembretes automáticos das cobranças
  pendentes e futuras de {nome} nesta conta param." e botão "Não notificar".
- Reativar não pede confirmação; aviso "Avisos reativados para {nome}."

### Detalhe da cobrança (`charge-detail-screen`)

- Quando `silenced`: selo "Sem avisos" junto ao status.
- Quando `canSilenceCharge`: ação "Não notificar esta cobrança" / "Voltar a notificar" perto de "Lembrar", que
  continua igual.
- Avisos: "Avisos desta cobrança pausados." / "Avisos reativados."

### Erros na interface

`SILENCE_UNAVAILABLE` e `ChargeClosedError` mostram a mensagem da API, como as demais ações das telas.

## 5. Testes

- API (integração):
  - criação com participante silenciado grava allocation e cobranças; processamento mensal copia para as novas;
  - edição do split preserva o valor de quem fica e aplica o enviado a quem entra;
  - rota do participante grava allocation e pendentes, não toca pagas/canceladas, 404 para outro usuário e para
    não participante, 409 `SILENCE_UNAVAILABLE` em conta a pagar, sem evento quando o valor não muda;
  - rota da cobrança grava só a cobrança, 409 em cobrança fechada e em conta a pagar, 404 para quem não é credor;
  - envio: `sendChargeNotice` registra `notice.skipped` com `silenced` para os templates inicial e lembrete e no
    canal de reforço (e-mail); `announceCharges`, `planReminders` e `followUpCharge` pulam a cobrança silenciada
    sem registrar evento;
    "Lembrar" manual envia com a cobrança silenciada; silenciar entre push e reforço impede o e-mail.
- Common: tipos e `canSilenceCharge`.
- Web e mobile: chave no formulário vai no corpo; silenciar participante com confirmação chama a rota e mostra o
  selo; alternar na cobrança chama a rota e mostra o selo, com "Lembrar" ainda visível.
- Proxy: permite as duas rotas e recusa variações (método e caminho).

## 6. Documentação e dados de teste

- `docs/notifications.md`: seção "Sem avisos" com o gate `silenced`, a exceção do manual e o que não é silenciado.
- `docs/api-errors.md`: linha `SILENCE_UNAVAILABLE`.
- `docs/manual-qa-script.md`: seção 7 com criar conta silenciando alguém, silenciar/reativar no detalhe da conta e
  na cobrança, e "Lembrar" funcionando numa cobrança silenciada.
- OpenAPI regenerado.
- Seed local: um participante silenciado numa conta a receber e uma cobrança silenciada avulsa.
