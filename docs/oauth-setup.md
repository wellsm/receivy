# Login Google e Apple

O Receivy oferece Google, Apple e e-mail com código, sem senha. O código OAuth
está integrado à API EZ4, ao BFF Next e ao navegador de autenticação do Expo.
Os botões consultam `GET /auth/oauth/providers` e ficam indisponíveis enquanto
as credenciais do respectivo provedor estiverem ausentes.

## Configuração

`OAUTH_PROVIDERS_CONFIG_B64` contém JSON codificado em base64url. Base64 não é
criptografia: essa variável é um segredo de backend, nunca `NEXT_PUBLIC_*` ou
`EXPO_PUBLIC_*`. O valor `disabled` é uma opção de desligamento, não uma credencial.
Não reutilizar as credenciais dos projetos de referência.

Formato do objeto (omitir completamente o provedor ainda não configurado):

```ts
type Config = {
  google?: {
    clientId: string;
    clientSecret: string;
    callbackUri: string;
  };
  apple?: {
    clientId: string; // Services ID do Receivy
    callbackUri: string;
    keyId: string;
    teamId: string;
    privateKeyBase64: string; // arquivo .p8 codificado em base64
  };
};
```

### A base dos callbacks é o Next

Os provedores nunca chamam a API Gateway diretamente. A Apple exige uma Return
URL em domínio verificável por HTTPS e a URL crua do API Gateway não serve; por
isso, como no Rewarlo, quem tem domínio é o web e o callback cai no Next, que
repassa à API e devolve o 302 dela ao navegador:

```
Google/Apple → https://<web>/api/auth/{google,apple}/callback
            → (ponte fina em packages/web/src/lib/auth/provider-callback.ts)
            → ${EZ4_API_URL}/auth/{google,apple}/callback
            → 302 para um destino de OAUTH_REDIRECT_ALLOW_LIST
            → o Next relê o 302 como 303 e o navegador segue para
              https://<web>/auth/oauth/callback (web) ou receivy://auth/callback (app)
```

A ponte não lê nem grava cookies, encaminha a query (Google) ou o corpo
`form_post` (Apple, limite de 32 KB) sem alterá-los e transforma qualquer
resposta que não seja redirect em `/login?error=oauth`, sem expor corpo da API
ou do provedor. Em local `next dev`, a mesma ponte funciona em
`http://localhost:3000/api/auth/google/callback` (Google aceita localhost; Apple
não).

`callbackUri` de cada provedor é, portanto, a URL do **web**:

| Ambiente | Google `callbackUri` / redirect URI | Apple `callbackUri` / Return URL |
| --- | --- | --- |
| Local | `http://localhost:3000/api/auth/google/callback` | não suportado |
| Dev | `https://receivy.wellsm.dev/api/auth/google/callback` | `https://receivy.wellsm.dev/api/auth/apple/callback` |
| Produção | `https://<domínio real>/api/auth/google/callback` | `https://<domínio real>/api/auth/apple/callback` |

Google usa um cliente OAuth de aplicação web porque a troca de código acontece
na API. Apple usa Services ID associado ao App ID com Sign in with Apple
habilitado; em **Domains and Subdomains** cadastrar o domínio do web (por exemplo
`receivy.wellsm.dev`) e em **Return URLs** a URL da tabela, byte a byte. O mesmo
Services ID aceita as Return URLs de dev e de produção. O handler recebe
`application/x-www-form-urlencoded` (`form_post`). A API gera o client secret
ES256 com cinco minutos de validade a partir da chave .p8.

`OAUTH_REDIRECT_ALLOW_LIST` é uma lista separada por vírgulas, com comparação
exata. Ela autoriza os destinos Receivy após o callback dos provedores:

| Cliente | Destino |
| --- | --- |
| Web local | `http://localhost:3000/auth/oauth/callback` |
| Web dev | `https://receivy.wellsm.dev/auth/oauth/callback` |
| Expo development build | `receivy://auth/callback` |
| Web publicado | Origem HTTPS efetiva do web + `/auth/oauth/callback` |

O destino que o web envia à API vem de `WEB_APP_URL` (`packages/web/.env.example`).
Atrás de proxy ou container a origem derivada do request é o bind interno, então
sem essa variável o destino não bateria com a allowlist e a checagem de Origin
das mutações recusaria o próprio navegador. Em `next dev` local ela pode ficar
vazia. O `EZ4_API_URL` do Next e o `EXPO_PUBLIC_EZ4_API_URL` do mobile devem
apontar para a API desse mesmo ambiente; `PUBLIC_WEB_ORIGIN` da API e
`EXPO_PUBLIC_WEB_URL` do app apontam para o web. Cookies web são Secure; usar
HTTPS fora de localhost. O mobile usa navegador do sistema e scheme `receivy`,
portanto validar em development build iOS/Android, não no Expo Go. Se o
processo do app encerrar durante a autenticação, reiniciar o login: o segredo
efêmero não é persistido. A matriz completa por ambiente está em
`docs/environments.md`.

## Segurança do fluxo

- Tentativa de dez minutos, state e nonce independentes, state armazenado como hash.
- Google: PKCE S256 também na troca com o provedor. Apple: code/confidential
  client + state/nonce; não presumimos suporte Apple a parâmetros PKCE.
- Ambos: grant Receivy de dois minutos ligado ao desafio S256 do cliente. Só o
  cliente que conserva o verifier pode trocá-lo. Verifier em cookie HttpOnly no
  web e memória no mobile. Consumo sob lock transacional, com rejeição de replay.
- Access/refresh tokens nunca passam na URL. Callback web remove o código por
  redirect, define `no-store` e `no-referrer` e grava cookies HttpOnly/Secure.
- Tokens OIDC têm assinatura verificada com JWKS dos endpoints fixos, além de
  issuer, audience/azp, validade, nonce e e-mail verificado. Nome da Apple é
  persistido quando recebido no primeiro consentimento.
- Identidades existentes são localizadas por provider + subject. Para associar
  uma identidade nova a uma conta existente, Google precisa ser autoritativo
  pelo endereço (Gmail ou Workspace `hd`). E-mail externo de conta Google pode
  exigir entrar por código. Apple Relay é um endereço separado; não fundir contas.
- Configurar logs do proxy/ingress para omitir querystrings e corpos das rotas
  de autenticação. Não registrar respostas de token ou conteúdo das variáveis.

## Apple Private Email Relay

No Apple Developer, cadastrar o domínio/endereço remetente utilizado pelo Resend
em Sign in with Apple → Email Sources. Configurar SPF/DKIM no domínio e verificar
a entrega para um endereço relay antes da ativação. Não substituir um relay por
outro e-mail nem presumir que os dois pertencem à mesma conta.

## Validação

`pnpm verify` cobre tipos, lint, testes, Next build e Expo export. O teste
`node scripts/verify-oauth-local.mjs`, com API local e `receivy-pg` em execução,
verifica troca com verifier incorreto (401), troca válida (200) e replay (401).
Cria um usuário/grant isolado e remove apenas essas fixtures e suas sessões.

Ainda requer validação com credenciais reais: consentimento Google/Apple,
callback HTTPS Apple, primeiro nome/relay, cancelamento, development builds
iOS/Android e entrega de e-mail relay. Testes locais não comprovam esses fluxos.

Fontes: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[verificação Google e autoridade sobre e-mail](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[verificação Apple](https://developer.apple.com/documentation/signinwithapple/verifying-a-user),
[ambiente Apple](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple).
