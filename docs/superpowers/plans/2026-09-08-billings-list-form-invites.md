# Lista de cobranças, cadastro rápido, cotas, categoria e convite — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba Cobranças com cards, busca e filtros; formulário de nova cobrança em uma tela com contatos recentes, categoria, cotas, rascunho e Pix; convite por link que torna a pessoa contato e participante.

**Architecture:** `common` concentra contratos, rateio por cotas, categoria, helpers de card e o rascunho serializável. A API ganha `category`, `shares`, campos de resumo, `people?sort=recent` e o módulo `invites` (tabela + tokens HMAC + aceite transacional). Web e mobile reescrevem `billings-screen` e `billing-form` sobre esses contratos, com um store de rascunho por plataforma e telas de contato/Pix que devolvem o item criado.

**Tech Stack:** EZ4 0.52 + Postgres (specs `node:test` via `DatabaseTester`, `pnpm --filter @receivy/api test:integration`), vitest (common/web), jest + RNTL (mobile), Next 16, Expo SDK 56 + expo-router + uniwind, Biome/eslint.

**Spec:** `docs/superpowers/specs/2026-09-08-billings-list-form-invites-design.md`

## Global Constraints

- Sem dependência nova. Sem migração: banco local recriado. Nunca commitar env files; nunca logar tokens/códigos.
- Código, identificadores, comentários e commits em inglês; UI em pt-BR com os textos da spec §5–§7 verbatim.
- Cada task roda lint + typecheck + testes do pacote (API também `test:integration`) antes do commit. Commits Conventional Commits, trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_016BY3v9hkgmh7emjR6A5gG2`.
- EZ4 0.52: tipos de resposta com campos explícitos (sem `Omit`/interseção); unions de schema explícitas.
- Cotas: inteiro 1..1000 por parte; distribuição por maior resto (mesmo `distribute`). Categoria: 8 valores fixos, padrão `other`. Convite: 30 dias, 1 ativo por billing, token `${publicId}.${exp}.${hmac}` com propósito `invite`.
- Regra de snapshot de cobranças finitas continua; única exceção é o aceite do convite (§4 da spec).
- Estilo: early returns, linhas em branco entre blocos, um elemento JSX por linha, nada de componentes em uma linha (referência `packages/mobile/src/components/profile-screen.tsx`).
- Rótulos de acessibilidade: cards `Cobrança <descrição>`, botões `Compartilhar`, `Editar`, `Nova cobrança`, `Buscar`, `Filtros`, `Ver todos`, `Novo contato`, `Cadastrar chave`, `Criar cobrança`, `Salvar`, `Convidar`, `Participar`, `Entrar para participar`, `Eu também participo`, campos `Valor`, `Descrição`, `Parcelas`, `Vencimento`, `Buscar contatos`.

---

### Task 1: Common — categoria, cotas, helpers de card, rascunho, contratos de convite

**Files:**
- Modify: `packages/common/src/domain/contracts.ts` (`SplitMode`, `Person`, `PublicInviteView`, `InviteAcceptResult`, `BillingInvite`)
- Modify: `packages/common/src/domain/split.ts`, `packages/common/src/domain/billing.ts`, `packages/common/src/domain/billing-draft.ts`, `packages/common/src/domain/people.ts`
- Create: `packages/common/src/domain/billing-category.ts`, `packages/common/src/domain/billing-card.ts`
- Modify: `packages/common/src/index.ts` (exportar os dois novos)
- Test: `packages/common/src/domain/split.test.ts`, `billing-draft.test.ts` (criar se não existir), `billing-card.test.ts`

**Interfaces (Produces):**
```ts
export type BillingCategory = 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
export const BILLING_CATEGORIES: { value: BillingCategory; label: string }[] = [
  { value: 'food', label: 'Alimentação' }, { value: 'transport', label: 'Transporte' }, { value: 'groceries', label: 'Mercado' },
  { value: 'subscription', label: 'Assinatura' }, { value: 'loan', label: 'Empréstimo' }, { value: 'housing', label: 'Moradia' },
  { value: 'travel', label: 'Viagem' }, { value: 'other', label: 'Outro' }
];
export function billingCategoryLabel(category: BillingCategory): string;
export function isBillingCategory(value: unknown): value is BillingCategory;

export type SplitMode = 'fixed' | 'equal' | 'percentage' | 'shares';
// split.ts: nova arm `{ mode: 'shares'; parts: ({ kind: 'owner'; shares: number } | { kind: 'person'; personId: string; shares: number })[] }`
// resolveAmounts: shares → cada `shares` inteiro 1..1000 senão RangeError('Informe cotas inteiras de 1 a 1000.'); distribute(total, shares)

// billing.ts
BillingInput.category?: BillingCategory; BillingPatch.category?: BillingCategory;
BillingSummary: + category: BillingCategory; participantCount: number; chargeCount: number; paidCount: number; proofsPending: number; shareChargeId: string | null;
BillingDetail: + invite: BillingInvite | null;
BillingAllocation: + shares?: number;
export type BillingInvite = { url: string; expiresAt: string };
export type PublicInviteView = { creditorFirstName: string; description: string; amount: Money; type: BillingType; participantCount: number; category: BillingCategory; expired: boolean };
export type InviteAcceptResult = { billingId: string; chargeId: string | null; joinedSplit: boolean };

// people.ts
Person: + lastBilledAt: string | null;

// billing-draft.ts
BillingDraft: + category: BillingCategory; mode inclui 'shares'; `values` guarda cotas como string ("2")
export const EMPTY_BILLING_DRAFT: (timezone: string, today: string) => BillingDraft; // type 'once', owner true, mode 'equal', category 'other', start today, reminders [{ offsetDays: '0', enabled: true }]
buildBillingInput: shares → parts.map(party => ({ ...party, shares: integer(values[key] || '1', 'Informe cotas inteiras de 1 a 1000.') })); category passa direto.

// billing-card.ts
export type BillingBadge = { label: string; tone: BadgeTone };
export function billingDueLabel(billing: BillingSummary, today: string): string;
// state 'ended' → paidCount === chargeCount && chargeCount > 0 ? 'Liquidada' : 'Encerrada'; sem nextDueDate → 'Sem data'; diff = days(nextDueDate - today):
// diff < 0 → `Atrasado ${-diff} dia(s)`; 0 → 'Hoje'; 1 → 'Amanhã'; else `Vence em ${diff} dias`
export function billingBadges(billing: BillingSummary, today: string): BillingBadge[];
// tipo: once → 'Única' (neutral); until → `Parcela ${paidCount + 1} de ${installmentCount}` (info) quando paidCount < installmentCount senão `${installmentCount} parcelas`; indefinite → `Recorrente ${frequency === 'yearly' ? 'anual' : 'mensal'}` (info)
// status: state 'paused' → 'Pausada' (neutral); proofsPending > 0 → 'Aguardando comprovante' (info); state 'ended' && paidCount === chargeCount → 'Liquidado' (success)
// pessoas: `${participantCount} pessoa(s)` (neutral)
export function billingShareAction(billing: BillingSummary): 'share' | 'open' | null;
// state 'ended' → null; shareChargeId → 'share'; senão 'open'
export function billingSummaryLine(input: { people: number; amountCents: number; mode: SplitMode; dueLabel: string }): string;
// `${people} pessoa(s) · ${mode === 'equal' ? `${formatMoney} cada` : formatMoney total} · vence ${dueLabel.toLowerCase()}`
```

- [ ] **Step 1: Testes (RED)**

```ts
// split.test.ts (append)
it('splits by shares with largest remainder', () => {
  const parts = [
    { kind: 'person' as const, personId: 'a', shares: 2 }, { kind: 'person' as const, personId: 'b', shares: 2 },
    { kind: 'person' as const, personId: 'c', shares: 1 }, { kind: 'person' as const, personId: 'd', shares: 1 },
    { kind: 'person' as const, personId: 'e', shares: 1 }, { kind: 'person' as const, personId: 'f', shares: 1 }
  ];
  expect(resolveBillingSplit(80_000, { mode: 'shares', parts }).map((p) => p.amountCents)).toEqual([20_000, 20_000, 10_000, 10_000, 10_000, 10_000]);
  expect(resolveBillingSplit(100, { mode: 'shares', parts: parts.slice(0, 3) }).map((p) => p.amountCents)).toEqual([40, 40, 20]);
  expect(() => resolveBillingSplit(100, { mode: 'shares', parts: [{ kind: 'owner', shares: 0 }] })).toThrow('Informe cotas inteiras de 1 a 1000.');
  expect(() => resolveBillingSplit(100, { mode: 'shares', parts: [{ kind: 'owner', shares: 1001 }] })).toThrow('Informe cotas inteiras de 1 a 1000.');
});
// billing-draft.test.ts
it('builds a shares split and keeps the category', () => {
  const draft = { ...EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10'), selected: ['p1', 'p2'], owner: true, amount: '100,00', description: 'Churrasco', mode: 'shares' as const, values: { p1: '2', owner: '1' }, category: 'food' as const };
  const input = buildBillingInput(draft);
  expect(input.category).toBe('food');
  expect(input.split).toEqual({ mode: 'shares', parts: [{ kind: 'person', personId: 'p1', shares: 2 }, { kind: 'person', personId: 'p2', shares: 1 }, { kind: 'owner', shares: 1 }] });
});
// billing-card.test.ts — billingDueLabel (Hoje/Amanhã/Vence em 3 dias/Atrasado 2 dias/Encerrada/Liquidada), billingBadges (once pending 3 pessoas; until paid 1/4; indefinite paused; ended liquidado), billingShareAction, billingSummaryLine
```

- [ ] **Step 2:** `pnpm --filter @receivy/common test` → FAIL.
- [ ] **Step 3:** Implementar conforme Interfaces. `billing-category.ts` e `billing-card.ts` com early returns; `distribute` já existe em `split.ts`.
- [ ] **Step 4:** `pnpm --filter @receivy/common test && lint && check-types` → PASS. api/web/mobile ficam vermelhos até as tasks seguintes (esperado).
- [ ] **Step 5: Commit** `feat(common): billing category, share-based split and card helpers`

---

### Task 2: API — categoria, cotas, resumo, busca e contatos recentes

**Files:**
- Modify: `packages/api/src/schemas/billing.ts` (`category: 'food'|…|'other'`; `AllocationSchema.split_mode` + `'shares'`, `shares?: number`), `packages/api/src/billings/repository.ts` (`BILLING_SELECT`, `BillingRow`, `summary`, `summaryDto`, `splitFor`, `saveAllocations`, `createBilling`, `patchBilling`, `billingInputFrom`, `listBillings` com `search`/`category`), `packages/api/src/billings/endpoints.ts` (`BillingBody.category`, `SplitBody` `'shares'` + `shares?`, `PatchBody.category`, `ListRequest.query.search?: String.Max<80>`, `category?`), `packages/api/src/billings/request.ts` (fingerprint inclui `category`), `packages/api/src/people/repository.ts` (`listPeople(..., sort?: 'recent')`, `lastBilledAt` no DTO), `packages/api/src/people/endpoints.ts` (`query.sort?: 'recent'`)
- Test: `packages/api/test/billings/billings.spec.ts`, `packages/api/test/people/people.spec.ts` (ou onde `listPeople` é testado)
- Regenerate: `docs/openapi.json`

**Interfaces:**
- Consumes: Task 1.
- Produces: `listBillings(db, ownerId, filters: { type?, state?, cursor?, search?, category? })`; `summary()` com os 5 campos novos; `listPeople(db, ownerId, cursor?, archived?, search?, sort?)`.

- [ ] **Step 1: Specs (RED)** — `billings.spec.ts`: cria billing `category: 'food'` e `split.mode 'shares'` (2,2,1,1) → `allocations.shares` gravadas, charges com valores 40/40/20/20 de 120; `GET` detalhe devolve `category`, `allocations[].shares`; PATCH `category` em billing `once` é aceito (não é congelado); `listBillings` com `search: 'churr'` retorna só a que casa (case-insensitive) e `category: 'food'` filtra; resumo: `participantCount`, `chargeCount`, `paidCount` (marcar 1 paga), `proofsPending` (inserir `payment_proofs` `pending`), `shareChargeId` (1 participante → id da pendente; 2 participantes → null). People: `listPeople(..., 'recent')` ordena por última allocation, nulos por último, e expõe `lastBilledAt`.
- [ ] **Step 2:** rodar `pnpm --filter @receivy/api test:integration` → FAIL.
- [ ] **Step 3: Implementar**
  - `summaryDto`: uma query agregada por billing:
    ```sql
    SELECT COUNT(*) AS charge_count, COUNT(*) FILTER (WHERE c.state = 'paid') AS paid_count,
      (SELECT COUNT(*) FROM payment_proofs p JOIN charges cc ON cc.id = p.charge_id WHERE cc.billing_id = :id AND p.state = 'pending') AS proofs_pending
    FROM charges c WHERE c.billing_id = :id
    ```
    `participantCount` = allocations `kind = 'person'`; `shareChargeId` = se `participantCount === 1`, id da charge `pending` com menor `due_date >= today` (senão a de menor due_date pendente), senão `null`.
  - `listBillings`: `search` normalizado (`trim().toLowerCase()`, ≤ 80) → `rawQuery` de ids com `position(:query in lower(description)) > 0`, como `listPeople` faz; `category` → `where.category`.
  - `splitFor`: `mode === 'shares'` → `shares: row.shares ?? 1`; `saveAllocations` grava `shares` quando `'shares' in original`.
  - `assertPatchAllowed`: `category` não entra no `frozen`.
  - `listPeople` `sort === 'recent'`: `rawQuery` `SELECT p.id, MAX(a.created_at) AS last FROM people p LEFT JOIN allocations a ON a.person_id = p.id WHERE p.owner_id = :ownerId AND p.archived_at IS NULL GROUP BY p.id ORDER BY last DESC NULLS LAST, p.name ASC LIMIT 51` (com `search` reaproveitando o filtro atual por ids); `lastBilledAt` sempre no DTO (`details()` faz uma query agregada por página).
- [ ] **Step 4:** `pnpm --filter @receivy/api lint && check-types:test && test && test:integration && openapi:generate` → PASS.
- [ ] **Step 5: Commit** `feat(api): billing category, share splits, list search and recent contacts`

---

### Task 3: API — convites

**Files:**
- Create: `packages/api/src/schemas/invite.ts`, `packages/api/src/invites/repository.ts`, `packages/api/src/invites/endpoints.ts`, `packages/api/src/routes/invites.ts`
- Modify: `packages/api/src/database.ts` (tabela `billing_invites`: `id` PK, `public_id` Unique, `billing_id` Secondary, relations `billing_id@billing`, `owner_id@owner`), `packages/api/src/public/capability.ts` (parâmetro `purpose: 'charge' | 'invite'` na assinatura HMAC: `${purpose}.${publicId}.${version}.${expires}`; chamadas atuais passam `'charge'`), `packages/api/src/provider.ts` (`PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>` — `ez4.project.js` já define), `packages/api/src/api.ts` (rotas), `packages/api/src/billings/repository.ts` (`dto()` inclui `invite`), `packages/api/src/account/deletion.ts` (revoga invites do dono)
- Test: `packages/api/test/invites/invites.spec.ts`
- Regenerate: `docs/openapi.json`

**Interfaces:**
```ts
// invites/repository.ts
export async function createInvite(db, ownerId, billingId, secret, webOrigin, now = new Date()): Promise<BillingInvite>;
export async function revokeInvite(db, ownerId, billingId, now = new Date()): Promise<void>;
export async function activeInvite(db, billingId, secret, webOrigin, now = new Date()): Promise<BillingInvite | null>;
export async function getPublicInvite(db, token, secret, now = new Date()): Promise<PublicInviteView>; // 404 quando public_id não existe; expired quando revogada/expirada
export async function acceptInvite(db, userId, token, secret, now = new Date()): Promise<InviteAcceptResult>;
// routes: POST /billings/{id}/invite → 200 BillingInvite; DELETE /billings/{id}/invite → 204; GET /public/invites/{token} → 200 PublicInviteView (throttlePublicRead); POST /invites/{token}/accept → 200 InviteAcceptResult
```
Schema `BillingInviteSchema`: `id, billing_id, owner_id, public_id: String.Max<32>, expires_at: String.DateTime, revoked_at?: String.DateTime, accepted_count: number, created_at: String.DateTime`.

- [ ] **Step 1: Specs (RED)** (`invites.spec.ts`, fixtures de `billings.spec.ts`):
  1. cria convite → url `${origin}/join/<token>`, `expiresAt` +30d; segundo `createInvite` revoga o anterior (o token antigo dá `expired: true`).
  2. `getPublicInvite` devolve nome/descrição/valor/`participantCount`/`category`; token forjado → `HttpNotFoundError`.
  3. aceitar (billing `once`, split `equal`, 1 participante, charge pendente sem comprovante): cria `people` do dono com o e-mail do aceitante (`linked_user_id` = aceitante), nova allocation ordem 1, charge existente recalculada (60 → 40 de 80… usar total 80: 80→40), nova charge 40 para o aceitante, `outbox_events` `charge.created` só para a nova, `activity_events` para o aceitante, `accepted_count = 1`, resultado `{ joinedSplit: true, chargeId }`.
  4. aceitar de novo com o mesmo usuário → `joinedSplit: false`, mesma `chargeId`, sem duplicar people/allocation/charge.
  5. billing `once` com charge `paid` (ou proof `pending`) → `HttpConflictError('Divisão já em andamento.')`, nada muda.
  6. billing `indefinite` → só allocations (nenhuma charge nova); `fixed` → só contato (`joinedSplit: false`, `chargeId: null`).
  7. dono aceitando o próprio convite → `HttpConflictError('Você é o dono desta cobrança.')`; expirado → `HttpNotFoundError`.
  8. pessoa já existente nos contatos do dono com o e-mail do aceitante e sem `linked_user_id` → vinculada, não duplicada.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar `acceptInvite`** (transação, `lockOwner(db, ownerId)` + lock da billing):
  ```
  invite = verify token (purpose 'invite') → row by public_id, not revoked, not expired, billing active, owner != userId
  user = users.findOne(userId) (email verificado obrigatório; senão HttpForbiddenError('Confirme seu e-mail antes de participar.'))
  person = people(owner_id, active_email = user.email) ?? savePerson(db, ownerId, { name: user.name ?? localPart(email), email }) → garante linked_user_id = userId
  existing = allocations where billing_id & person_id → if exists: return { joinedSplit:false, chargeId: nearest pending charge of person or null }
  split = splitFor(billing); if mode in ('fixed','percentage') → accepted_count++, audit, return { joinedSplit:false, chargeId:null }
  newSplit = mode 'equal' ? push { kind:'person', personId } : push { kind:'person', personId, shares:1 }
  saveAllocations(db, billing.id, total_cents, newSplit, now)
  if type === 'indefinite' → accepted_count++, audit, return { joinedSplit:true, chargeId:null }
  occurrences = charges of billing grouped by due_date (installment); for each: if any charge.state !== 'pending' or has payment_proofs → HttpConflictError('Divisão já em andamento.')
  resolved = resolveBillingSplit(total_cents, newSplit); for each occurrence: update each existing pending charge amount_cents to resolved[personId]; build BillingPlan with only the new person's charge for that occurrence (due_date, installment, installmentCount) and persistChargePlan(db, ownerId, plan, { id, type }, prepareChargeMaterialization(db, ownerId, [personId], billing.payment_method_id), now)
  accepted_count++, audit(db, ownerId, billing.id, 'billings.invite_accepted', now, { personId })
  return { billingId, chargeId: first new charge id, joinedSplit:true }
  ```
  `activeInvite` reemite o token com `issuePublicChargeToken({ publicId, version: 1, expiresAtSeconds, secret, purpose: 'invite' })`. `dto()` em billings chama `activeInvite`.
- [ ] **Step 4:** lint, check-types:test, test, test:integration, openapi:generate → PASS.
- [ ] **Step 5: Commit** `feat(api): billing invites that add the guest as contact and participant`

---

### Task 4: Web — lista de cobranças, detalhe com convite, allowlist

**Files:**
- Rewrite: `packages/web/src/components/billings-screen.tsx` (+ `billings-screen.test.tsx`)
- Create: `packages/web/src/components/billing-card.tsx`, `packages/web/src/components/billing-filters.tsx`
- Modify: `packages/web/src/lib/financial-proxy.ts` (allowlist `POST|DELETE billings/{id}/invite`, `POST invites/{token}/accept`), `packages/web/src/app/globals.css` (`.billings-*`, `.billing-card*`, `.fab`), `packages/web/src/app/(protected)/billings/page.tsx` (botão `Nova cobrança` → `/charges/new`)

**Interfaces:** consome `BillingSummary` novo, `billingDueLabel/billingBadges/billingShareAction`, `BILLING_CATEGORIES`; `BillingCard({ billing, today, onShare, onEdit, onOpen })`; detalhe existente ganha `Convidar` (POST invite → copia url → "Link copiado"), linha "Convite ativo até dd/mm" com `Copiar` e `Revogar`.

- [ ] **Step 1: Testes (RED)** `billings-screen.test.tsx`: renderiza cards com badges/prazo/valor e "Vencimento 20/out"; `Buscar` revela campo e após digitar chama `GET /api/financial/billings?search=churr` (debounce com fake timers); `Filtros` aplica `state=ended` e `type=until` e `category=food`; `Compartilhar` em billing com `shareChargeId` chama `POST /api/financial/charges/{id}/public-link` e copia `${origin}/pay/${token}` ("Link copiado"); sem `shareChargeId` abre o detalhe; `Editar` abre o formulário (mock `BillingForm`); detalhe: `Convidar` chama `POST /api/financial/billings/{id}/invite` e mostra "Link copiado" + "Convite ativo até …"; `Revogar` chama DELETE; vazio mostra "Nenhuma cobrança ainda".
- [ ] **Step 2:** FAIL. **Step 3:** implementar (cabeçalho, busca, filtros como `<details>`/painel com `role="group"`, lista de `BillingCard`, "Carregar mais", detalhe mantido do componente atual incl. Pausar/Encerrar). `.fab` só no mobile web (`@media (max-width: 1000px)`), desktop usa botão no cabeçalho.
- [ ] **Step 4:** `pnpm --filter @receivy/web test && lint && check-types && build` (o `openapi-contract` prova a allowlist).
- [ ] **Step 5: Commit** `feat(web): billing cards with search, filters, share and invites`

---

### Task 5: Web — formulário rápido, rascunho, telas de retorno, página de convite

**Files:**
- Rewrite: `packages/web/src/components/billing-form.tsx` (+ test)
- Create: `packages/web/src/lib/billing-draft.ts` (+ test), `packages/web/src/components/contact-carousel.tsx`, `packages/web/src/components/contact-picker.tsx`, `packages/web/src/components/split-editor.tsx`, `packages/web/src/components/billing-created.tsx`, `packages/web/src/app/join/[token]/page.tsx`, `packages/web/src/components/join-invite.tsx` (+ test)
- Modify: `packages/web/src/app/(protected)/charges/new/page.tsx` (mostra `BillingCreated` após salvar em vez de redirecionar), `packages/web/src/components/people-screen.tsx` e `pix-settings-screen.tsx` (prop `returnTo?`; após salvar → `patchDraft` e `router.push(returnTo)`), `packages/web/src/app/(protected)/people/page.tsx` e `settings/pix/page.tsx` (leem `?returnTo=`), `packages/web/src/proxy.ts` (`/join/:path*` público como `/pay`, sem CSP de upload), `packages/web/src/app/globals.css`, `packages/web/src/a11y.test.tsx`

**Interfaces:**
```ts
// lib/billing-draft.ts (sessionStorage 'receivy.billingDraft')
export type StoredDraft = { draft: BillingDraft; returnTo: string };
export function saveDraft(draft: BillingDraft, returnTo: string): void;
export function takeDraft(): StoredDraft | null;          // lê e remove
export function patchDraft(patch: { selected?: string[]; pix?: string }): void; // mescla sem remover
// BillingForm props inalteradas: { billing, onSaved, onBack }
// JoinInvite({ token, view, authenticated }) — "Entrar para participar" → /login?next=/join/<token>; "Participar" → POST /api/financial/invites/{token}/accept → router.replace(chargeId ? `/charges/${chargeId}` : '/') e aviso quando !joinedSplit
```
Fluxo `Novo` contato: `saveDraft(draft, '/charges/new')` → `router.push('/people?returnTo=/charges/new')`; ao salvar contato com `returnTo`: `patchDraft({ selected: [...draft.selected, person.id] })` e `router.push(returnTo)`. Pix igual com `?returnTo=` em `/settings/pix` e `patchDraft({ pix: id })`. Formulário no mount (sem `billing`): `takeDraft()` restaura.

- [ ] **Step 1: Testes (RED)** `billing-form.test.tsx`: carrossel mostra `GET /api/people?sort=recent` (iniciais + nome), seleção alterna, `Ver todos` abre picker com busca (`GET /api/people?search=ma`), chips de categoria, modalidade `Parcelado` mostra `Parcelas` e "Valor por parcela", divisão `Cotas` com campos por pessoa e valores calculados ("2 cotas · R$ 50,00"), vencimento `Amanhã` define `startDate`, Pix chips + `Cadastrar chave` salva rascunho e navega, `Novo contato` idem, `takeDraft` restaura seleção/valor ao montar, `Criar cobrança` envia `POST /api/financial/billings` com `category`, `split.mode 'shares'` e `Idempotency-Key`, sem etapa de revisão; resumo do rodapé "2 pessoas · R$ 50,00 cada · vence amanhã"; `billing-draft.test.ts` (save/take/patch); `join-invite.test.tsx` (não autenticado → link de login com `next`; autenticado → `Participar` → accept → replace).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. Página `/join/[token]`: server component; `authApiFetch('public/invites/<token>')`; `authenticated` = cookie de acesso presente (`cookies()`), renderiza `JoinInvite`; `metadata` `robots noindex`.
- [ ] **Step 4:** web test, lint, check-types, build → PASS.
- [ ] **Step 5: Commit** `feat(web): quick billing form with drafts, share splits and invite page`

---

### Task 6: Mobile — lista de cobranças, FAB, detalhe com convite

**Files:**
- Rewrite: `packages/mobile/src/components/billings-screen.tsx` (+ test)
- Create: `packages/mobile/src/components/billing-card.tsx`, `packages/mobile/src/components/billing-filters-sheet.tsx`, SVGs `assets/images/auth/{search,sliders,plus,share,category-*.svg}` (uma por categoria: `utensils, car, shopping-cart, repeat, handshake, home, plane, tag`)
- Modify: `packages/mobile/src/app/billings.tsx` (renderiza `TabBar active="Cobranças"` via prop da screen), `packages/mobile/src/financial/client.ts` (`billings(query)` já existe; adicionar `invite(id)`, `revokeInvite(id)`)

**Interfaces:** `BillingsScreen({ client?, onCreate, onOpenCharge, onOpenFeed, onOpenSettings })`; `BillingCard({ billing, today, onShare, onEdit, onOpen })`; share usa `financialClient.publicLink` + `Share.share` como `charge-detail-screen.tsx`; `Convidar` → `client.invite(id)` → `Share.share({ message: `Entre na cobrança ${description} no Receivy: ${url}` })`.

- [ ] **Step 1: Testes (RED)** espelhando a Task 4 (RNTL): cards, busca com debounce, filtros (sheet `Modal`), compartilhar (mock `Share.share`), editar, detalhe `Convidar`/`Revogar`, FAB `Nova cobrança` chama `onCreate`, `TabBar` com Cobranças selecionada.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (FAB `absolute bottom-24 right-5 h-14 w-14 rounded-full bg-primary`).
- [ ] **Step 4:** `pnpm --filter @receivy/mobile test && lint && check-types`.
- [ ] **Step 5: Commit** `feat(mobile): billing cards with search, filters, share and invites`

---

### Task 7: Mobile — formulário rápido, rascunho, retorno de contato/Pix, Maestro

**Files:**
- Rewrite: `packages/mobile/src/components/billing-form-screen.tsx` (+ test)
- Create: `packages/mobile/src/financial/draft-store.ts` (+ test), `packages/mobile/src/components/contact-carousel.tsx`, `packages/mobile/src/components/contact-picker-sheet.tsx`, `packages/mobile/src/components/split-editor.tsx`, `packages/mobile/src/components/billing-created-screen.tsx`, `packages/mobile/src/app/charges/created.tsx` (rota que lê `params.id`)
- Modify: `packages/mobile/src/app/charges/new.tsx` (após salvar → `router.replace({ pathname: '/charges/created', params: { id } })`), `packages/mobile/src/app/people.tsx` e `settings.tsx`/`pix-settings-screen.tsx` (param `returnTo` via `useLocalSearchParams`; ao salvar com `returnTo === 'new-billing'`: `patchDraft` + `router.back()`), `packages/mobile/e2e/smoke/03-contact-charge.yaml`

**Interfaces:**
```ts
// billings/draft-store.ts (memória, padrão pending-login.ts)
export function saveDraft(draft: BillingDraft): void; export function takeDraft(): BillingDraft | null; export function patchDraft(patch: { selected?: string[]; pix?: string }): void; export function clearDraft(): void;
// BillingFormScreen({ client?, people?, billing?, onSaved, onBack, onCreateContact, onCreatePix })
```
`onCreateContact` = `saveDraft(draft); router.push({ pathname: '/people', params: { returnTo: 'new-billing' } })`; `onCreatePix` = `saveDraft(draft); router.push({ pathname: '/settings', params: { section: 'pix', returnTo: 'new-billing' } })`. Vencimento: `DateTimePicker` não existe como dependência → usar `TextInput` de data (`AAAA-MM-DD`) atrás do botão de calendário (sem dependência nova).

- [ ] **Step 1: Testes (RED)** espelhando a Task 5 (RNTL) + `draft-store.test.ts`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. Maestro `03`: após `Nova cobrança` o fluxo passa a: tocar contato no carrossel (`tapOn: "Ana QA"`), `Valor` → `50,00`, `Descrição` → `Mercado QA`, `Criar cobrança`, esperar `Cobrança criada`, `Ver cobrança`, seguir com o trecho atual de Pix/compartilhar; manter blocos por plataforma.
- [ ] **Step 4:** mobile test, lint, check-types → PASS. Controller roda Maestro.
- [ ] **Step 5: Commit** `feat(mobile): quick billing form with drafts, share splits and created screen`

---

## Self-review

- Spec §3 → T1; §4 billings/people → T2; §4 convite → T3; §5 → T4/T6; §6 → T5/T7; §7 → T3/T5/T6/T7; §8 → todas.
- Assinaturas: `listBillings` filtros (T2) usados por T4/T6; `BillingSummary` novo (T1) usado por T2 (`summary`) e cards; `saveDraft/takeDraft/patchDraft` nomes iguais em web (`lib/billing-draft.ts`) e mobile (`financial/draft-store.ts`); `acceptInvite` → `InviteAcceptResult` consumido por `JoinInvite` (T5); `purpose` no HMAC (T3) exige atualizar chamadas em `public/repository.ts`.
- Sem placeholders: textos, rótulos e algoritmos definidos; UI descrita por seção com os rótulos da constraint global.
