# Links públicos curtos e página pública da conta — design

Duas entregas que compartilham o mesmo mecanismo. A primeira é uma página pública
no nível da **conta**, feita para ser colada em grupo: ela lista os participantes
e cada pessoa clica na sua própria cobrança. A segunda troca o endereçamento
público do projeto por um **slug curto**, aplicado às três páginas públicas que
existem: cobrança, conta e convite.

## 1. Objetivo

- Um link só para o grupo. Hoje o credor precisa mandar um link individual para
  cada participante, e esses links só chegam por e-mail.
- Aposentar o token de 77 caracteres. Ele é colado em WhatsApp e ocupa três
  linhas na tela do celular.
- Um lugar único para expirar e bloquear qualquer link público.

## 2. Escopo

Dentro: `packages/api` (`public/`, `invites/`, `charges/`, `billings/`,
`database.ts`), `packages/common` (tipos da visão pública), `packages/web` (três
rotas públicas), `packages/mobile` (compartilhamento e revogação na tela da
conta), `docs/`.

Fora: autenticar quem clica, controle de acesso por pessoa, mudança na revisão
de comprovante, métrica de acesso por link, slug apelidado escolhido pelo
credor.

### 2.1 Onde cada coisa mora

| Peça | Lugar |
|---|---|
| Tabela e geração do slug | `public/schemas/short-link.ts`, `public/services/short-link.ts` |
| Resolução por slug | `public/repositories/short-link.ts` |
| Visão pública da conta | `public/repositories/public-billing.ts` |
| Endpoints públicos | `public/endpoints/{charge,billing,invite}.ts` |
| Publicar, rotacionar e revogar o link da conta | `public/endpoints/{create,rotate,revoke}-billing-link.ts` |
| Tipos da visão | `packages/common/src/domain/contracts.ts` |
| Telas públicas | `packages/web/src/app/{p,b,j}/[slug]/page.tsx` |

## 3. Decisões já tomadas

Registradas no brainstorming que originou esta spec.

| Questão | Decisão |
|---|---|
| O que a página da conta expõe | Primeiro nome e valor de cada participante. Clicar abre a página da cobrança, com chave Pix e envio de comprovante |
| Endereço da página da conta | Handle próprio, não o do convite |
| Escopo da lista | Uma linha por participante, com a pendente de vencimento mais próximo |
| Formato da URL | Tabela de short links, slug de 10 caracteres |
| Caminho de resolução | O slug é o único endereço público; o HMAC é aposentado |
| Convite | Entra também |

### 3.1 Risco aceito

Quem tem o link do grupo abre a cobrança de qualquer participante e pode enviar
comprovante no lugar dele. O credor revisa antes de valer, então o efeito é
ruído na revisão, não pagamento indevido. O dono da conta aceitou esse vetor.

A contrapartida de produto é a recomendação de chave aleatória, em §7.

## 4. O slug

### 4.1 Tabela

```ts
export interface ShortLinkSchema extends Database.Schema {
  /** 10 caracteres base62. É a credencial: 59,5 bits de entropia. */
  slug: String.Max<10>;
  kind: 'charge' | 'billing' | 'invite';
  /** id da charge, da billing ou do billing_invite. */
  target_id: String.UUID;
  expires_at: String.DateTime;
  revoked_at?: String.DateTime;
  created_at: String.DateTime;
}
```

```ts
Database.UseTable<{
  name: 'short_links';
  schema: ShortLinkSchema;
  indexes: { slug: Index.Primary; 'kind:target_id': Index.Secondary };
}>
```

O índice secundário serve à leitura "qual é o link vivo deste alvo", que é o que
a tela da conta e o compositor de e-mail precisam. A unicidade do link vivo por
alvo é garantida pela escrita, não pelo índice: publicar revoga o anterior na
mesma transação.

### 4.2 Geração

Base62 sobre `randomBytes`, com **amostragem por rejeição**: 256 não é múltiplo
de 62, então o resto direto enviesa os primeiros 8 símbolos do alfabeto. Byte
maior ou igual a 248 é descartado e sorteado de novo.

Colisão resolve por tentativa: insere, e em violação de unicidade sorteia outro
slug, até três vezes. Na quarta, erro. Com 59,5 bits a terceira tentativa é
folclore, mas o caminho existe porque a alternativa é uma inserção que falha em
silêncio.

### 4.3 Prazos

| Tipo | Hoje | Novo |
|---|---|---|
| Cobrança | 90 dias | 30 dias |
| Conta | não existe | 30 dias |
| Convite | 30 dias | 14 dias |

Abrir a página não estende nada. O credor rotaciona, que gera slug novo e mata o
anterior, ou revoga.

Além do prazo, a resolução recusa o que o alvo já resolveria: conta fora de
`active`, cobrança fora de `pending`, convite revogado.

### 4.4 O que sai

`charges.public_id`, `charges.link_version`, `charges.link_expires_at` e
`charges.link_revoked_at` param de existir: prazo e revogação passam a morar na
linha de `short_links`. `billing_invites.public_id` e `billing_invites.expires_at`
seguem o mesmo caminho, e `billing_invites.revoked_at` fica, porque também marca
convite substituído por outro.

`issuePublicChargeToken` e `verifyPublicChargeToken` são removidos junto com
`PUBLIC_LINK_HMAC_SECRET`. Com o slug sendo a credencial, assinar não protege de
nada: quem tem o slug tem o acesso, e o segredo passa a ser só mais uma variável
de ambiente para vazar.

`linkAlive(row, nowSeconds)` vira `liveSlug(db, kind, targetId, now)`, que
devolve a linha de `short_links` ou nada. O caminho de aviso em
`notifications/services/send.ts` chama isso em vez de ler colunas da charge.

## 5. A página pública da conta

### 5.1 Roster

A lista nasce das **alocações**, não das cobranças. `allocations` é a lista
canônica de participantes da conta, é pequena e já tem ordem
(`allocation_order`). Partir das cobranças perderia quem ainda não tem cobrança
gerada e exigiria agrupar por devedor em memória.

Para cada alocação de `kind = 'user'`, uma linha:

```ts
export type PublicBillingRow = {
  firstName: string;
  amount: Money;
  dueDate: string;
  state: ChargeState | 'none';
  /** Ausente quando não há cobrança aberta com link vivo. */
  slug?: string;
};

export type PublicBillingView =
  | { expired: true }
  | {
      expired: false;
      creditorFirstName: string;
      description: string;
      category: BillingCategory;
      total: Money;
      rows: PublicBillingRow[];
    };
```

A cobrança escolhida por participante é a pendente de menor `due_date`. Sem
pendente, a liquidada mais recente, com `state` `paid` ou `cancelled` e sem
`slug`.

Sem cobrança nenhuma, `state: 'none'`, `dueDate` da próxima ocorrência da conta e
`amount` vindo de `resolveBillingSplit(total_cents, split)`, o mesmo cálculo que
a prévia do convite e o formulário já usam. Esse caso aparece em conta recorrente
cuja próxima ocorrência ainda não foi materializada.

### 5.2 De onde vem o slug de cada linha

A resolução **não escreve**. Um GET público que emite link é um vetor de escrita
sem autenticação e um problema de concorrência.

Então: publicar o link da conta emite, na mesma transação, o slug da conta e o
slug de cada cobrança pendente que ainda não tem um. Depois disso, ocorrência
nova ganha slug pelo caminho que já existe, porque o aviso de cobrança publica o
link antes de mandar. Uma linha sem `slug` na lista aparece como "link ainda não
disponível", sem virar botão.

### 5.3 Recusas

- Conta `payable` não tem participante para listar: 404.
- Conta fora de `active`: `{ expired: true }`, como o convite já faz.
- Slug de outro tipo na rota da conta: 404.

## 6. Endpoints e rotas

### 6.1 API

| Rota | O que faz |
|---|---|
| `GET /public/charges/{slug}` | Visão da cobrança. Substitui `GET /public/charges/{token}` |
| `GET /public/billings/{slug}` | Lista da conta. Nova |
| `GET /public/invites/{slug}` | Prévia do convite. Mesma rota de hoje, `GET /public/invites/{token}`, com o parâmetro trocado |
| `POST /invites/{slug}/accept` | Aceite. Mesma rota de hoje, com o parâmetro trocado |
| `POST /billings/{id}/public-link` | Publica. Emite o slug da conta e os das pendentes sem slug |
| `POST /billings/{id}/public-link/rotate` | Slug novo, anterior morre |
| `DELETE /billings/{id}/public-link` | Revoga |

As três de escrita espelham o que `charges/{id}/public-link` já oferece, com o
mesmo autorizador de sessão e a mesma regra de dono.

### 6.2 Web

| Antes | Depois |
|---|---|
| `/pay/[token]` | `/p/[slug]` |
| `/join/[token]` | `/j/[slug]` |
| não existe | `/b/[slug]` |

`https://receivy.app/p/a7Bx9qK2mZ` tem 34 caracteres, contra 101 do formato de
hoje.

Três prefixos em vez de um `/l/[slug]` que despacha: cada página é uma tela
diferente, o Next precisa da separação de rota mesmo, e o 404 de slug trocado de
tipo sai de graça.

### 6.3 Links já enviados

Os tokens longos que saíram por e-mail param de resolver. O projeto está antes do
lançamento, então a recomendação é o corte limpo: remover as rotas antigas junto.

**Esta é a única questão aberta da spec.** Se você preferir janela de transição,
o custo é manter `resolvePublicCharge` por token e as rotas `/pay` e `/join` por
um prazo, mais o segredo `PUBLIC_LINK_HMAC_SECRET` que §4.4 remove. São dois caminhos
de resolução convivendo, e o segredo continua em produção só para honrar links
antigos.

## 7. Recomendação de chave aleatória

Item pequeno e deliberadamente pequeno. Ao escolher a chave Pix no momento de
publicar um link público, o formulário passa a ordenar as chaves aleatórias
primeiro e a explicar em uma linha por que elas são preferíveis quando a conta é
compartilhada com gente fora da agenda.

Nada é bloqueado. Publicar com CPF ou telefone continua possível.

Fora deste item: gerar chave aleatória pelo Receivy, o que dependeria de
integração bancária que não existe.

## 8. Testes

Unidade, em `packages/api`:

- Geração do slug: 10 caracteres, alfabeto correto, e distribuição sem viés de
  módulo sobre amostra grande.
- Resolução: slug desconhecido, revogado, expirado e de tipo trocado, todos 404
  e indistinguíveis entre si.
- Roster: pendente mais próxima por participante; participante liquidado sem
  `slug`; participante sem cobrança com `state: 'none'`; ordem por
  `allocation_order`.
- Publicar o link da conta emite slug para as pendentes sem slug e não toca nas
  que já têm.

Integração, em `packages/api/test`: publicar, abrir pela rota pública,
rotacionar, confirmar que o slug anterior morreu, revogar, confirmar 404.

Web: as três telas públicas, incluindo a lista com um participante liquidado e
um sem link.

## 9. Migration

Você roda. Em duas etapas, para existir janela de volta atrás.

Primeira, aditiva:

```sql
CREATE TABLE IF NOT EXISTS short_links (
  slug varchar(10) PRIMARY KEY,
  kind text NOT NULL,
  target_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS short_links_kind_target ON short_links (kind, target_id);
```

Mais o backfill: para cada charge com link vivo e cada convite vivo, uma linha
em `short_links` com slug novo. Script em `packages/api/scripts/`, não SQL puro,
porque o slug precisa da geração de §4.2.

Segunda, depois que a primeira estiver de pé:

```sql
ALTER TABLE charges DROP COLUMN IF EXISTS public_id;
ALTER TABLE charges DROP COLUMN IF EXISTS link_version;
ALTER TABLE charges DROP COLUMN IF EXISTS link_expires_at;
ALTER TABLE charges DROP COLUMN IF EXISTS link_revoked_at;
ALTER TABLE billing_invites DROP COLUMN IF EXISTS public_id;
ALTER TABLE billing_invites DROP COLUMN IF EXISTS expires_at;
```

## 10. Ordem de construção

1. Tabela, geração e resolução do slug, com os testes de unidade.
2. Migration aditiva e script de backfill.
3. Cobrança e convite passam a resolver por slug; rotas `/p` e `/j` no web.
4. Visão pública da conta, endpoints de publicar, rotacionar e revogar, rota
   `/b`.
5. Compartilhamento e revogação do link da conta nas telas de conta, web e
   mobile.
6. E-mails e texto de compartilhamento passam a carregar a URL curta.
7. Recomendação de chave aleatória.
8. Migration de remoção das colunas.

Os passos 3 e 4 são independentes entre si e podem sair em paralelo.
