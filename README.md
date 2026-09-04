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
pnpm --filter @receivy/api db:up
pnpm dev
```

Em outro terminal, inicie o app mobile:

```bash
pnpm dev:mobile
```

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
exemplo usa `EMAIL_TRANSPORT=disabled`: ele exercita persistência e limitação de
reenvio sem imprimir códigos no terminal. Para entrega real, defina
`EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` e `RESEND_FROM_EMAIL` em um gerenciador
de segredos, além de gerar valores independentes e aleatórios de pelo menos 32
bytes para `AUTH_JWT_SECRET` e `LOGIN_CODE_HASH_KEY`.

O acesso dura 15 minutos. O refresh é opaco, vive por 30 dias, gira a cada uso e
fica armazenado apenas como hash. Reutilizar um refresh já consumido revoga toda
a família daquela sessão.

## Restrição conhecida do Expo 56

O projeto permanece intencionalmente no Expo SDK 56. O `expo-doctor` aprova 21 de
22 verificações e alerta para uma regressão de memória do Hermes V1 incluído nessa
versão. O script `pnpm verify:mobile-sdk` aceita somente essa advertência exata e
falha para qualquer outro problema. A migração para o SDK 57 deve ser uma decisão
explícita, depois de reproduzir os problemas já observados nesse SDK.

## Escopo desta entrega

Esta fundação inclui o núcleo e os endpoints EZ4 do login por código. A interface
passwordless no BFF/web/mobile, provedores sociais, dados financeiros,
comprovantes, Pix, recorrências e notificações entram nos próximos incrementos descritos em
`docs/superpowers/specs/2026-09-04-receivy-mvp-design.md`.

## Verificação da fundação — 2026-09-04

- `pnpm verify`: contrato do workspace, lint, tipos, 5 tarefas de teste e 4 builds
  passaram; o Next compilou e o Expo exportou as rotas web.
- `pnpm --filter @receivy/api db:up`: Postgres 16 iniciou e ficou `healthy`.
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
