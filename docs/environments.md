# Ambientes

Três ambientes, mesma topologia: a API é um stage EZ4 na AWS (Lambda + API
Gateway + S3), o web é o Next em um domínio próprio e serve de base para tudo
que exige HTTPS verificável (callbacks OAuth, links públicos, cookies Secure), e o
mobile fala com a API diretamente e abre o web para links públicos.

| | Local | Dev | Produção |
| --- | --- | --- | --- |
| Web | `http://localhost:3000` | `https://receivy.wellsm.dev` | `https://<domínio real>` |
| API | `http://127.0.0.1:3735/local-receivy-api` | `https://<id>.execute-api.<região>.amazonaws.com/dev-receivy-api` | stage `prd` (URL do `pnpm output:prd` ou domínio próprio) |
| Postgres | Docker `receivy-pg` (55434) | instância gerenciada do stage | instância gerenciada do stage |
| E-mail | `mailpit`: caixa em <http://127.0.0.1:8025> (`file` grava `.eml` em `packages/api/.ez4/emails/`) | Resend, remetente `@receivy.wellsm.dev` | Resend, remetente no domínio real |
| Comprovantes | adaptador local explícito | bucket `ProofFiles` do stage | bucket `ProofFiles` do stage |
| Push | `disabled` | `disabled` até haver projeto Expo/APNs/FCM | idem |
| Links de pagamento | `fake` | InfinitePay + PagBank (`sandbox`) | InfinitePay + PagBank (`live`) |

`wellsm.dev` é um domínio pessoal compartilhado por vários apps em dev; cada app
usa um subdomínio (`receivy.wellsm.dev`). O TLD `.dev` está na lista de HSTS
pré-carregada: os navegadores forçam HTTPS, o que é exatamente o que os fluxos
de autenticação exigem. Em produção o domínio é o real do produto.

## Variáveis por superfície

API (`packages/api/dev.env.example` → `dev.env`, git-ignored; `prd.env` análogo):

- `PUBLIC_WEB_ORIGIN`: origem do web do stage. Alimenta links públicos e deep links.
- `AUTH_ACCESS_TOKEN_TTL_SECONDS`: vida do access token em segundos. Uma semana no local
  (`604800`), um dia no dev (`86400`) e 15 minutos em produção (`900`, o padrão quando ausente).
  O refresh token continua igual; só muda com que frequência o cliente renova.
- `OAUTH_REDIRECT_ALLOW_LIST`: `<web>/auth/oauth/callback,receivy://auth/callback`.
- `GOOGLE_SIGNIN_ENABLED` / `APPLE_SIGNIN_ENABLED`: `true` liga o login social correspondente;
  qualquer outro valor (padrão `false`) o mantém desligado mesmo com credenciais configuradas.
  Desligado, a API não anuncia nem aceita o provedor e web/mobile escondem o botão; com os dois
  desligados o login mostra só o e-mail.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
  `APPLE_PRIVATE_KEY_B64` e o opcional `APPLE_NATIVE_CLIENT_ID`. Chave faltando (ou `disabled`)
  mantém o provedor desligado. Os callbacks saem de `PUBLIC_WEB_ORIGIN` como
  `<web>/api/auth/<provedor>/callback` (ver `docs/oauth-setup.md`).
- `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. O mesmo
  `EMAIL_TRANSPORT` vale para código de login e para notificações.
- Links de pagamento (InfinitePay, PagBank): `PAYMENT_METHOD_LINK=live` fala com os dois
  provedores de verdade (a InfinitePay não tem sandbox própria, então `live` e `sandbox`
  dão nela no mesmo host); `sandbox` fala com o host de sandbox do PagBank; `fake`
  responde em processo e aponta o link para `/dev/checkout/<provider>/<id>` do web; `disabled`
  (padrão quando ausente) falha todo link com `PAYMENT_LINK_UNAVAILABLE`. `fake` no
  local/test, `sandbox` no dev, `live` em produção.
- `PAYMENT_CREDENTIAL_KEY_B64`: chave AES-256-GCM (32 bytes em base64) que sela o token do
  PagBank antes de gravar em `integrations.credentials`. Gerar com
  `openssl rand -base64 32`. `disabled` (padrão quando ausente) responde
  `PAYMENT_CREDENTIAL_KEY_MISSING` a qualquer tentativa de conectar uma conta PagBank.
  Trocar a chave invalida toda credencial já selada: cada conta PagBank precisa ser
  reconectada (novo token) depois da rotação.
- `PUBLIC_API_ORIGIN`: origem pública da API, base do `webhook_url` que a API manda
  à InfinitePay. No local vale `http://127.0.0.1:3735/local-receivy-api`, que a
  InfinitePay não alcança — localmente é o retorno do pagador e o transporte
  `fake` que fecham a cobrança.
- CORS da API e do bucket são declarações estáticas do EZ4 (`src/api.ts`,
  `src/storage.ts`): incluem `localhost:3000` e `receivy.wellsm.dev`; adicionar o
  domínio real antes do primeiro deploy de produção.

Web (`packages/web/.env.example`): `EZ4_API_URL` (API do stage), `WEB_APP_URL`
(origem pública do próprio web; obrigatória atrás de proxy/container),
`PROOF_UPLOAD_ORIGIN` (origem S3 de upload do stage), `NEXT_PUBLIC_OPERATOR_CONTACT`.

Mobile (`packages/mobile/.env.example` → `.env.local` ou variáveis do perfil EAS):
`EXPO_PUBLIC_EZ4_API_URL` (API do stage), `EXPO_PUBLIC_WEB_URL` (web do stage).

## Resend no domínio de dev

O Resend só envia de domínio verificado; `EMAIL_TRANSPORT=disabled` esconde isso
localmente. Passos, uma vez, no painel do Resend e na zona Cloudflare de
`wellsm.dev` (o DNS do domínio já está na Cloudflare):

1. Resend → Domains → Add domain → `receivy.wellsm.dev`, região mais próxima dos
   destinatários (`sa-east-1` para o Brasil, se disponível para a conta).
2. Criar na Cloudflare, **sem proxy (nuvem cinza)**, exatamente os registros que
   o Resend mostrar: TXT de DKIM em `resend._domainkey.receivy.wellsm.dev`, MX e
   TXT (SPF) no subdomínio de retorno `send.receivy.wellsm.dev`, e opcionalmente
   TXT `_dmarc.receivy.wellsm.dev` com `v=DMARC1; p=none;` para começar. Os
   valores são gerados pelo Resend por domínio e não devem ser copiados de outro
   app.
3. Aguardar a verificação, criar uma API key **restrita a envio e a esse
   domínio** e colocar em `dev.env`: `RESEND_API_KEY`,
   `RESEND_FROM_EMAIL=Receivy <login@receivy.wellsm.dev>`.
4. Testar com `POST /auth/email/code` no stage dev contra um endereço próprio e
   conferir DKIM/SPF `pass` nos cabeçalhos recebidos.
5. Para Sign in with Apple com Private Email Relay, cadastrar esse mesmo
   domínio/remetente em Apple Developer → Sign in with Apple → Email Sources
   (`docs/oauth-setup.md`).

Produção repete o processo no domínio real; a chave e o domínio de dev nunca
entram em `prd.env`. Nenhum valor de DNS, chave ou segredo pertence ao repositório.

## Ordem de ativação do dev

O passo a passo completo, com a origem de cada variável, está em
`docs/deploy-guide.md`; este resumo mostra só as dependências entre etapas.

1. `pnpm --filter @receivy/api deploy:dev` com `dev.env` completo (o EZ4 imprime a
   URL do API Gateway e os nomes dos buckets; `pnpm output:dev` repete).
2. Publicar o web (imagem `packages/web/Dockerfile`) em `receivy.wellsm.dev` com
   `EZ4_API_URL`, `WEB_APP_URL=https://receivy.wellsm.dev` e `PROOF_UPLOAD_ORIGIN`.
3. Google Cloud → cliente OAuth web → redirect URI
   `https://receivy.wellsm.dev/api/auth/google/callback`; Apple → Services ID →
   domínio `receivy.wellsm.dev` e Return URL
   `https://receivy.wellsm.dev/api/auth/apple/callback`. Preencher as variáveis
   `GOOGLE_*` / `APPLE_*`, ligar a flag de cada provedor e redeploy da API.
4. Resend conforme a seção anterior; `EMAIL_TRANSPORT=resend` e redeploy.
5. Development build apontando `EXPO_PUBLIC_EZ4_API_URL` para a API dev e
   `EXPO_PUBLIC_WEB_URL=https://receivy.wellsm.dev`; rodar os fluxos de
   `packages/mobile/e2e/smoke` e o login Google/Apple real.

Cada item acima é um gate externo em `docs/mvp-acceptance.md` até ser executado.
