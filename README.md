# Receivy

Receivy organiza, em uma única timeline, cobranças que você criou e valores a
pagar vinculados ao seu e-mail. Este repositório contém a fundação do MVP: shell
responsivo web, BFF Next, API EZ4, app Expo e contratos compartilhados.

## Estrutura

- `packages/web`: Next.js responsivo e BFF; o navegador não acessa a API EZ4 diretamente.
- `packages/api`: backend EZ4 em Node.js 24.
- `packages/mobile`: Expo SDK 56, Expo Router e Uniwind.
- `packages/common`: contratos, regras puras e tokens visuais portáveis.

## Pré-requisitos

- Node.js 24 e Corepack.
- Docker Desktop para o Postgres local e para construir a imagem web.
- Xcode 26.4 ou superior para builds iOS do Expo SDK 56.
- Android Studio para builds Android.
- Um simulador ou dispositivo de desenvolvimento confiável. O fluxo nativo usa
  development build, não depende do Expo Go.

## Primeira execução

```bash
corepack enable
corepack prepare pnpm@11.5.3 --activate
pnpm install
cp packages/api/local.env.example packages/api/local.env
pnpm dev
```

`ez4 serve --local` não cria tabelas novas em um banco `receivy` já existente.
Se o banco local for anterior a um módulo novo, rode uma vez
`node --env-file=local.env ./node_modules/@ez4/project/bin/cli.mjs serve -e local.env --local --reset`
em `packages/api`; isso apaga apenas o banco descartável da porta 55434.

Para testar à mão com dados variados, rode o seed com o seu e-mail (a API local
precisa ter criado as tabelas antes):

```bash
pnpm --filter @receivy/api seed:local voce@example.com
```

Ele cria 8 contatos (com e sem app, sem e-mail, arquivado), chaves Pix de todos
os tipos e 15 contas espalhadas por meses passados, atual e futuros: parceladas,
assinaturas mensal/anual/fim de mês, pausada, encerrada, contas a pagar com e sem
Pix, cobranças atrasadas, pagas, canceladas e com comprovante pendente, aceito ou
recusado. Rodar de novo recria só o que o seed criou. `--dry-run` executa tudo e
desfaz no fim. Para ver o lado de quem paga, entre como
`rafa.duarte@seed.receivy.test` ou `marina.alves@seed.receivy.test`.

Em outro terminal, inicie o app mobile:

```bash
cp packages/mobile/.env.example packages/mobile/.env.local
pnpm dev:mobile
```

No Android Emulator, troque o host da API móvel por `10.0.2.2`. Em aparelho
físico, use o endereço LAN alcançável da máquina de desenvolvimento; nunca
coloque segredos em variáveis `EXPO_PUBLIC_*`.

Para validar tudo localmente:

```bash
pnpm verify
docker build -f packages/web/Dockerfile -t receivy-web:foundation .
```

## Endereços locais

| Serviço | Endereço |
| --- | --- |
| Web | `http://127.0.0.1:3000` |
| API EZ4 | `http://127.0.0.1:3735/local-receivy-api` |
| Health da API | `http://127.0.0.1:3735/local-receivy-api/health` |
| Health via BFF | `http://127.0.0.1:3000/api/health` |
| Postgres | `127.0.0.1:55434` |

Defina `EZ4_API_URL=http://127.0.0.1:3735/local-receivy-api` apenas no ambiente
de execução do servidor Next. Nenhum segredo de API entra no bundle do navegador
ou como argumento de build da imagem.

## Autenticação local

O backend já expõe o núcleo passwordless em `/auth/email/code`,
`/auth/email/confirm`, `/auth/refresh`, `/auth/logout` e `/auth/me`. O arquivo de
exemplo usa `EMAIL_TRANSPORT=mailpit`: cada e-mail (código de login, avisos e
lembretes) vai para o Mailpit do `docker-compose.yml`, e a caixa fica em
<http://127.0.0.1:8025>. Abra a mensagem mais recente para pegar o código. Sem
Docker, `EMAIL_TRANSPORT=file` grava cada mensagem como `.eml` em
`packages/api/.ez4/emails/`. `mailpit` e `file` são recusados fora de
`APP_STAGE=local` ou `test`; `disabled` descarta tudo em silêncio. Para
entrega real, defina `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` e
`RESEND_FROM_EMAIL` em um gerenciador de segredos, além de gerar valores
independentes e aleatórios de pelo menos 32 bytes para `AUTH_JWT_SECRET` e
`LOGIN_CODE_HASH_KEY`. A escolha do provedor fica em
`packages/api/src/common/services/email/service.ts` (Factory EZ4 com um vendor por transporte).

O acesso dura 15 minutos. O refresh é opaco, vive por 30 dias, gira a cada uso e
fica armazenado apenas como hash. Reutilizar um refresh já consumido revoga toda
a família daquela sessão.

Depois do login, uma conta sem nome cai na tela solo "Como podemos chamar você?"
(`/onboarding` no web e no Expo) e só segue para o app após salvar um nome não
vazio. A regra `needsOnboarding` vive em `@receivy/common`; no web ela roda no
layout servidor do grupo `app/(protected)` (o `proxy.ts` renova o access cookie
antes, como no Rewarlo) e no Expo em `ProfileGuard` + `SessionGate`, que
consultam `auth/me` uma vez por access token.

## Restrição conhecida do Expo 56

O projeto permanece intencionalmente no Expo SDK 56. O `expo-doctor` aprova 21 de
22 verificações e alerta para uma regressão de memória do Hermes V1 incluído nessa
versão. O script `pnpm verify:mobile-sdk` aceita somente essa advertência exata e
falha para qualquer outro problema. A migração para o SDK 57 deve ser uma decisão
explícita, depois de reproduzir os problemas já observados nesse SDK.

## Escopo desta entrega

Estão implementados o login por e-mail/código na API, BFF/web e Expo, e a
integração OAuth Google/Apple com validação OIDC e retorno vinculado ao cliente.
Ativação e testes reais de Google/Apple dependem das credenciais e callbacks
configurados conforme [configuração OAuth](docs/oauth-setup.md).
Deploy dos stages `dev` e `prd` na AWS, ordem das etapas e origem de cada
variável: [guia de deploy](docs/deploy-guide.md) e [ambientes](docs/environments.md).
Envelope de erro, códigos de domínio e cotas: [erros da API](docs/api-errors.md); a OpenAPI
gerada fica em `docs/api-oas.yml` (`pnpm --filter @receivy/api openapi:generate`).

Glossário: uma **conta** (`billings`) é o cadastro dono do valor, do tipo
("À vista", "Parcelado" ou "Assinatura") e das pessoas; uma **cobrança**
(`charges`) é cada pessoa × vencimento, com estado pendente/pago/cancelado,
comprovantes e pagamento. O valor da conta é por ocorrência; os tipos finitos
geram todas as cobranças na criação e a assinatura é materializada pelo job
horário na janela do primeiro lembrete. A aba "Contas" lista uma linha por
conta; o Feed mostra cada cobrança. Uma conta pode ser **a receber** (o dono
cobra contatos, Pix da carteira) ou **a pagar** (`direction = 'payable'`: o
dono paga, credor opcional em `payee_person_id`, chave Pix digitada na conta;
o credor com conta vê a cobrança como "a receber" e só confirma o pagamento;
lembretes vão por push ao próprio dono).

Pessoas: um **usuário** (`users`) é a identidade, único por e-mail, com `status`
`pending` (criado por um contato ou por um login sem onboarding), `active` (fez o
onboarding) ou `removed`. Um **contato** (`contacts`) é só o vínculo da agenda de um
dono com um usuário mais o apelido; cadastrar um contato busca ou cria o usuário pelo
e-mail. Enquanto o usuário está `pending`, qualquer agenda que o tenha edita nome e
e-mail; depois de `active`, só o apelido. Cobranças apontam para `users.id`
(`charges.debtor_user_id`); nome e e-mail são lidos ao vivo, só o Pix é snapshot. Rotas: `POST/GET /billings`,
`GET /billings/{id}`, `GET /billings/{id}/preview`, `PATCH /billings/{id}`
(edição e estado no mesmo corpo).

## Verificação da fundação — 2026-09-04

- `pnpm verify`: contrato do workspace, lint, tipos, 5 tarefas de teste e 4 builds
  passaram; o Next compilou e o Expo exportou as rotas web.
- `pnpm --filter @receivy/api docker:up`: Postgres 16 iniciou e ficou `healthy`.
- API EZ4 e BFF retornaram `200` com
  `{"status":"ok","service":"receivy-api"}`. Como a porta 3000 já estava em
  uso, a prova do BFF foi executada em `http://127.0.0.1:3001/api/health`.
- Shell web inspecionado em 390, 768 e 1440 px, sem overflow horizontal, com foco
  de teclado visível e ação principal de 48 × 48 px.
- Shell Expo inspecionado em 390 × 844 e validado por teste de componente,
  typecheck, lint e `expo export --platform web`.
- O build nativo em simulador/dispositivo ainda não foi executado neste host.
- `docker build -f packages/web/Dockerfile -t receivy-web:foundation .` não chegou
  a avaliar o Dockerfile: o helper `osxkeychain` do Docker/OrbStack bloqueou o pull
  público de `node:24-slim`. O mesmo build permanece obrigatório no CI limpo.
