# Lista de cobranças, cadastro rápido, cotas, categoria e convite — design

Complementa `2026-09-08-billings-and-queues-design.md` (modelo `billings`/`charges`)
e `2026-09-08-profile-and-delivery-policy-design.md` (Perfil, 3 abas, política de
avisos). Sem grupos nesta entrega.

## 1. Objetivo

- Aba **Cobranças** com cards no padrão do Feed: categoria, prazo relativo, badges,
  valor, Compartilhar e Editar; busca e filtros; botão de nova cobrança.
- **Nova cobrança** em uma tela, sem etapa de revisão: contatos recentes no topo,
  valor em destaque, categoria, modalidade, divisão estilo Splitwise (igual, cotas,
  fixo, porcentagem), vencimento rápido, chave Pix entre as cadastradas.
- **Rascunho** preservado ao sair para cadastrar contato ou chave Pix.
- **Cotas** como novo modo de rateio (`2-2-1-1-1-1`).
- **Categoria** persistida na cobrança.
- **Convite** por link: quem aceita vira contato do criador e entra na divisão.

## 2. Escopo

Dentro: `packages/common`, `packages/api`, `packages/web`, `packages/mobile`,
`docs/openapi.json`, Maestro `03-contact-charge.yaml`. Fora: grupos, WhatsApp, voz, foto de contato,
deep link nativo do convite (a página web resolve), edição de valor/rateio em
cobranças finitas (regra de snapshot continua, exceto pelo convite §7).

## 3. Contratos (`@receivy/common`)

```ts
export type BillingCategory = 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
export const BILLING_CATEGORIES: { value: BillingCategory; label: string }[]; // Alimentação, Transporte, Mercado, Assinatura, Empréstimo, Moradia, Viagem, Outro
export type SplitMode = 'fixed' | 'equal' | 'percentage' | 'shares';
export type BillingSplit =
  | { mode: 'equal'; parts: SplitParty[] }
  | { mode: 'percentage'; parts: ({ kind: 'owner'; basisPoints: number } | { kind: 'person'; personId: string; basisPoints: number })[] }
  | { mode: 'fixed'; parts: { kind: 'person'; personId: string; amountCents: number }[] }
  | { mode: 'shares'; parts: ({ kind: 'owner'; shares: number } | { kind: 'person'; personId: string; shares: number })[] };
```

- `shares`: inteiro 1..1000 por parte; distribuição pelo mesmo `distribute`
  (maior resto, empate pelo índice). `resolveBillingSplit` valida.
- `BillingInput.category?: BillingCategory` (padrão `other`), `BillingPatch.category?`.
- `BillingSummary` ganha `category`, `participantCount: number`,
  `proofsPending: number` (comprovantes aguardando revisão nas cobranças da
  billing), `shareChargeId: string | null` (única cobrança pendente quando há um
  só participante; senão nulo), `paidCount: number`, `chargeCount: number`.
  `BillingDetail` ganha `category` e `invite: { url: string; expiresAt: string } | null`.
- `BillingAllocation.shares?: number`.
- `Person` ganha `lastBilledAt: string | null`. `GET /people?sort=recent` ordena
  por `lastBilledAt` desc (nulos por último), depois nome.
- `BillingDraft` (já existe em `billing-draft.ts`) ganha `category`, `mode: 'shares'`
  e `values` reaproveitado para cotas; `buildBillingInput` monta `shares`.
- Helpers novos em `common/src/domain/billing-card.ts`:
  `billingDueLabel(summary, today)` → `'Hoje' | 'Amanhã' | 'Vence em 3 dias' | 'Atrasado 2 dias' | 'Encerrada' | 'Liquidada'`,
  `billingBadges(summary, today)` → `[{ label, tone }]` (tipo: `Única` /
  `Parcela 2 de 4` / `Recorrente mensal|anual`; status: `Aguardando comprovante`,
  `Liquidado`, `Pausada`; `N pessoas`), `billingShareAction(summary)` →
  `'share' | 'open' | null`.
- Convite: `BillingInvite = { url: string; expiresAt: string }`,
  `PublicInviteView = { creditorFirstName: string; description: string; amount: Money; type: BillingType; participantCount: number; category: BillingCategory; expired: boolean }`,
  `InviteAcceptResult = { billingId: string; chargeId: string | null; joinedSplit: boolean }`.

## 4. API

### Billings
- `billings.category` (texto, `other` padrão). `allocations.split_mode` aceita
  `shares`; coluna `shares` (int, nulo). `splitFor` reconstrói `shares`.
- `GET /billings` ganha `search` (ILIKE em `description`, máx. 80 chars) e
  `category`. Ordem inalterada.
- `summary()` calcula `participantCount` (allocations `person`), `chargeCount`,
  `paidCount`, `proofsPending` (`payment_proofs.state = 'pending'` das charges),
  `shareChargeId` (se `participantCount === 1` e há exatamente uma charge
  `pending` com vencimento mais próximo → seu id).
- `POST /billings` aceita `category` e `split.mode = 'shares'`. `PATCH` idem
  (`category` sempre editável; `split` segue regra atual: só `indefinite`).

### People
- `GET /people?sort=recent` — `lastBilledAt` = maior `allocations.created_at`
  da pessoa (subquery). Sem `sort` mantém ordem atual.

### Convite
- Tabela `billing_invites`: `id`, `billing_id` (única ativa por billing),
  `owner_id`, `public_id` (base64url 16 bytes, único), `expires_at` (30 dias),
  `revoked_at`, `accepted_count`, `created_at`. Token = `${publicId}.${exp}.${hmac}`
  reaproveitando `issuePublicChargeToken`/`verifyPublicChargeToken` de
  `public/capability.ts` com propósito `invite` (separação de propósito no HMAC).
- `POST /billings/{id}/invite` (sessão, dono, billing `active`): revoga a ativa
  anterior, cria nova, devolve `{ url: `${WEB_URL}/join/${token}`, expiresAt }`.
  `DELETE /billings/{id}/invite` revoga.
- `GET /public/invites/{token}` (público): `PublicInviteView`; token inválido →
  404; expirado/revogado → `expired: true`.
- `POST /invites/{token}/accept` (sessão): transação com lock na billing:
  1. Token válido, billing `active`, aceitante ≠ dono (409 `INVITE_SELF`).
  2. Contato: `people` do dono com `active_email` = e-mail verificado do
     aceitante → vincula `linked_user_id` se faltava; senão cria
     (`name` = nome do usuário ou parte local do e-mail). Reaproveita `savePerson`.
  3. Divisão: se já participa (allocation `person` com esse `person_id`) →
     `joinedSplit: false`, devolve sua charge pendente mais próxima.
     Modo `fixed`/`percentage` → só contato, `joinedSplit: false`.
     Modo `equal`/`shares` → nova part (`shares: 1`) no fim da ordem; `saveAllocations`.
     - `indefinite`: só allocations (ocorrências futuras usam o novo rateio).
     - `once`/`until`: para cada ocorrência com charges: se alguma charge da
       ocorrência não está `pending` ou tem `payment_proofs` → 409
       `INVITE_SPLIT_LOCKED` ("Divisão já em andamento."). Senão recalcula os
       valores das charges pendentes pelo novo rateio (mesma ordem) e insere a
       charge da pessoa via `persistChargePlan`, com `charge.created` no outbox
       só para a nova. Quantias já enviadas por e-mail ficam desatualizadas:
       aceitável, a página pública lê o valor atual.
  4. `accepted_count++`, auditoria `billings.invite_accepted`, `activity_events`
     `charge.created` para o aceitante quando houver charge.
- Detalhe (`GET /billings/{id}`) devolve `invite` ativo: o token é determinístico
  (`${publicId}.${exp}.${hmac}` a partir de `public_id` + `expires_at` + segredo),
  então o servidor reemite a URL sem armazenar o token.

### Web BFF
Allowlist: `GET billings(?query)` (já), `POST/DELETE billings/{id}/invite`,
`POST invites/{token}/accept`, `GET people(?query)` (já). Rota pública
`/join/[token]` no `proxy.ts` (sem sessão) e `app/api/public/invites/[token]`
não é necessária: a página server-side chama `authApiFetch` como `/pay`.

## 5. Lista de Cobranças (mobile + web)

- Cabeçalho: logo R, "Minhas Cobranças", subtítulo "Cobranças cadastradas e links";
  botões `Buscar` (revela campo "Buscar por título ou descrição…", debounce 300 ms,
  `search` no servidor) e `Filtros` (sheet/painel: Estado `Ativas` (padrão) /
  `Pausadas` / `Encerradas`; Tipo `Todas` / `Única` / `Parcelada` / `Sem fim`;
  Categoria `Todas` + lista). Chips ativos aparecem abaixo do campo.
- Card (`accessibilityLabel="Cobrança <descrição>"`): ícone da categoria,
  descrição (1 linha), prazo relativo à direita (`billingDueLabel`; atrasado em
  vermelho), badges (`billingBadges`), divisor, valor por ocorrência
  (`formatMoney`) com "Vencimento 20/out" (próxima ocorrência; encerrada → "Última
  20/out"), ações: **Compartilhar** (`shareChargeId` → cria/obtém link público e
  abre share nativo / copia no web; sem Pix na cobrança → abre o detalhe da
  charge para publicar; várias pessoas → abre o detalhe da billing) e **Editar**
  (abre o formulário; finitas só liberam categoria, lembretes, Pix e estado).
- FAB `Nova cobrança` (mobile, 56 px, acima da `TabBar`; web: botão primário no
  cabeçalho). Vazio: "Nenhuma cobrança ainda" + botão.
- Detalhe da billing (tela existente) ganha botão **Convidar** e a linha
  "Convite ativo até dd/mm · Copiar/Compartilhar · Revogar".
- Paginação "Carregar mais" mantida.

## 6. Nova cobrança (mobile + web)

Uma tela, rolagem única, rodapé fixo. Cabeçalho "← Voltar" + "Nova cobrança"
(edição: "Editar cobrança").

1. **Para quem?** Carrossel horizontal: `Novo` (círculo tracejado, → cadastro de
   contato com rascunho), contatos recentes (`sort=recent`, até 12, inicial +
   nome + "Ontem"/"3d"/"Sem cobranças"), toque alterna seleção (check verde),
   botão **Ver todos** (sheet/painel com busca `GET /people?search=` e paginação,
   seleção múltipla). Abaixo: toggle "Eu também participo". Mínimo 1 pessoa.
2. **Qual o valor?** Campo hero `R$ 0,00` (teclado numérico, máscara centavos),
   atalhos `+ R$ 10` / `+ R$ 50` / `+ R$ 100`. Rótulo muda para "Valor por
   parcela" no parcelado e "Valor por ocorrência" no sem fim.
3. **Descrição** (obrigatória, ≤ 500) + chips de categoria (uma selecionada;
   `other` padrão; tocar chip com descrição vazia preenche com o rótulo).
4. **Modalidade**: `À vista` (once) · `Parcelado` (until mensal; campo "Parcelas"
   2..120; `endDate` calculado como hoje) · `Sem fim` (indefinite; Mensal/Anual).
5. **Divisão**: segmentado `Igual` · `Cotas` · `Valor fixo` · `Porcentagem`.
   Linha por participante (inicial, nome, campo conforme modo, valor calculado à
   direita). Igual sem campo. Total/resto validado ao vivo ("Faltam R$ 5,00",
   "Soma 110%"). Dono aparece só se "Eu também participo".
6. **Vencimento**: `Hoje` · `Amanhã` · `Em 7 dias` · calendário (input date /
   DateTimePicker nativo). Texto "Lembrete no vencimento" (política padrão).
7. **Pix**: chips das chaves ativas (rótulo + chave abreviada), principal
   pré-selecionada, "Nenhuma" possível, `+ Cadastrar chave` (→ tela de chaves com
   rascunho; volta com a nova selecionada).

Rodapé fixo: resumo ("3 pessoas · R$ 28,33 cada · vence amanhã") e botão
**Criar cobrança** (edição: **Salvar**). Erros inline por etapa. Após criar:
tela de sucesso curta com **Compartilhar link** (1 pessoa) / **Convidar** /
**Ver cobrança** / **Voltar às cobranças**. Retry idempotente mantido.

### Rascunho
- `common/src/domain/billing-draft.ts`: `BillingDraft` serializável (já é
  strings). Store por plataforma: mobile `src/billings/draft-store.ts`
  (memória, mesmo padrão de `pending-login.ts`), web `src/lib/billing-draft.ts`
  (`sessionStorage` chave `receivy.billingDraft`). API: `saveDraft(draft, returnTo)`,
  `takeDraft()` (lê e limpa), `patchDraft({ selected, pix })`.
- Sair para `Novo` contato: `saveDraft`, navega `/people?returnTo=charges/new`
  (web) / `router.push({ pathname: '/people', params: { returnTo: 'new-billing' } })`
  (mobile). A tela de contatos, ao salvar com `returnTo`, faz `patchDraft({ selected: [...selected, id] })`
  e volta (`router.back()` / `router.push(returnTo)`). Idem chaves Pix com `pix`.
- Formulário no mount: `takeDraft()` → restaura estado. Cancelar/Criar limpam.

## 7. Convite (experiência)

- Botão **Convidar** (detalhe e pós-criação): chama `POST /billings/{id}/invite`,
  abre share nativo com "Entre na cobrança *Churrasco* no Receivy: <url>" (web:
  copia e mostra "Link copiado").
- Página pública `/join/[token]` (web, server component como `/pay`): logo,
  "**Lucas** te convidou para", descrição, categoria, valor, "N pessoas", tipo;
  botão **Entrar para participar** → `/login?next=/join/<token>`; expirado →
  "Convite expirado. Peça um novo link."; sessão ativa → botão vira **Participar**
  que chama `POST /api/financial/invites/{token}/accept` e redireciona para
  `/charges/{chargeId}` (payer) ou `/` quando `chargeId` nulo, com aviso
  "Você entrou como contato; o criador ajusta a divisão." quando `joinedSplit` é falso.
- Mobile: link abre no navegador (sem deep link nesta entrega).

## 8. Testes

- common: `shares` (distribuição, validação 1..1000, soma), `buildBillingInput`
  com cotas/categoria, `billingDueLabel`/`billingBadges`, draft store web.
- api: `billings.spec.ts` (categoria, cotas, `search`, `summary` novos campos,
  `people?sort=recent`); novo `invites.spec.ts` (emite/revoga, view pública,
  aceitar: contato criado/vinculado, `indefinite` só allocations, `once` recalcula
  pendentes + nova charge + outbox, 409 quando paga/comprovante, self, expirado,
  idempotente ao aceitar duas vezes).
- web: `billings-screen.test.tsx` (cards, busca, filtros, compartilhar/editar),
  `billing-form.test.tsx` (carrossel, ver todos, categoria, cotas, rascunho ida e
  volta contato/Pix, criar direto), `join/[token]` page test, a11y.
- mobile: equivalentes + `draft-store.test.ts`; Maestro `03` atualizado (fluxo
  novo do formulário) e verde.

## 9. Decisões

- Criar direto, sem revisão: resumo ao vivo no rodapé.
- Convite recalcula pendentes em cobranças finitas; recusa se algo já foi pago.
- Cotas em vez de "divisão sugerida": mais simples digitar 2 do que 25%.
- Rascunho em memória no mobile: basta sobreviver à navegação interna.
- Categoria fixa (8) com ícone; sem categoria livre.
- Recentes por última cobrança (allocation), não por último acesso.
