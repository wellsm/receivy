# Pagamento em análise: "já paguei" sem comprovante e notificações só no pendente

Data: 2026-09-14. Parte A de três (B: não notificar por contato/conta/cobrança; C: registro já recebido/pago com
contraparte só por nome). B e C dependem da regra de envio definida aqui e terão specs próprias.

## Problema

- Quem paga só consegue sinalizar o pagamento enviando um arquivo. Quem fez o Pix e não guardou o comprovante
  não tem como avisar.
- Com comprovante pendente, o aviso inicial, os lembretes agendados e o "Lembrar" chamado direto na API ainda
  saem. Só o e-mail de reforço (2 h após um push) é bloqueado. Os clientes escondem o botão, a API não.
- Numa conta a pagar, o dono marca "pago" direto: o recebedor nunca confirma se o dinheiro chegou.
- Ninguém é avisado quando um comprovante chega nem quando ele é aceito ou recusado.

## Decisões

1. "Marcar como pago" por quem paga, sem arquivo, deixa a cobrança **Em análise** (não vira paga). Quem recebe
   confirma (vira Paga) ou responde "não recebi" com motivo (volta a Pendente).
2. Podem declarar: o devedor logado de uma conta a receber, quem abre o link público e o dono de uma conta a
   pagar cujo recebedor tem conta ativa. Conta a pagar sem recebedor, ou com recebedor que nunca entrou no app
   (`users.status = pending`), continua marcando Paga direto.
3. Quem recebe ganha push ao receber uma declaração ou um arquivo. Quem pagou ganha push ao ser confirmado ou
   recusado. Sem e-mail nesses avisos.
4. A declaração é um **comprovante sem arquivo**: o comprovante ganha um tipo (arquivo | declaração) e "Em
   análise" é o comprovante pendente de qualquer tipo. Reusa envio, retirada, revisão, eventos e selos.
5. Nenhuma notificação de cobrança sai fora do estado pendente sem análise.
6. Em análise não expira. Quem declarou pode desfazer ou anexar o arquivo depois.

## Fora de escopo

- Opt-out de notificações por contato, conta ou cobrança (parte B).
- Registro já pago e contraparte sem contato (parte C).
- Filtro "Em análise" no feed e mudanças nos totais do resumo: em análise continua somando em a receber / a
  pagar, porque ainda é dinheiro em aberto.
- Reenvio de lembretes cujo dia passou durante a análise.
- E-mail para quem pagou pelo link público sem conta.

## 1. Dados e contrato

### Banco

`charges.proof_kind` (texto, nulo permitido): `file` | `declaration`. Nulo nas linhas existentes lê como `file`;
por isso a coluna não precisa de valor padrão. A migração é executada pelo responsável do projeto.

Uma declaração grava `proof_state = pending`, `proof_kind = declaration`, `proof_file = null`,
`proof_sent_at = agora`, `proof_sender_user_id` (quando logado) e `proof_actor_hash` (usuário ou token público,
como no upload), sem `proof_expires_at`. Anexar um arquivo sobre a própria declaração segue o fluxo de upload;
quando o arquivo chega, `proof_kind` vira `file` e o estado continua `pending`.

### `@receivy/common`

- `const enum ProofKind { File = 'file', Declaration = 'declaration' }`.
- `ChargeProof`: novo `kind: ProofKind`; `file: ProofFile | null`.
- `ChargeSummary` (item do feed): novo `proofKind: ProofKind | null`.
- `ChargeDetail` e `ChargeSummary`: novo `confirmationRequired: boolean` — verdadeiro quando a pessoa do outro
  lado pode confirmar (dono ativo numa conta a receber; recebedor ativo numa conta a pagar).
- `chargeInReview(charge)`: `state === pending && proofState === pending` (qualquer tipo).
- `TimelineSummary.proofsToReview` conta os dois tipos (liga o ponto no sino).
- Evento de pagamento: `charge.paid { via: 'manual' | 'proof' | 'declaration' }`.

## 2. API

### Rotas novas

| Rota | Quem | Efeito |
| --- | --- | --- |
| `POST /charges/{id}/proof/declaration` | devedor de conta a receber; dono de conta a pagar com recebedor ativo | grava a declaração, `proof.declared`, push para quem recebe |
| `POST /public/charges/{token}/proof/declaration` | portador do link público | idem, com o mesmo throttle do upload público |

Pré-condições, na ordem:

- cobrança `pending`, senão o erro atual de cobrança fechada;
- nenhum comprovante `pending` (arquivo ou declaração, de qualquer remetente), senão 409 `CHARGE_IN_REVIEW`;
- nenhum upload `uploading` ainda válido de outro remetente, senão o erro atual de upload em andamento. Um
  upload `uploading` do próprio remetente é descartado pela declaração (o objeto reservado é apagado do bucket,
  como quando um novo upload substitui o anterior).

### Rotas existentes que mudam

- `DELETE /charges/{id}/proof` e `DELETE /public/charges/{token}/proof`: retiram também a declaração, só para
  quem declarou (mesmo `proof_actor_hash`). Evento `proof.withdrawn`.
- `POST /charges/{id}/proof` e a versão pública (início do upload): aceitos quando o comprovante pendente é uma
  declaração do mesmo remetente; o arquivo substitui a declaração.
- `POST /charges/{id}/proof/review`: aceita e recusa os dois tipos. Aceitar: `proof_state = accepted`, cobrança
  Paga, `proof.accepted` + `charge.paid { via: 'declaration' | 'proof' }`. Recusar: `proof_state = rejected`,
  motivo, cobrança Pendente, `proof.rejected`. Push para quem pagou nos dois casos.
- `GET /charges/{id}/proof/download`: 404 para declaração.
- `POST /charges/{id}/reminders`: 409 `CHARGE_IN_REVIEW` com comprovante ou declaração pendente.
- `POST /charges/{id}/pay`:
  - feito por quem recebe com algo em análise vale como aceite (mesmos efeitos e push da revisão);
  - feito pelo dono de uma conta a pagar com recebedor ativo responde 403 `PROOF_DECLARATION_FORBIDDEN`: o
    caminho é a declaração. Sem recebedor ou com recebedor pendente, continua marcando Paga direto.

### Erros

| Situação | HTTP | Código |
| --- | --- | --- |
| Lembrar ou declarar com algo em análise | 409 | `CHARGE_IN_REVIEW` |
| Declarar sem ser quem paga, ou em conta a pagar sem recebedor ativo | 403 | `PROOF_DECLARATION_FORBIDDEN` |
| Declarar em cobrança paga ou cancelada | 409 | erro atual de cobrança fechada |
| Download de declaração | 404 | — |
| Excesso de declarações no link público | 429 | throttle atual de comprovantes |

## 3. Notificações

- `sendChargeNotice` (aviso inicial, lembretes agendados, reforço por e-mail, Lembrar manual) só envia com
  cobrança `pending` e `proof_state` diferente de `pending`. Caso contrário grava
  `notice.skipped { reason: 'in_review' }`.
- `planReminders` não agenda cobranças em análise. A checagem no envio continua, porque a cobrança pode entrar
  em análise entre o agendamento e o disparo.
- Depois de "não recebi" a cobrança volta ao ciclo normal de lembretes; lembretes vencidos durante a análise não
  são reenviados.

### Pushes novos (via `pushToUser`, só push)

| Quando | Destinatário | Título · corpo |
| --- | --- | --- |
| Declaração enviada | quem recebe (dono na conta a receber; recebedor na conta a pagar) | "Pagamento informado" · "Ana disse que pagou Aluguel · R$ 620,00. Confirme o recebimento." |
| Arquivo enviado | idem | "Comprovante recebido" · "Ana enviou o comprovante de Aluguel · R$ 620,00." |
| Aceito | quem pagou | "Pagamento confirmado" · "Wellington confirmou Aluguel · R$ 620,00." |
| Recusado | quem pagou | "Pagamento não identificado" · "Wellington: <motivo>" |

- URL: `<PUBLIC_WEB_ORIGIN>/charges/<id>`; o app passa a aceitar esse caminho em `notificationUrl`.
- O push de arquivo enviado sai dos endpoints de conclusão do upload (`/proof/complete`, logado e público), que
  os clientes sempre chamam; o evento do bucket não tem as variáveis de push. `notice.payment { key }` evita
  repetir o mesmo aviso para o mesmo envio.
- Códigos de erro seguem o padrão do repositório em maiúsculas (`CHARGE_IN_REVIEW`, `PROOF_DECLARATION_FORBIDDEN`).
- Quem pagou pelo link público só recebe push se a conta dele tiver aparelho ativo.
- O push sai depois do commit e falhas são ignoradas, como em `pushToUser` hoje.
- Os providers de comprovantes e de cobranças passam a declarar `NOTIFICATION_PUSH_TRANSPORT` e
  `EXPO_ACCESS_TOKEN` (`VariableOrValue` com padrão `disabled`, também no `ez4.project.js`).

## 4. Interface

### Regras (`@receivy/common`)

- `canDeclarePayment(charge)`: pendente, nada em análise, `direction === payable` para quem vê, e
  (`payer !== owner` ou `confirmationRequired`).
- `canWithdrawProof` e `canAcceptProof`: valem para os dois tipos.
- `canUploadProof`: também quando o comprovante pendente é uma declaração enviada por quem vê.
- `canMarkPaid` (dono de conta a pagar): falso quando `confirmationRequired`.
- `chargeStateLabel`: "Em análise" quando `chargeInReview`.
- `chargeBadges`: "Pagamento informado" (declaração) ou "Comprovante enviado" (arquivo).
- `chargeAction` (feed): em análise não oferece ação; conta a pagar própria com `confirmationRequired` oferece
  a declaração com o rótulo "Marcar pago".

### Feed (web e mobile)

- Linha em análise: estado "Em análise" + selo; sem Lembrar nem Marcar pago; toque abre a cobrança.
- "Marcar pago" numa conta a pagar com recebedor ativo abre a confirmação "Marcar como pago? Ana vai receber um
  aviso para confirmar." e envia a declaração.

### Detalhe da cobrança (web e mobile)

- Quem paga: botão "Já paguei" ao lado de "Enviar comprovante", com confirmação "Wellington vai receber um aviso
  para confirmar o recebimento.". Em análise: card "Pagamento informado em 14/09 · aguardando confirmação de
  Wellington" com "Desfazer" e "Anexar comprovante". Após recusa, o motivo aparece como na recusa de comprovante.
- Quem recebe: card "Ana informou que pagou em 14/09, sem comprovante" com "Confirmar recebimento" e "Não
  recebi" (abre o campo de motivo existente). Com arquivo, mantém "Ver comprovante", "Aceitar" e "Recusar".

### Link público (`/pay/[token]`)

- Abaixo da área de upload: "Já paguei e não tenho comprovante".
- Em análise: "Pagamento informado · aguardando confirmação de Wellington", com "Desfazer" e opção de anexar o
  arquivo.

## 5. Testes

- Common: `canDeclarePayment`, `canWithdrawProof`, `canUploadProof`, `canAcceptProof`, `canMarkPaid` com os dois
  tipos e com `confirmationRequired`; `chargeInReview`; `chargeStateLabel`, `chargeBadges` e `chargeAction`.
- API (integração em `receivy_tests`):
  - declarar logado e pelo link público; recusar declaração repetida (409) e de quem não paga (403);
  - desfazer só pelo remetente; anexar arquivo sobre a própria declaração;
  - aceitar (Paga, `via: 'declaration'`) e recusar (Pendente com motivo);
  - `pay` de quem recebe com algo em análise vale como aceite;
  - conta a pagar: recebedor ativo exige declaração (pay 403); recebedor pendente ou ausente marca Paga direto;
  - `sendChargeNotice` grava `notice.skipped in_review`; `planReminders` pula; Lembrar manual 409;
  - pushes novos com transporte falso: destinatário e texto.
- Web e mobile: linha do feed em análise; botões do detalhe para os dois lados; painel do link público.

## 6. Documentação e dados de teste

- `docs/notifications.md`: regra de envio e os quatro pushes.
- `docs/api-errors.md`: `CHARGE_IN_REVIEW` e `PROOF_DECLARATION_FORBIDDEN`.
- `docs/manual-qa-script.md`: roteiro do fluxo nos três lados (devedor, link público, conta a pagar).
- `docs/api-oas.yml`: regenerado.
- `packages/api/scripts/seed-local.mjs`: uma cobrança com "Pagamento informado".
