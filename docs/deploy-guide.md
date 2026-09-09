# Deploy do Receivy (dev e prd)

Como subir a API (`packages/api`) na AWS via EZ4 em dois stages, publicar o web
(`packages/web`) no domínio de cada ambiente e apontar o mobile. O EZ4 provisiona
Lambda (arm64, Node 24), API Gateway, o bucket privado `ProofFiles`, os quatro
crons e o state remoto em S3; o Postgres fica fora (Neon). Os domínios estão em
`docs/environments.md`: `https://receivy.wellsm.dev` no dev, o domínio real na prd.

Ordem na primeira vez, sem pular etapa, porque cada uma produz um valor que a
seguinte consome:

```
1 AWS → 2 Postgres → 3 segredos → 4 dev.env mínimo → 5 deploy:dev (URL da API + bucket)
→ 6 Resend → 7 web publicado (WEB_APP_URL) → 8 Google/Apple (precisam do web)
→ 9 redeploy da API com provedores → 10 mobile/EAS → 11 verificação → 12 prd
```

Convenções: nada de segredo em arquivo versionado; `dev.env`, `prd.env`,
`local-dev.env` e `.env.local` são git-ignored. Segredos de dev e prd são
sempre diferentes. Cada valor abaixo diz **de onde vem**.

## 1. Credenciais AWS

O EZ4 lê chave de acesso das variáveis de ambiente (o `node --env-file` dos
scripts carrega o `dev.env`/`prd.env`), não um perfil do `~/.aws`.

1. Console AWS → IAM → Users → Create user: `receivy-deploy`, sem acesso ao console.
2. Permissions → Attach policies directly → `AdministratorAccess` (o EZ4 cria
   Lambda, API Gateway, S3, IAM roles, EventBridge e CloudWatch; restringir dá
   atrito sem ganho num projeto próprio).
3. Security credentials → Create access key → Command Line Interface.
4. Copie `Access key ID` e `Secret access key` (aparecem uma vez) para
   `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY`.
5. `AWS_REGION`: uma só para tudo. `sa-east-1` tem menor latência para o Brasil;
   `us-east-1` é mais barata. O pacote vendorizado `@ez4/aws-common` já contém a
   correção do state remoto fora de `us-east-1` (`docs/ez4-vendor-patches.md`),
   então `sa-east-1` é seguro.

## 2. Postgres gerenciado (um por stage)

Neon, um projeto com dois branches:

1. [neon.tech](https://neon.tech) → New Project → mesma região da AWS → o branch
   `main` é a **prd**.
2. Branches → New branch `dev`.
3. Em cada branch, Connection string (formato
   `postgresql://user:senha@host/db?sslmode=require`) → `EZ4_RAW_PG_DB_URL` do
   respectivo env.

Neon suspende o compute sem atividade; o `NotificationCron` roda a cada 5
minutos (`cron(0/5 * * * ? *)`) e toca o banco, então o compute fica acordado
sem depender de tráfego. Os demais crons são horários (`BillingCron` no minuto
0, `StorageCron` no minuto 15). `GET /health` não toca o banco e não serve como
sonda.

## 3. Segredos gerados localmente

Gere um valor **por stage** e nunca reutilize entre dev e prd:

```bash
openssl rand -base64 32   # AUTH_JWT_SECRET
openssl rand -base64 32   # LOGIN_CODE_HASH_KEY
openssl rand -base64 32   # PUBLIC_LINK_HMAC_SECRET
```

O login Apple não guarda nenhum token do provedor: só o `id_token` é validado
para criar/ligar a identidade, então não há chave de cifragem a gerar aqui.

## 4. `dev.env` mínimo

```bash
cd packages/api
cp dev.env.example dev.env
```

Preencha agora só o que já existe: AWS (passo 1), `EZ4_RAW_PG_DB_URL` (passo 2),
os três segredos (passo 3), `PUBLIC_WEB_ORIGIN=https://receivy.wellsm.dev` e
`OAUTH_REDIRECT_ALLOW_LIST=https://receivy.wellsm.dev/auth/oauth/callback,receivy://auth/callback`.
Deixe `OAUTH_PROVIDERS_CONFIG_B64=disabled`, `EMAIL_TRANSPORT=disabled`,
`NOTIFICATION_EMAIL_TRANSPORT=disabled`, `NOTIFICATION_PUSH_TRANSPORT=disabled`
e `PROOF_STORAGE_MODE=disabled` neste primeiro deploy: são ativados nos passos
seguintes, quando os valores existirem.

## 5. Primeiro `deploy:dev`

```bash
cd packages/api
pnpm deploy:dev
```

O comando compila (`tsc --noEmit`) e sobe o stage. Anote da saída:

| Saída do EZ4 | Vai para |
| --- | --- |
| URL do API Gateway, `https://<id>.execute-api.<região>.amazonaws.com/dev-receivy-api` | `EZ4_API_URL` (web) e `EXPO_PUBLIC_EZ4_API_URL` (mobile) |
| Nome do bucket `ProofFiles` (`dev-receivy-proof-files-<sufixo>`) | `PROOF_S3_BUCKET` (API) |

`pnpm output:dev` reimprime esses valores. O state fica em S3
(`stateFile.remote`), não em arquivo local; mesmo assim, não rode dois deploys
do mesmo stage em paralelo.

Complete o `dev.env` com `PROOF_STORAGE_MODE=s3` e `PROOF_S3_BUCKET=<nome exato>`
e rode `pnpm deploy:dev` de novo. O validador recusa nome ausente ou de outro
projeto. O bucket é privado, sem expiração global; a única lifecycle rule
permitida é em `temporary/` (`docs/proof-storage.md`).

Verifique: `curl https://<url-da-api>/health` responde 200.

## 6. Resend

Domínio de envio verificado por stage. Passos detalhados em
`docs/environments.md`; resumo:

1. Resend → Domains → `receivy.wellsm.dev` (prd: o domínio real).
2. Cloudflare, registros sem proxy: DKIM (`resend._domainkey`), MX + SPF em
   `send.<domínio>`, DMARC `p=none`.
3. API key restrita a envio e ao domínio → `RESEND_API_KEY`.
4. `RESEND_FROM_EMAIL=Receivy <login@receivy.wellsm.dev>`,
   `EMAIL_TRANSPORT=resend`, `NOTIFICATION_EMAIL_TRANSPORT=resend`.
5. `pnpm deploy:dev` e teste `POST /auth/email/code` com um endereço seu; o
   e-mail deve chegar com DKIM/SPF `pass`.

## 7. Web publicado

A imagem `packages/web/Dockerfile` (Next standalone, porta 3000, usuário sem
privilégio) roda em qualquer host de containers; na Vercel o build é nativo e os
mesmos nomes vão em Project → Settings → Environment Variables. Em ambos os
casos as variáveis são de **runtime do servidor**, nunca argumentos de build.

| Variável | De onde vem |
| --- | --- |
| `EZ4_API_URL` | URL do API Gateway do passo 5 |
| `WEB_APP_URL` | `https://receivy.wellsm.dev` (origem pública do próprio web; obrigatória atrás de proxy) |
| `PROOF_UPLOAD_ORIGIN` | `https://<PROOF_S3_BUCKET>.s3.<AWS_REGION>.amazonaws.com` (o presign usa URL virtual-hosted) |
| `NEXT_PUBLIC_OPERATOR_CONTACT` | e-mail de contato exibido nas páginas legais |

DNS: registro do host `receivy.wellsm.dev` apontando para o provedor do web,
com TLS válido (o TLD `.dev` exige HTTPS). Verifique
`https://receivy.wellsm.dev/api/health` (200 com a API no ar) e a página
`/login`.

Se o web for a Vercel, os cabeçalhos de origem já chegam corretos; num container
atrás de proxy próprio, `WEB_APP_URL` é o que faz o CSRF por Origin, o destino
do OAuth e os redirects usarem o domínio público.

## 8. Google e Apple (dependem do web)

Os provedores chamam o web, que repassa à API (`docs/oauth-setup.md`).

**Google** ([console.cloud.google.com](https://console.cloud.google.com) →
APIs & Services → Credentials → OAuth client ID → Web application):

- Authorized redirect URI: `https://receivy.wellsm.dev/api/auth/google/callback`
  (prd: mesmo caminho no domínio real; podem coexistir no mesmo cliente).
- Copie `Client ID` e `Client secret`.

**Apple** ([developer.apple.com](https://developer.apple.com/account/resources/identifiers/list),
conta paga):

1. Identifiers → App ID do app (bundle `RECEIVY_IOS_BUNDLE_IDENTIFIER`) com a
   capability Sign in with Apple.
2. Identifiers → Services ID (ex.: `dev.wellsm.receivy.web`) → Configure Sign in
   with Apple → Primary App ID = o App ID acima; Domains and Subdomains =
   `receivy.wellsm.dev`; Return URLs =
   `https://receivy.wellsm.dev/api/auth/apple/callback`. Esse identificador é
   `apple.clientId`; o bundle do app é `apple.nativeClientId`.
3. Keys → Create key → Sign in with Apple → baixe o `.p8` (uma vez). `keyId`
   está na tela; `teamId` no canto superior direito da conta.
4. `privateKeyBase64`: `base64 -i AuthKey_XXXX.p8 | tr -d '\n'`.
5. Se for usar Private Email Relay, More → Configure Sign in with Apple → Email
   Sources → domínio e remetente do Resend.

Monte o JSON e codifique em base64url (sem `=`):

```bash
cat > /tmp/oauth.json <<'EOF'
{
  "google": { "clientId": "...", "clientSecret": "...",
              "callbackUri": "https://receivy.wellsm.dev/api/auth/google/callback" },
  "apple":  { "clientId": "dev.wellsm.receivy.web", "nativeClientId": "<bundle id>",
              "callbackUri": "https://receivy.wellsm.dev/api/auth/apple/callback",
              "keyId": "...", "teamId": "...", "privateKeyBase64": "..." }
}
EOF
node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync("/tmp/oauth.json","utf8")).toString("base64url"))'
rm /tmp/oauth.json
```

O resultado é `OAUTH_PROVIDERS_CONFIG_B64`. Omita o provedor que ainda não
existe em vez de deixar campos vazios; o botão correspondente fica indisponível.

## 9. Redeploy da API com provedores

`pnpm deploy:dev`. Teste no navegador em `https://receivy.wellsm.dev/login`:
Google e Apple devem voltar para a timeline. Erro `invalid_redirect_uri` ou
`redirect_uri_mismatch` significa URL diferente byte a byte entre console e
`callbackUri`.

## 10. Mobile e EAS

Identificadores nativos são do proprietário; o build local usa
`dev.receivy.local` só com `RECEIVY_LOCAL_NATIVE=1`.

1. `RECEIVY_IOS_BUNDLE_IDENTIFIER` e `RECEIVY_ANDROID_APPLICATION_ID`: escolha
   (ex.: `dev.wellsm.receivy`), registre o App ID na Apple (passo 8) e o pacote
   no Google Play Console quando for distribuir.
2. `npx eas init` em `packages/mobile` grava `extra.eas.projectId` no
   `app.json`; sem ele o registro de push falha de propósito.
3. Push: Expo → Project → Credentials: APNs key (Apple → Keys → Apple Push
   Notifications) e FCM (Firebase → Cloud Messaging). Expo → Account → Access
   tokens → `EXPO_ACCESS_TOKEN`; na API, `NOTIFICATION_PUSH_TRANSPORT=expo` e
   redeploy.
4. Variáveis do build (perfil em `eas.json` ou `.env.local` para development
   build): `EXPO_PUBLIC_EZ4_API_URL=<URL da API dev>`,
   `EXPO_PUBLIC_WEB_URL=https://receivy.wellsm.dev`,
   `EXPO_PUBLIC_OPERATOR_CONTACT`. Nada de segredo em `EXPO_PUBLIC_*`.
5. `RECEIVY_LOCAL_NATIVE=1 npx expo run:ios|android` contra a API dev, depois
   `eas build --profile development`.

## 11. Verificação do dev

Na ordem, cada item marca uma linha em `docs/mvp-acceptance.md`:

1. `curl <api>/health` 200; `https://receivy.wellsm.dev/api/health` 200.
2. Login por e-mail com código real (Resend).
3. Login Google e Apple pelo web; Apple nativo no development build.
4. Criar contato, cobrança, publicar link, abrir `/pay/<token>` anônimo, copiar Pix.
5. Enviar comprovante (upload direto ao S3 pela origem `PROOF_UPLOAD_ORIGIN`),
   revisar como credor.
6. Recorrência e materialização horária (aguardar o cron ou ajustar a hora).
7. Push num aparelho físico; e-mail de aviso inicial.
8. Exportação e exclusão de conta.
9. `packages/mobile/e2e/smoke` contra o dev com Maestro.

## 12. Produção

Repita 2 a 11 com `prd.env` (`cp dev.env.example prd.env` e troque tudo),
Neon branch `main`, domínio real, Resend no domínio real, Return URLs de prd nos
mesmos clientes OAuth, `pnpm deploy:prd`. Antes do primeiro deploy, adicione o
domínio real às listas estáticas de CORS em `packages/api/src/api.ts` e
`packages/api/src/storage.ts`. Não existe `destroy` de prd por script; derrubar
produção é `ez4 destroy` manual e consciente.

## Filas e DLQ

O EZ4 nomeia todo recurso como `<prefix>-<projectName>-<serviço em kebab-case>`
(`prefix` é o `APP_STAGE` e `projectName` é `receivy`, ambos em
`packages/api/ez4.project.js`). A DLQ de cada fila recebe o sufixo
`-deadletter`. No stage `dev`:

| Serviço             | Fila SQS                       | DLQ                                       |
| ------------------- | ------------------------------ | ----------------------------------------- |
| `NotificationQueue` | `dev-receivy-notification-queue` | `dev-receivy-notification-queue-deadletter` |
| `BillingQueue`      | `dev-receivy-billing-queue`      | `dev-receivy-billing-queue-deadletter`      |
| `StorageQueue`      | `dev-receivy-storage-queue`      | `dev-receivy-storage-queue-deadletter`      |

Em `prd` troque o prefixo por `prd`. As três filas usam `maxAttempts: 5` e
retenção de 20160 minutos (14 dias), com backoff de 5s a 300s.

Crie um alarme no CloudWatch sobre
`AWS/SQS → ApproximateNumberOfMessagesVisible` de **cada DLQ**, com limiar
`>= 1` por 5 minutos (estatística `Maximum`) e uma ação de notificação. Uma DLQ
não vazia é sempre trabalho perdido: aviso não entregue, ocorrência não
materializada ou arquivo não apagado.

`NotificationCron` roda a cada 5 minutos e, além de reenfileirar entregas
pendentes, mantém o compute do Neon acordado — ver o passo 2.

## Migração 2026-09-09

Antes do deploy:

```sql
ALTER TABLE notification_deliveries ALTER COLUMN event_id TYPE varchar(200);
```

O EZ4 não encurta nem alarga colunas existentes; sem esse `ALTER` as chaves de
evento novas estouram o tamanho antigo.

A coluna `billings.category` é obrigatória no schema (`schemas/billing.ts`), então
o EZ4 emite `NOT NULL` e a sincronização falha em tabela povoada. Crie e preencha a
coluna antes do deploy:

```sql
ALTER TABLE billings ADD COLUMN IF NOT EXISTS category text;
UPDATE billings SET category = 'other' WHERE category IS NULL;
ALTER TABLE billings ALTER COLUMN category SET DEFAULT 'other';
```

O alargamento do check de `template` em `notification_deliveries` não pede passo
manual: o EZ4 recria as constraints `_ck` no deploy.

Depois do deploy, com a versão nova estável, estas tabelas ficam sem nenhum
leitor e podem ser derrubadas:

```sql
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS storage_deletions;
DROP TABLE IF EXISTS storage_cleanup_cursors;
DROP TABLE IF EXISTS apple_credentials;
```

`apple_credentials` some junto com `APPLE_CREDENTIAL_ENCRYPTION_KEY_B64`: o
login Apple passa a validar só o `id_token` e nenhum refresh token do provedor é
guardado. Remova a variável dos envs de dev e prd depois do deploy.

## Manutenção

- Schema: o EZ4 aplica tabelas/colunas novas no deploy; coluna obrigatória em
  tabela povoada trava a migração, então declare opcional com default. No local,
  recrie o banco com `serve --local --reset` (`docs/testing.md`).
- Trocar domínio: `PUBLIC_WEB_ORIGIN`, `OAUTH_REDIRECT_ALLOW_LIST`,
  `callbackUri` dos provedores, CORS estático, `WEB_APP_URL`,
  `EXPO_PUBLIC_WEB_URL`, consoles Google/Apple e Resend. Redeploy da API e do web.
- Rotação de segredos: `AUTH_JWT_SECRET` derruba todas as sessões;
  `LOGIN_CODE_HASH_KEY` invalida códigos pendentes; `PUBLIC_LINK_HMAC_SECRET`
  invalida todos os links públicos (rotacionar links depois).
- Rodar a API local contra o banco dev: `pnpm serve:dev` carrega `dev.env` e,
  se existir, `local-dev.env` por cima (por exemplo `OAUTH_REDIRECT_ALLOW_LIST`
  com `localhost`, que nunca deve ir para a AWS).
- Logs: CloudWatch, retenção de 30 dias, sem corpos nem segredos por desenho
  (`src/security/listener.ts`).

## Custos

Lambda, API Gateway, S3 e EventBridge têm free tier generoso; um projeto
pessoal com dois stages fica perto de zero. Neon free tier suspende sem uso.
Resend free tier cobre 3 mil e-mails/mês. Apple Developer Program é USD 99/ano.
