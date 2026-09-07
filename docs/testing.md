# Testes do Receivy

## Referência examinada

A pedido do usuário, foram examinados 50 commits sem merge que alteram
`*.spec.ts` no FreightHero/backend, no snapshot `28fce94a`, entre 2026-07-23 e
2026-09-03. O padrão não é um script que sobe toda a aplicação e injeta SQL:

- `node:test` e `node:assert/strict`, em `test/**/*.spec.ts`.
- `DatabaseTester.getClient<Db>('Db')`, inicializado pelo runner `ez4 test --local`.
- Fixtures criadas por clientes/repositórios tipados e removidas em `after`, com
  IDs próprios por cenário e helpers de teste reutilizáveis.
- Chamadas reais a handlers/repositórios e conferência do estado persistido.
- `QueueTester`, `TopicTester`, `CronTester` e `FactoryTester` para controlar serviços externos;
  mocks pontuais para regras que não precisam de banco.
- Banco exclusivo em `testOptions.db.database` e `tsconfig.test.json` incluindo
  código e specs.

O EZ4 0.52.0 instalado também expõe `HttpTester` em `@ez4/local-gateway/test`.
Seu cliente real faz requisições HTTP; nesta versão, o runner de teste inicializa
os emuladores, mas não o listener HTTP. Por isso, o smoke de transporte continua
separado e pequeno. Um cliente mock não serve como prova de autorização/schema.

Exemplos relevantes no histórico:

| Commit | Comportamento exercitado |
| --- | --- |
| `d7502dfe` | Diferenciar criação de reenvio e preservar dados anteriores |
| `4ff7fa97` | Conferir os efeitos em tabelas relacionadas e limpar fixtures |
| `c278d30a` | Reproduzir regressão de handler usando contexto de banco real |
| `8c3415d9` | Validar entrada e consultar as configurações efetivamente persistidas |
| `28fce94a` | Isolar fila/factory e verificar efeitos e falhas de integração |

## Diretriz do Receivy

Specs de integração nativas do EZ4 serão a suíte principal para autenticação,
contatos, despesas, cobranças, recorrências e transições de pagamento. O banco de
teste não pode apontar para o banco normal da aplicação ou para ambientes remotos.
O setup deve falhar em configurações inseguras antes de resetar qualquer dado.

Testes puros já existentes e testes de UI mantêm seus runners apropriados
(Vitest para common/web e Jest para Expo). Não é necessário usar banco para uma
regra pura ou testar o mesmo comportamento repetidamente por vários runners.

Jobs também podem ser exercitados por seus handlers reais, com banco de teste e
relógio determinístico; `CronTester` fica na fronteira do agendamento, não no
lugar da lógica do job. O exemplo de `pre-appointment.spec.ts` do FreightHero
combina `DatabaseTester`, `QueueTester` e `CronTester` desse modo. Assertions
devem conferir os efeitos persistidos e a ausência de duplicação, não apenas se
um mock foi chamado.

Smoke HTTP e navegador continuam úteis para roteamento, validação de transporte,
cookies, headers e fluxo visual, mas não substituem as specs do domínio. Scripts
anteriores de prova local serão migrados quando a cobertura equivalente estiver
validada. O incremento financeiro já usa
`packages/api/test/financial/financial.spec.ts`: oito cenários com banco real,
incluindo acesso por snapshots, concorrência no pagamento, links públicos e
limites de precisão dos resumos. Autenticação e contatos ainda têm migração de
suas provas locais prevista no fechamento do MVP.

Uma resposta correta do repositório não prova o JSON entregue pelo gateway.
No QA de recorrências, o banco continha o valor correto, mas a reflexão de um
tipo `Omit` no contrato de resposta descartou campos antes do HTTP. Por isso,
o gate de transporte também precisa conferir campos e valores, não apenas status
200. Esse teste complementar não deve recriar toda a suíte de regras financeiras.

Comprovantes usam `packages/api/test/proofs/proofs.spec.ts`, combinando
`DatabaseTester` com `BucketTester.getClientMock` para isolar os bytes de teste.
O cliente real de storage do EZ4 escreve em `.ez4/proof-files`, sem isolamento
por stage; por isso, a suíte de domínio não compartilha esse diretório com a
aplicação local. O adaptador fino de teste mantém as verificações de conteúdo,
pagamento e outbox. Testes separados exercitam o servidor HTTP local e as
assinaturas reais do SDK S3 com credenciais fictícias, sem chamar a AWS.

Recorrências acrescentam `packages/api/test/recurrences/recurrences.spec.ts`:
o handler horário real é chamado com fixtures e relógio determinístico. A suíte
confere o banco após replay/concorrência, pausa/retomada, edição e recuperação
limitada de ocorrências atrasadas. As regras puras de calendário continuam em
`packages/common/src/domain/recurrence.test.ts`, sem precisar de Postgres.

Execute `pnpm --filter @receivy/api test:integration` para a suíte nativa,
usando a configuração dedicada de teste. `pnpm verify` cobre os gates de unidade,
componentes, tipos e builds; não substitui essa execução com Postgres.

## Comandos locais

Com Node 24, pnpm e Docker disponíveis, execute a partir da raiz:

```sh
pnpm --filter @receivy/api db:up
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api check-types:test
pnpm verify
```

A suíte nativa usa `test.env.example` e o banco `receivy_tests`, não o banco
`receivy` usado pela aplicação. O runner reseta somente o banco de testes, após
as verificações de segurança do preparo e de configuração. Não substitua a URL
por um ambiente compartilhado ou de produção para executar esses comandos.

`pnpm --filter @receivy/api test:http-smoke` é complementar: usa outro container
descartável, na porta 55435, e encerra esse ambiente ao terminar.

## Smoke iOS em development build

O smoke nativo usa [Maestro](https://maestro.mobile.dev) contra o simulador,
sem exigir permissão de acessibilidade do terminal. Fluxos em
`packages/mobile/e2e/ios-smoke/*.yaml`, na ordem numérica. Pré-requisitos:

1. `packages/api/local.env` com todas as variáveis de `local.env.example` mais o
   bloco `PROOF_*` de `proof-local.env.example` (modo local explícito).
2. Banco local com o schema completo. `ez4 serve --local` não cria tabelas novas
   em um banco existente; na primeira execução após novos módulos rode uma vez
   `node --env-file=local.env ./node_modules/@ez4/project/bin/cli.mjs serve -e local.env --local --reset`
   (apaga o banco descartável `receivy` da porta 55434, nunca outro).
3. `packages/web/.env.local` com `EZ4_API_URL` e `PROOF_UPLOAD_ORIGIN`; API, web e
   `scripts/local-proof-storage.ts` em execução.
4. `packages/mobile/.env.local` copiado do exemplo e
   `RECEIVY_LOCAL_NATIVE=1 npx expo run:ios` para o build de desenvolvimento.

Com `EMAIL_TRANSPORT=disabled` nenhum código é impresso. Para o e-mail fictício,
`node --env-file=local.env scripts/local-login-code.mjs <e-mail>` recupera o
código vigente pelo HMAC do `LOGIN_CODE_HASH_KEY` local; o script recusa qualquer
`APP_STAGE` diferente de `local` ou banco fora do loopback.

Lições registradas em 2026-09-07: o watcher do Metro iniciado por `expo run:ios`
perdeu edições em `packages/common` e `packages/mobile`; após mudar código,
reinicie com `expo start --dev-client --clear`. Componentes de terceiros não
recebem `className` do uniwind sem `withUniwind`; importe `SafeAreaView` de
`@/components/safe-area-view` (regra de lint). O Hermes não implementa
`Intl.NumberFormat#formatToParts`; `formatMoney` tem fallback testado. Upload de
comprovante pelo seletor de arquivos e push real não foram exercitados no
simulador.

Nenhum teste envia e-mail/push real nem acessa contas de produção. Segredos e
arquivos de ambiente dos projetos de referência não fazem parte das fixtures.
