# Puxar do e-mail — design

Terceira fatia do plano Pro, e a primeira que atende o modo **singleplayer**: a
pessoa que usa o Receivy para organizar as próprias contas, não para cobrar
alguém. Independente das duas fatias de notificação; pode ser construída antes,
depois ou em paralelo.

## 1. Objetivo

- Receber por encaminhamento os e-mails de cobrança que a pessoa já recebe hoje
  (luz, condomínio, fatura de cartão, assinatura) e transformá-los em cobrança
  no Receivy.
- Representar no modelo o que essas contas realmente são: **recorrência de valor
  aberto**, mesma conta todo mês, valor diferente.
- Nunca criar lançamento falso. Um e-mail que não casa com regra nenhuma não
  vira nada, nem sugestão.
- Avisar quando a conta **não** chegou, que é o outro lado do valor prometido.

## 2. Escopo

Dentro: `packages/api` (domínio novo `inbox/`, mais `vendors/anthropic/`,
`billings/` e `charges/`), `packages/common` (tipos de regra e de conta de valor
aberto), `packages/web` e `packages/mobile` (tela de regras, caixa de sugestões,
formulário de conta de valor aberto), `docs/`.

### 2.1 Onde cada coisa mora

A estrutura de domínio do repositório resolve isso sem ambiguidade.

| Peça | Lugar |
|---|---|
| Ingestão, regras, extrações | domínio novo `inbox/` com `endpoints`, `repositories`, `schemas`, `services`, `routes.ts`, `provider.ts` |
| Cliente da Anthropic | `vendors/anthropic/{client,types}.ts` |
| Bucket do e-mail cru | `storage.ts`, ao lado do bucket que já existe |
| Endereço de encaminhamento | `users/schemas/user.ts` |
| `amount_source` e materialização | `billings/schemas/billing.ts` e `billings/repositories/billing.ts` |

Fora: OAuth de Gmail ou IMAP, leitura da caixa inteira, extração de comprovante
de pagamento, parser determinístico por emissor, categorização automática,
divisão automática entre participantes a partir do e-mail.

**Dependência nova a aprovar:** `@anthropic-ai/sdk`. Ver §7.3.

## 3. Conta recorrente de valor aberto

### 3.1 O problema

`BillingSchema.total_cents` é obrigatório e fixo, e toda ocorrência resolve o
rateio com `resolveBillingSplit(totalCents, split)`. Conta recorrente de valor
variável simplesmente não existe no modelo de hoje. Esse é o coração da fatia,
não um detalhe de implementação.

### 3.2 A mudança

```ts
/** 'fixed' (padrão e comportamento atual) ou 'email'. */
amount_source?: 'fixed' | 'email';
/** Nulo quando amount_source é 'email' e nenhum e-mail chegou ainda. */
total_cents?: number;
```

E, em `AllocationSchema`:

```ts
/** Nulo enquanto a conta de valor aberto não tem valor: só a regra está decidida. */
amount_cents?: number;
```

Conta de valor aberto nasce **vazia** de propósito. O valor não é estimativa nem
último conhecido: ele não existe até o e-mail chegar, e o schema diz isso. Quem
ler o campo é obrigado a tratar a ausência, em vez de receber um número que
parece verdade.

### 3.3 O que isso custa

Duas colunas perdem `NOT NULL`. No Postgres isso é alteração de metadado: não
reescreve a tabela, não altera linha nenhuma, e o lock é instantâneo. Linhas
existentes continuam com seus valores, e `amount_source` ausente as mantém no
comportamento de hoje.

O custo real não é a migração, são os dezessete pontos que leem `total_cents` na
API, mais os clientes. Eles caem em três grupos:

| Grupo | Regra |
|---|---|
| Exibição (`total`, `amount`, previsões) | Mostra "valor a definir" em vez de número |
| Rateio (`resolveBillingSplit`, `saveAllocations`) | Só roda quando há valor; sem valor, grava a regra com `amount_cents` nulo |
| Escrita (`createBilling`, `patchBilling`) | `total_cents` obrigatório quando `amount_source` é `'fixed'`, proibido de zerar quando já tem valor |

**O convite é o caso que precisa de decisão explícita.** `invites/repositories/invite.ts`
resolve o rateio ao aceitar o convite, e uma conta de valor aberto sem valor não
tem rateio a resolver. Convidar continua permitido: as alocações nascem só com a
regra, e ganham valor no primeiro e-mail. O convidado vê "sua parte: metade da
conta", não um número, porque é isso que se sabe naquele momento.

### 3.4 Ocorrência já criada não se mexe

`charges.amount_cents` é snapshot da ocorrência. Um e-mail novo escreve o valor
da conta e regrava as alocações, e isso alcança só as ocorrências que ainda vão
nascer. Nenhuma cobrança já materializada muda de valor.

### 3.5 A inversão do gatilho

Esta é a consequência real no código de hoje, e é uma linha de `where`.

`materializeDueBillings` (`billings/repositories/billing.ts`) varre toda billing
`indefinite` e `active` na varredura diária das 05:00 UTC, e `dueOccurrences`
decide as datas a partir de `effectiveReminders` e de `processed_through`. Uma
conta de valor aberto varrida assim materializaria a ocorrência do mês com o
total do mês passado, que é pior que não materializar.

Então a varredura passa a pular `amount_source: 'email'`, e quem dispara a
materialização dessas contas é o pipeline de e-mail, que chega com o valor na
mão. `processed_through` continua sendo o marcador de progresso, só que avança
por e-mail aceito e não por data vencida.

## 4. Ingestão

### 4.1 Endereço de encaminhamento

Cada usuário ganha um endereço único e não adivinhável:

```
u_<token de 22 caracteres base64url>@in.receivy.app
```

A pessoa cria uma regra de encaminhamento no próprio provedor de e-mail,
filtrando pelos remetentes que interessam. Nada de OAuth, nada de escopo
restrito do Gmail, nada de auditoria CASA anual. O que ela não encaminhar, a
gente nunca vê, e isso é uma propriedade do desenho, não uma limitação.

O token é rotacionável. Rotacionar invalida o endereço antigo na hora.

### 4.2 Transporte

SES inbound entregando no S3 e notificando por SNS. O repositório já vive na AWS
e já declara bucket em `storage.ts`, então isso não traz provedor novo, só um
bucket a mais e um consumidor.

O consumidor é um handler do domínio `inbox/`, no mesmo formato dos crons que já
existem em `billings/crons/` e `notifications/crons/`.

O e-mail cru vai para o bucket. O banco guarda só o ponteiro, os cabeçalhos que
interessam e o resultado da extração.

## 5. Segurança do canal de entrada

Um endereço de encaminhamento é uma porta aberta para o financeiro de alguém.
Quem descobrir o endereço consegue injetar conta falsa. Três travas, todas
obrigatórias, nenhuma opcional:

| Trava | Regra |
|---|---|
| Endereço | 22 caracteres aleatórios, rotacionável, nunca exibido em URL ou log |
| Autenticação do e-mail | Só aceita mensagem com SPF **e** DKIM válidos. O SES já avalia os dois e entrega o veredito |
| Remetente | Cada regra lista os domínios de remetente que ela aceita. E-mail que não casa com regra nenhuma é descartado |

Um e-mail descartado não vira sugestão, não aparece em tela e não gasta token de
LLM. Ele é contado numa métrica por usuário, para que a pessoa consiga descobrir
que configurou o encaminhamento errado, e nada além disso.

Anexo é tratado como hostil: só PDF, tamanho máximo, e nunca executado nem
renderizado no servidor. O PDF vai inteiro para o modelo, sem passar por
biblioteca de parsing local.

## 6. Regras

Uma regra é o que liga um remetente a um destino e a uma ação.

```ts
export type EmailRule = {
  id: string;
  /** Domínios aceitos, casados no envelope autenticado, nunca no From exibido. */
  senderDomains: string[];
  /** Filtro opcional no assunto, texto simples, sem regex do usuário. */
  subjectContains?: string;
  /** Para onde vai o resultado. */
  target: { kind: 'billing'; billingId: string } | { kind: 'standalone' };
  /** O que fazer com o resultado. */
  action: 'suggest' | 'create';
  /** Quantas extrações seguidas o usuário confirmou sem editar. */
  confirmedStreak: number;
};
```

Dois eixos independentes, e não quatro features: **destino** (alimenta uma conta
existente ou cria avulsa) e **ação** (sugere ou cria). Essa é a forma que cobre
todos os cenários discutidos.

**Nada de regex escrito pelo usuário.** Domínio e trecho de assunto bastam, e
regex de usuário é superfície de erro e de negação de serviço sem ganho real.

## 7. Extração

### 7.1 Contrato

Uma função, uma chamada, saída estruturada:

```ts
export type Extraction = {
  amountCents: number;
  dueDate: string;
  description: string;
  /** 0 a 1, dito pelo próprio modelo e usado só para decidir sugerir vs criar. */
  confidence: number;
};
```

Saída estruturada via `output_config.format`, não texto livre com `JSON.parse`. O
custo escondido de extração não é o token, é a retentativa quando o JSON volta
torto.

### 7.2 Modelo e custo

Preço vigente por milhão de tokens: Haiku 4.5 a US$1 de entrada e US$5 de saída,
Sonnet 5 a US$2 e US$10, Opus 5 a US$5 e US$25.

Uma conta de luz em PDF de duas páginas fica perto de 5 mil tokens de entrada e
150 de saída. Fatura de cartão de seis páginas chega a 15 mil.

| Modelo | Conta simples | Fatura de cartão |
|---|---|---|
| Haiku 4.5 | ~R$ 0,03 | ~R$ 0,09 |
| Sonnet 5 | ~R$ 0,06 | ~R$ 0,17 |
| Opus 5 | ~R$ 0,16 | ~R$ 0,43 |

Dez contas por mês no modelo mais caro dão R$ 4,30 contra mensalidade de
R$ 14,90. No Haiku fica abaixo de um real. **A tabela é estimativa e a spec
carrega um spike de medição com faturas reais**, usando `count_tokens` antes de
gastar.

Dois cortes que valem mais que trocar de modelo:

- **Batch.** O trabalho não é sensível a latência. E-mail que chega às três da
  manhã pode esperar minutos. A Batches API custa metade.
- **Effort baixo.** Extração de campo não precisa de raciocínio profundo.

O modelo é escolhido por variável de ambiente, no padrão de `EMAIL_TRANSPORT` e
`NOTIFICATION_PUSH_TRANSPORT`. Trocar Haiku por Sonnet é mudar variável.

### 7.3 A dependência, e a decisão pendente

Chamar a API da Anthropic pede `@anthropic-ai/sdk`. É dependência nova e precisa
de aprovação antes de qualquer linha.

O que pesa dos dois lados: o SDK dá tipos, saída estruturada validada e
tratamento de erro por classe, e é o caminho recomendado. Por outro lado, **todo
provedor externo deste repositório é chamado com `fetch` cru** — Expo em
`transport.ts`, e a Meta na fatia de WhatsApp seguem esse padrão, com
`AbortSignal.timeout` e mapeamento próprio de erro transiente e permanente.

Recomendo o SDK, porque saída estruturada validada é justamente o que elimina a
retentativa que domina o custo. Se a resposta for não, `fetch` cru funciona e
fica consistente com o resto, ao preço de escrever a validação de schema à mão.

**Nenhuma tarefa começa antes dessa decisão.**

### 7.4 Sem parser por emissor, por enquanto

Um registro de parsers determinísticos por emissor é abstração com zero casos
concretos. Não dá para escrever um parser de um emissor antes de ver dezenas de
e-mails dele, nem para saber se compensa antes de medir. O caminho é LLM em tudo
que passou pelo filtro de remetente, medir custo e acerto por emissor, e escrever
parser só para o emissor que provar ser caro ou instável. Parser nasce de dado.

## 8. Fluxo

1. SES recebe, valida SPF e DKIM, grava o e-mail cru no S3 e notifica.
2. O consumidor resolve o usuário pelo endereço de destino. Endereço
   desconhecido ou rotacionado: descarta.
3. Dedup por `Message-ID`. Repetido: descarta em silêncio.
4. Casa contra as regras do usuário. Nenhuma regra casa: descarta e conta a
   métrica.
5. Extrai corpo e anexo PDF, chama o modelo, guarda a extração.
6. Decide pela ação da regra e pela confiança:
   - `create` e confiança alta: materializa a ocorrência.
   - `suggest`, ou confiança baixa: vira item na caixa de sugestões.
7. Se o destino é uma conta de valor aberto: grava `total_cents`, resolve o
   rateio, regrava as alocações e materializa a ocorrência. Se é avulsa, nasce
   uma conta `once`.

Confiança baixa **sempre** rebaixa para sugestão, mesmo em regra automática. O
limiar é configuração, não constante.

## 9. A regra ganha confiança

A regra nasce em `suggest`. Cada sugestão que o usuário confirma sem editar
valor nem data incrementa `confirmedStreak`. Ao chegar em três, o app oferece
virar automática, e a pessoa aceita ou não. Qualquer edição zera a contagem.

Isso troca a pergunta. Em vez de pedir confiança antes de provar qualquer coisa,
a regra prova primeiro e pede depois.

## 10. A conta que não chegou

Metade do valor prometido é não esquecer. Uma conta de valor aberto que esperava
e-mail e não recebeu é silêncio, e silêncio parece "está tudo certo".

Cada conta de valor aberto guarda o dia típico de chegada, aprendido das
ocorrências anteriores. Passados N dias desse dia sem e-mail aceito, o dono
recebe um aviso pelos canais que a régua da fatia anterior já entrega. O aviso
não cria cobrança nem chuta valor, só diz que a conta de luz costuma chegar dia
5 e hoje é dia 10.

## 11. Dados

| Tabela | Papel |
|---|---|
| `users.inbox_token` | Endereço de encaminhamento, rotacionável |
| `email_rules` | A regra de §6, por usuário |
| `email_messages` | Um por e-mail aceito: ponteiro no S3, `Message-ID`, remetente, veredito de SPF e DKIM, regra casada |
| `email_extractions` | Resultado do modelo, confiança, custo em tokens, estado (`suggested`, `applied`, `discarded`) |
| `billings.amount_source` | `'fixed'` ou `'email'`; em `'email'`, `total_cents` é o valor da próxima ocorrência |

`email_extractions` guarda o custo em tokens de propósito: é como a estimativa de
§7.2 vira número real por emissor, e é o dado que decide se algum dia vale
escrever parser.

## 12. Testes

- **Segurança:** e-mail sem DKIM é descartado; endereço rotacionado não entrega;
  remetente fora da regra não gasta token; anexo que não é PDF é ignorado.
- **Dedup:** mesmo `Message-ID` duas vezes cria uma ocorrência só.
- **Valor aberto:** conta nasce com `total_cents` e `allocation.amount_cents`
  nulos; é pulada por `materializeDueBillings`; materializa quando o e-mail
  chega; o rateio é gravado com o valor extraído; cobrança já materializada
  mantém o próprio `amount_cents`; convite aceito antes do primeiro e-mail grava
  a regra sem valor.
- **Confiança:** confiança abaixo do limiar vira sugestão mesmo em regra `create`.
- **Streak:** três confirmações sem edição oferecem automação; uma edição zera.
- **Vigia:** conta que costuma chegar dia 5 e não chegou até dia 10 gera aviso.
- **Custo:** o spike de medição roda `count_tokens` sobre faturas reais e compara
  com a tabela de §7.2 antes de qualquer chamada paga.

## 13. Fora desta fatia

Parser determinístico por emissor, decidido por dado depois. Detecção de reajuste
("a Netflix subiu 12%"), que fica trivial depois que existe histórico de valor
aberto. Divisão automática entre participantes a partir do e-mail. Leitura de
comprovante de pagamento. Categorização automática.
