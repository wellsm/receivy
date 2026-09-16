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

O EZ4 0.53.0 instalado também expõe `HttpTester` em `@ez4/local-gateway/test`.
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
validada.

Cobranças usam `packages/api/test/billings/billings.spec.ts`: seis cenários
com banco real cobrindo os três tipos, idempotência por chave, snapshots,
edição só de ocorrências futuras, materialização sem duplicar (índice único
`billing_id:debtor_person_id:due_date`), pausa/retomada e projeção na
timeline. `financial.spec.ts` continua com Pix, pagamento concorrente, links
públicos e limites de precisão. As regras puras ficam em
`packages/common/src/domain/billing-*.test.ts` e `split.test.ts`. Autenticação
e contatos ainda têm migração de suas provas locais prevista no fechamento do
MVP.

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

O job horário que materializa cobranças sem fim é exercitado com fixtures e
relógio determinístico dentro da própria `billings.spec.ts`.

Execute `pnpm --filter @receivy/api test:integration` para a suíte nativa,
usando a configuração dedicada de teste. `pnpm verify` cobre os gates de unidade,
componentes, tipos e builds; não substitui essa execução com Postgres.

## Comandos locais

Com Node 24, pnpm e Docker disponíveis, execute a partir da raiz:

```sh
pnpm --filter @receivy/api docker:up
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api check-types:test
pnpm verify
```

`packages/api` e `packages/common` são formatados e lintados pelo Biome
(`biome.json` na raiz: aspas simples, ponto e vírgula, sem vírgula final, 140
colunas, imports organizados). `pnpm lint` já executa `biome check`; `pnpm format`
aplica a formatação. `web` e `mobile` seguem no ESLint das suas ferramentas.

A suíte nativa usa `test.env.example` e o banco `receivy_tests`, não o banco
`receivy` usado pela aplicação. O runner reseta somente o banco de testes, após
as verificações de segurança do preparo e de configuração. Não substitua a URL
por um ambiente compartilhado ou de produção para executar esses comandos.

`pnpm --filter @receivy/api test:http-smoke` é complementar: usa outro container
descartável, na porta 55435, e encerra esse ambiente ao terminar.

## Smoke nativo em development build (iOS e Android)

O smoke nativo usa [Maestro](https://maestro.mobile.dev) contra simulador ou
emulador, sem exigir permissão de acessibilidade do terminal. Fluxos em
`packages/mobile/e2e/smoke/*.yaml`, na ordem numérica, iguais para as duas
plataformas. Pré-requisitos:

1. `packages/api/local.env` com todas as variáveis de `local.env.example`. Os
   comprovantes usam o bucket `ProofFiles` que o próprio `serve --local` serve em
   `http://localhost:3735/local-receivy-proof-files` (arquivos em `.ez4/proof-files`).
2. Banco local com o schema completo. `ez4 serve --local` não cria tabelas novas
   em um banco existente; na primeira execução após novos módulos rode uma vez
   `node --env-file=local.env ./node_modules/@ez4/project/bin/cli.mjs serve -e local.env --local --reset`
   (apaga o banco descartável `receivy` da porta 55434, nunca outro).
3. `packages/web/.env.local` com `EZ4_API_URL` e `PROOF_UPLOAD_ORIGIN=http://localhost:3735`;
   API e web em execução.
4. `packages/mobile/.env.local` copiado do exemplo e
   `RECEIVY_LOCAL_NATIVE=1 npx expo run:ios` para o build de desenvolvimento.

Com `EMAIL_TRANSPORT=mailpit` (padrão do `local.env.example`) o código chega na
caixa do Mailpit em <http://127.0.0.1:8025>; a mensagem mais recente é o pedido em
curso. Para asserções automatizadas, `createMailpitMailbox()` de
`packages/api/src/vendors/mailpit/mailbox.ts` expõe `clear`, `search`, `waitFor` e `text`
sobre a mesma API REST. Com `EMAIL_TRANSPORT=file` o código vira
`packages/api/.ez4/emails/<data>-seu-codigo-de-acesso-ao-receivy-<id>.eml`. Sem
nenhum dos dois, ou com `disabled`,
`node --env-file=local.env scripts/local-login-code.mjs <e-mail>`
recupera o código vigente pelo HMAC do `LOGIN_CODE_HASH_KEY` local; o script
recusa qualquer `APP_STAGE` diferente de `local` ou banco fora do loopback.

Lições registradas em 2026-09-07: o watcher do Metro iniciado por `expo run:ios`
perdeu edições em `packages/common` e `packages/mobile`; após mudar código,
reinicie com `expo start --dev-client --clear`. Componentes de terceiros não
recebem `className` do uniwind sem `withUniwind`; importe `SafeAreaView` de
`@/components/safe-area-view` (regra de lint). O Hermes não implementa
`Intl.NumberFormat#formatToParts` no iOS e, no Android, rejeita `bigint` nesse
método; `formatMoney` só entrega `Number` ao Intl e tem fallback testado. Upload
de comprovante pelo seletor de arquivos e push real não foram exercitados.

Android: `RECEIVY_LOCAL_NATIVE=1 npx expo run:android` gera o APK de debug; se o
AVD acusar `INSTALL_FAILED_INSUFFICIENT_STORAGE`, use outro AVD com
`disk.dataPartition.size` maior em vez de apagar apps do existente. Faça
`adb reverse` das portas 8081/3735/3000 e abra o dev client com
`receivy://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081`; o
`launchApp` do Maestro abre só o launcher do dev client. Não use `hideKeyboard`:
no Android ele envia Back e fecha o app na tela raiz.

## Contrato e acessibilidade no web

`packages/web/src/lib/openapi-contract.test.ts` confronta `docs/api-oas.yml` com a
allowlist do BFF (`ALLOWED_ROUTES`, exportada só para isso) e com os literais de
caminho dos clientes Expo. Ao adicionar uma rota na API: regenere a OpenAPI
(`pnpm --filter @receivy/api openapi:generate`, gerador `@ez4/docs-gateway`), inclua
a rota na allowlist ou em `DEDICATED_BFF`/`WEB_EXCLUSIONS`, e chame-a no cliente
nativo ou registre o adiamento em `NATIVE_DEFERRED`. O teste falha em qualquer
deriva entre as três superfícies.

`packages/web/src/a11y.test.tsx` roda axe-core sobre as telas principais em jsdom
e exercita teclado; `packages/common/src/design/tokens.test.ts` calcula contraste
WCAG dos tokens. Lacunas conhecidas ficam em `it.fails` com o motivo, e passam a
falhar quando o token for corrigido, obrigando a promoção para `it`.

## Onboarding do nome

`packages/common/src/auth/onboarding.test.ts` fixa a regra `needsOnboarding`.
No Expo, `profile.test.ts` (cache por access token), `profile-guard.test.tsx`
(middleware de rota), `session-gate.test.tsx` (redireciona antes de montar as
abas) e `onboarding-screen.test.tsx` (botão só habilita com nome não vazio)
cobrem o fluxo; no web, `onboarding-form.test.tsx`, o caso de axe em
`a11y.test.tsx` e `proxy.test.ts` (renovação do access cookie, rejeição do
refresh, API indisponível). Em 2026-09-08 o fluxo foi provado de ponta a ponta:
no web com cookies reais contra API e Next locais (`/` → 307 `/onboarding`,
refresh-only cookie → cookies rotacionados e mesmo redirecionamento, PATCH do
nome → `/onboarding` → 307 `/`), e no iOS Simulator com os fluxos Maestro
`01-login` e `02-code` (tela solo sem abas, "Continuar" leva à timeline).

Nenhum teste envia e-mail/push real nem acessa contas de produção. Segredos e
arquivos de ambiente dos projetos de referência não fazem parte das fixtures.
