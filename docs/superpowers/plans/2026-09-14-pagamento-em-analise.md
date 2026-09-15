# Pagamento em análise — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem paga declara "já paguei" sem comprovante (cobrança Em análise), quem recebe confirma ou recusa, e nenhuma notificação de cobrança sai com algo em análise.

**Architecture:** A declaração é um comprovante sem arquivo (`charges.proof_kind = 'declaration'`, `proof_file = null`), reaproveitando o fluxo de comprovante (retirar, revisar, eventos). Regras de UI ficam em `@receivy/common`; a API ganha duas rotas de declaração, o bloqueio `in_review` em `sendChargeNotice` e pushes avulsos disparados pelos endpoints (nunca pelos repositórios, para não criar ciclo de import).

**Tech Stack:** EZ4 0.52 (API, `node:test` + `DatabaseTester` em `receivy_tests`), `@receivy/common` (vitest), Next 16 + Tailwind (web, vitest), Expo + Uniwind (mobile, jest/RNTL).

**Spec:** `docs/superpowers/specs/2026-09-14-pagamento-em-analise-design.md`

## Global Constraints

- Nunca commitar, nunca rodar migração, nunca deploy: cada tarefa termina em "parar para o usuário commitar".
- Sem dependência nova.
- Código, identificadores e comentários em inglês; textos de UI em pt-BR, exatamente como escritos aqui.
- API: repositórios em `export namespace`, contexto desestruturado nos handlers, `const enum` comparado por membro.
- Códigos de erro seguem o padrão do repo: `CHARGE_IN_REVIEW` (409) e `PROOF_DECLARATION_FORBIDDEN` (403).
- Toda variável nova de provider EZ4: `Environment.VariableOrValue<'NOME', 'literal'>` e entrada em `ez4.project.js` (as três usadas aqui já existem no projeto).
- Antes de encerrar cada tarefa: lint e typecheck do pacote tocado.
- Comandos de verificação:
  - common: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
  - api: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
  - web: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
  - mobile: `cd packages/mobile && npx tsc --noEmit -p tsconfig.json && pnpm lint && pnpm test`

## File map

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/common/src/domain/contracts.ts` | `ProofKind`, campos novos de `ChargeSummary`, `ChargeProof`, `PublicProofState` |
| `packages/common/src/domain/charge-text.ts` | `chargeInReview`, `canDeclarePayment`, ajustes de `canUploadProof`, `canMarkPaid`, `proofNote` |
| `packages/common/src/domain/feed.ts` | selo "Pagamento informado", rótulo "Em análise", ação `DeclarePayment` |
| `packages/api/src/charges/schemas/charge.ts` | coluna `proof_kind` |
| `packages/api/src/common/errors.ts`, `charges/errors.ts`, `proofs/errors.ts`, `api.ts` | `ForbiddenError`, `ChargeInReviewError`, `ProofDeclarationForbiddenError` |
| `packages/api/src/charges/repositories/charge.ts` | `proof_kind` no SELECT, `proofOf` sem arquivo, `confirmationRequired`, `pay` |
| `packages/api/src/timeline/repositories/timeline.ts` | `proofKind` e `confirmationRequired` nos itens |
| `packages/api/src/proofs/repositories/proof.ts` | `declare`, upload sobre a própria declaração, `review` com `via`, `stateView` |
| `packages/api/src/proofs/endpoints/declare.ts`, `public-declare.ts`, `routes.ts`, `provider.ts` | rotas de declaração e variáveis de push |
| `packages/api/src/notifications/services/send.ts`, `repositories/notification.ts` | bloqueio `in_review` |
| `packages/api/src/notifications/services/payment-notices.ts` (novo) | os quatro pushes |
| `packages/api/src/charges/provider.ts`, `charges/endpoints/pay.ts`, `proofs/endpoints/*` | disparo dos pushes |
| `packages/web/src/lib/financial-proxy.ts`, `public-proof-proxy.ts`, `openapi-contract.test.ts` | rotas liberadas no BFF |
| `packages/web/src/components/app/proof-card.tsx`, `proof-panel.tsx`, `screens/charge-detail-screen.tsx`, `screens/feed-screen.tsx`, `app/pay/[token]/page.tsx` | UI web |
| `packages/mobile/src/financial/client.ts`, `notifications/open.ts`, `components/app/proof-card.tsx`, `components/app/reject-reason-sheet.tsx` (novo), `screens/charge-detail-screen.tsx`, `screens/feed-screen.tsx` | UI mobile |
| `docs/notifications.md`, `docs/api-errors.md`, `docs/manual-qa-script.md`, `docs/api-oas.yml`, `packages/api/scripts/seed-local.mjs` | documentação e dados de teste |

---

### Task 1: Contratos e regras em `@receivy/common`

**Files:**
- Modify: `packages/common/src/domain/contracts.ts:46-98`
- Modify: `packages/common/src/domain/charge-text.ts:90-151`
- Modify: `packages/common/src/domain/feed.ts:12-145`
- Test: `packages/common/src/domain/charge-text.test.ts`, `packages/common/src/domain/feed.test.ts`

**Interfaces:**
- Produces:
  - `const enum ProofKind { File = 'file', Declaration = 'declaration' }`
  - `ChargeSummary.proofKind?: ProofKind | null`, `ChargeSummary.confirmationRequired?: boolean`
  - `ChargeProof.kind: ProofKind`, `ChargeProof.file: ProofFile | null`
  - `PublicProofState.kind: ProofKind | null`
  - `chargeInReview(charge: Pick<ChargeSummary, 'state' | 'proofState'>): boolean`
  - `canDeclarePayment(charge: ChargeDetail): boolean`
  - `ChargeActionKind.DeclarePayment = 'declare_payment'`

- [ ] **Step 1: Escrever os testes que falham**

Em `charge-text.test.ts`, adicionar `canDeclarePayment` e `chargeInReview` ao import de `./charge-text`, `ProofKind` ao import de `./contracts`, e ao final do arquivo:

```ts
describe('payment declarations', () => {
  const declared = (overrides: Partial<ChargeProof> = {}) => proof({ kind: ProofKind.Declaration, file: null, ...overrides });

  it('reads in review while anything waits for an answer', () => {
    expect(chargeInReview(charge({ proofState: ProofState.Pending }))).toBe(true);
    expect(chargeInReview(charge({ proofState: ProofState.Rejected }))).toBe(false);
    expect(chargeInReview(charge({ state: ChargeState.Paid, proofState: ProofState.Pending }))).toBe(false);
  });

  it('lets the paying side declare while nothing is under review', () => {
    expect(canDeclarePayment(charge())).toBe(true);
    expect(canDeclarePayment(charge({ proofState: ProofState.Pending, proof: declared() }))).toBe(false);
    expect(canDeclarePayment(charge({ direction: Direction.Receivable }))).toBe(false);
    expect(canDeclarePayment(charge({ state: ChargeState.Paid }))).toBe(false);
  });

  it('asks the owner of a conta a pagar to declare only when the payee can confirm', () => {
    const own = charge({ payer: ChargePayer.Owner, ownedByViewer: true });

    expect(canDeclarePayment({ ...own, confirmationRequired: true })).toBe(true);
    expect(canDeclarePayment({ ...own, confirmationRequired: false })).toBe(false);
    expect(canMarkPaid({ ...own, confirmationRequired: true })).toBe(false);
    expect(canMarkPaid({ ...own, confirmationRequired: false })).toBe(true);
  });

  it('lets the sender attach a file over their own declaration', () => {
    expect(canUploadProof(charge({ proofState: ProofState.Pending, proof: declared() }))).toBe(true);
    expect(canUploadProof(charge({ proofState: ProofState.Pending, proof: declared({ sentByViewer: false }) }))).toBe(false);
    expect(canWithdrawProof(charge({ proofState: ProofState.Pending, proof: declared() }))).toBe(true);
    expect(canAcceptProof(charge({ direction: Direction.Receivable, proofState: ProofState.Pending, proof: declared() }))).toBe(true);
  });

  it('explains a declaration the other side did not recognise', () => {
    expect(proofNote(charge({ proof: declared({ state: ProofState.Rejected, reason: 'Não caiu na conta' }) }))).toBe(
      'Pagamento não identificado: Não caiu na conta. Você pode informar de novo ou enviar um comprovante.'
    );
  });
});
```

No helper `proof()` do mesmo arquivo, adicionar `kind: ProofKind.File,` antes de `...overrides`.

Em `feed.test.ts`, adicionar `ProofKind` ao import de `./contracts`, `ChargeActionKind` ao import de `./feed`, e ao final:

```ts
describe('charges under review', () => {
  it('reads Em análise and names what is waiting', () => {
    const declared = { ...base, proofState: ProofState.Pending, proofKind: ProofKind.Declaration, dueDate: '2026-09-20' };

    expect(chargeStateLabel(declared, Direction.Receivable)).toBe('Em análise');
    expect(chargeBadges(declared, '2026-09-08')).toEqual([{ label: 'Pagamento informado', tone: 'info' }]);
    expect(chargeBadges({ ...declared, proofKind: ProofKind.File }, '2026-09-08')).toEqual([{ label: 'Comprovante enviado', tone: 'info' }]);
    expect(chargeAction(declared, Direction.Payable)).toBeNull();
  });

  it('turns the own-bill action into a declaration when the payee can confirm', () => {
    const own = { ...base, payer: ChargePayer.Owner, ownedByViewer: true, hasPix: false };

    expect(chargeAction({ ...own, confirmationRequired: true }, Direction.Payable)).toEqual({
      kind: ChargeActionKind.DeclarePayment,
      label: 'Marcar pago'
    });
    expect(chargeAction({ ...own, confirmationRequired: false }, Direction.Payable)).toEqual({ kind: 'mark_paid', label: 'Marcar pago' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/common && npx vitest run src/domain/charge-text.test.ts src/domain/feed.test.ts`
Expected: FAIL — `ProofKind`, `chargeInReview`, `canDeclarePayment` e `ChargeActionKind.DeclarePayment` não existem.

- [ ] **Step 3: Contratos**

Em `contracts.ts`, logo depois de `export const enum ProofState {…}`:

```ts
/** What waits for review on a charge: a file, or a payment declared without one. */
export const enum ProofKind {
  File = 'file',
  Declaration = 'declaration'
}
```

Em `ChargeSummary`, depois de `counterpartReachable?: boolean;`:

```ts
  /** What is under review when `proofState` is set; null when nothing was sent. */
  proofKind?: ProofKind | null;
  /** A payment declared by the paying side waits for the other side to confirm it; false settles at once. */
  confirmationRequired?: boolean;
```

Substituir `ChargeProof` e `PublicProofState`:

```ts
/** The single proof attached to a charge; the history of earlier ones lives in the events log. */
export type ChargeProof = {
  state: ProofState;
  kind: ProofKind;
  /** Null on a declaration: the payer said they paid without sending a file. */
  file: ProofFile | null;
  sentAt: string;
  reviewedAt: string | null;
  /** The creditor's words when rejecting. */
  reason: string | null;
  /** True when the viewer is the one who sent it, which is what allows taking it back. */
  sentByViewer: boolean;
};
```

```ts
/** What the public payment page may know: its own upload or declaration, never the charge's history. */
export type PublicProofState = { state: ProofState | 'uploading' | null; kind: ProofKind | null; reason: string | null; file: ProofFile | null };
```

- [ ] **Step 4: Regras de `charge-text.ts`**

Import: acrescentar `ProofKind` ao import de `./contracts`.

Antes de `canUploadProof`:

```ts
/** Pending with something waiting for an answer, a file or a declared payment: reminders and notices stop here. */
export function chargeInReview(charge: Pick<ChargeSummary, 'state' | 'proofState'>): boolean {
  return charge.state === ChargeState.Pending && charge.proofState === ProofState.Pending;
}

/** The paying side says it already paid: the debtor, or the owner of a conta a pagar whose payee can confirm. */
export function canDeclarePayment(charge: ChargeDetail): boolean {
  if (charge.direction !== Direction.Payable || charge.state !== ChargeState.Pending || chargeInReview(charge)) {
    return false;
  }

  return charge.payer !== ChargePayer.Owner || charge.confirmationRequired === true;
}
```

Corpo de `canUploadProof` depois do primeiro `if`:

```ts
  if (charge.proof?.state !== ProofState.Pending) {
    return true;
  }

  // A declaration the viewer sent may still receive its file.
  return charge.proof.kind === ProofKind.Declaration && charge.proof.sentByViewer;
```

`canMarkPaid`:

```ts
/** Whoever collects, plus the owner of a conta a pagar settling a bill nobody else has to confirm. */
export function canMarkPaid(charge: ChargeDetail): boolean {
  if (charge.state !== ChargeState.Pending) {
    return false;
  }

  return charge.direction === Direction.Receivable || (charge.ownedByViewer === true && charge.confirmationRequired !== true);
}
```

Em `proofNote`, trocar o bloco `if (proof.state === ProofState.Rejected) {…}` por:

```ts
  if (proof.state === ProofState.Rejected) {
    const reason = proof.reason ? `: ${proof.reason}.` : '.';
    const payerCanRetry = charge.state === ChargeState.Pending && charge.direction === Direction.Payable;

    if (proof.kind === ProofKind.Declaration) {
      return `Pagamento não identificado${reason}${payerCanRetry ? ' Você pode informar de novo ou enviar um comprovante.' : ''}`;
    }

    return `Comprovante rejeitado${reason}${payerCanRetry ? ' Você pode enviar outro arquivo.' : ''}`;
  }
```

- [ ] **Step 5: Regras de `feed.ts`**

Import: acrescentar `ProofKind` ao import de `./contracts`.

```ts
export const enum ChargeActionKind {
  Remind = 'remind',
  MarkPaid = 'mark_paid',
  DeclarePayment = 'declare_payment'
}
```

Em `chargeBadges`, trocar o bloco do comprovante pendente por:

```ts
  if (charge.proofState === ProofState.Pending) {
    badges.push({ label: charge.proofKind === ProofKind.Declaration ? 'Pagamento informado' : 'Comprovante enviado', tone: BadgeTone.Info });
  }
```

Em `chargeStateLabel`, antes do `return` final:

```ts
  if (charge.proofState === ProofState.Pending) {
    return 'Em análise';
  }
```

Em `chargeAction`, trocar o bloco final da conta própria sem Pix por:

```ts
  // Without a Pix key there is nothing to pay from the detail: the owner settles their own bill by hand,
  // or declares it when the payee has to confirm.
  if (ownBill && charge.ownedByViewer && !charge.hasPix) {
    return charge.confirmationRequired
      ? { kind: ChargeActionKind.DeclarePayment, label: 'Marcar pago' }
      : { kind: ChargeActionKind.MarkPaid, label: 'Marcar pago' };
  }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd packages/common && npx vitest run src/domain/charge-text.test.ts src/domain/feed.test.ts`
Expected: PASS.

- [ ] **Step 7: Verificar o pacote**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
Expected: sem erros de tipo, Biome sem erro, todos os testes passando. Os campos novos de `ChargeSummary` são opcionais, mas `ChargeProof.kind` e `PublicProofState.kind` são obrigatórios: a API volta a compilar na Task 3 (`proofOf`) e na Task 4 (`stateView`), e as fixtures de teste do web e do mobile nas Tasks 9 e 11.

- [ ] **Step 8: Parar para o usuário commitar**

---

### Task 2: Coluna `proof_kind` e erros novos na API

**Files:**
- Modify: `packages/api/src/charges/schemas/charge.ts:1-40`
- Modify: `packages/api/src/common/errors.ts`
- Modify: `packages/api/src/charges/errors.ts`
- Modify: `packages/api/src/proofs/errors.ts`
- Modify: `packages/api/src/api.ts` (imports e `httpErrors`)

**Interfaces:**
- Consumes: `ProofKind` (Task 1).
- Produces:
  - `ChargeSchema.proof_kind?: ProofKind`
  - `abstract class ForbiddenError extends ApiError` (status 403)
  - `class ChargeInReviewError extends ConflictError` — code `CHARGE_IN_REVIEW`
  - `class ProofDeclarationForbiddenError extends ForbiddenError` — code `PROOF_DECLARATION_FORBIDDEN`

Esta tarefa não tem teste próprio: os erros e a coluna são exercitados pelos testes de integração das Tasks 4 a 7. A verificação aqui é o typecheck.

- [ ] **Step 1: Coluna no schema**

Em `charges/schemas/charge.ts`, acrescentar `ProofKind` ao import de tipos de `@receivy/common` e, logo depois de `proof_state?: StoredProofState;`:

```ts
  /** File or declaration; null on rows written before declarations existed reads as a file. */
  proof_kind?: ProofKind;
```

A coluna aceita nulo, então linhas existentes não precisam de valor padrão. No banco local já criado, o `serve --local` não adiciona colunas: o usuário roda `ALTER TABLE charges ADD COLUMN proof_kind text;` ou o `serve --local --reset` descrito no README. Não rodar isso na tarefa.

- [ ] **Step 2: Base 403**

Em `common/errors.ts`, depois de `ConflictError`:

```ts
export abstract class ForbiddenError extends ApiError {
  readonly status = 403;
}
```

- [ ] **Step 3: Erro de cobrança em análise**

Em `charges/errors.ts`, ao final:

```ts
export class ChargeInReviewError extends ConflictError {
  constructor(message = 'A cobrança está em análise. Aguarde a resposta sobre o pagamento informado.') {
    super(message, 'CHARGE_IN_REVIEW');
  }
}
```

- [ ] **Step 4: Erro de declaração proibida**

Em `proofs/errors.ts`, trocar o import para `import { ConflictError, ForbiddenError, UnprocessableEntityError } from '../common/errors';` e acrescentar ao final:

```ts
export class ProofDeclarationForbiddenError extends ForbiddenError {
  constructor(message = 'Só quem paga pode informar o pagamento, e só quando o outro lado pode confirmar.') {
    super(message, 'PROOF_DECLARATION_FORBIDDEN');
  }
}
```

- [ ] **Step 5: Registrar no gateway**

Em `api.ts`:
- `import type { ChargeClosedError, ChargeInReviewError, ChargeNotPaidError } from './charges/errors';`
- no import de `./proofs/errors`, acrescentar `ProofDeclarationForbiddenError`;
- em `httpErrors`, antes de `409: [`, acrescentar `403: [ProofDeclarationForbiddenError];`;
- na lista `409`, depois de `ChargeNotPaidError,`, acrescentar `ChargeInReviewError,`.

- [ ] **Step 6: Verificar**

Run: `cd packages/api && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v "proofOf\|stateView\|kind" | head`
Expected: nenhum erro além dos já esperados da Task 1 (`ChargeProof.kind` e `PublicProofState.kind`, resolvidos nas Tasks 3 e 4).

Run: `cd packages/api && npx biome check src/common/errors.ts src/charges/errors.ts src/proofs/errors.ts src/api.ts src/charges/schemas/charge.ts`
Expected: sem erro.

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 3: `ChargeRepository` e timeline expõem tipo do comprovante e confirmação

**Files:**
- Modify: `packages/api/src/charges/repositories/charge.ts` (imports, `SELECT`, `Row`, `proofOf`, `dto`, função nova no namespace)
- Modify: `packages/api/src/timeline/repositories/timeline.ts:148-166`
- Modify: `packages/api/src/proofs/repositories/proof.ts` (`stateView`)
- Test: `packages/api/test/billings/payable.spec.ts`, `packages/api/test/proofs/proofs.spec.ts`

**Interfaces:**
- Consumes: `ProofKind`, `ChargeSummary.proofKind`, `ChargeSummary.confirmationRequired`, `ChargeProof.kind` (Task 1); `ChargeSchema.proof_kind` (Task 2).
- Produces:
  - `ChargeRepository.Row.proof_kind?: ProofKind`
  - `ChargeRepository.confirmationRequired(db: DbClient, row: Pick<ChargeRepository.Row, 'payer' | 'debtor_user_id'>): Promise<boolean>`
  - `ChargeDetail` e itens do feed com `proofKind` e `confirmationRequired`

- [ ] **Step 1: Escrever o teste que falha**

Em `test/billings/payable.spec.ts`, depois do teste `'shows the payee the same charge as receivable, with settle powers only'`:

```ts
  it('tells whether a declared payment needs someone to confirm it', async () => {
    // Due this month at the latest, so the feed (capped at the month end) lists them.
    const due = { startDate: '2026-09-05' };
    const withPayee = await BillingRepository.create(db, OWNER, 'payable-confirm-active', payable({ ...due, payeeUserId: PAYEE, description: 'Confirma' }));
    const placeholder = await ContactRepository.save(db, OWNER, { name: 'Sem app', email: 'payable-placeholder@example.com' });
    const withPlaceholder = await BillingRepository.create(
      db,
      OWNER,
      'payable-confirm-pending',
      payable({ ...due, payeeUserId: placeholder.userId, description: 'Sem app' })
    );
    const alone = await BillingRepository.create(db, OWNER, 'payable-confirm-alone', payable({ ...due, description: 'Só minha', pix: undefined }));

    equal((await ChargeRepository.get(db, OWNER, withPayee.charges[0]!.id)).confirmationRequired, true);
    equal((await ChargeRepository.get(db, OWNER, withPlaceholder.charges[0]!.id)).confirmationRequired, false);
    equal((await ChargeRepository.get(db, OWNER, alone.charges[0]!.id)).confirmationRequired, false);
    equal((await ChargeRepository.get(db, OWNER, alone.charges[0]!.id)).proofKind, null);

    const feed = await TimelineRepository.get(db, OWNER, { direction: [Direction.Payable] });

    equal(feed.items.find((item) => item.charge.id === withPayee.charges[0]!.id)?.charge.confirmationRequired, true);
    equal(feed.items.find((item) => item.charge.id === alone.charges[0]!.id)?.charge.confirmationRequired, false);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api check-types:test`
Expected: FAIL — o typecheck ainda acusa `ChargeProof.kind` ausente em `proofOf` (Task 1), e o teste novo não roda até a API compilar.

- [ ] **Step 3: Repositório de cobranças**

Em `charges/repositories/charge.ts`:

1. No import de `@receivy/common`, acrescentar `ProofKind` e `UserStatus` (valores).
2. Em `SELECT`, depois de `proof_state: true,`: `proof_kind: true,`.
3. Em `Row`, depois de `proof_state?: StoredProofState;`: `proof_kind?: ProofKind;`.
4. Substituir `proofOf` por:

```ts
  /** The attached proof as the viewer may see it: a reserved slot is nobody's business yet, and a declaration has no file. */
  export function proofOf(row: Row, viewerId: string): ChargeProof | null {
    const state = visibleProofState(row);
    const kind = row.proof_kind ?? ProofKind.File;

    if (!state || !row.proof_sent_at || (kind === ProofKind.File && !row.proof_file)) {
      return null;
    }

    return {
      state,
      kind,
      file: row.proof_file ? { name: row.proof_file.name, mime: row.proof_file.mime, size: row.proof_file.size } : null,
      sentAt: row.proof_sent_at,
      reviewedAt: row.proof_reviewed_at ?? null,
      reason: row.proof_reason ?? null,
      sentByViewer: row.proof_sender_user_id === viewerId
    };
  }

  /** What is under review, when anything is. Rows written before declarations existed carry files. */
  export function proofKind(row: Pick<Row, 'proof_state' | 'proof_kind'>): ProofKind | null {
    return row.proof_state ? (row.proof_kind ?? ProofKind.File) : null;
  }

  /**
   * Whether a payment the paying side declares waits for the other side. The owner of a conta a receber can
   * always answer; the payee of a conta a pagar only with an active account, otherwise the bill settles at once.
   */
  export async function confirmationRequired(db: DbClient, row: Pick<Row, 'payer' | 'debtor_user_id'>): Promise<boolean> {
    if (payer(row) !== ChargePayer.Owner) {
      return true;
    }

    return (await ContactRepository.counterpartOf(db, row.debtor_user_id))?.status === UserStatus.Active;
  }
```

5. Em `dto`, depois de `proofState: visibleProofState(row),`:

```ts
      proofKind: proofKind(row),
      confirmationRequired: await confirmationRequired(db, row),
```

- [ ] **Step 4: Itens da timeline**

Em `timeline/repositories/timeline.ts`, no objeto `charge` montado dentro do `for (const row of page)`, trocar a última linha `hasPix: !!row.pix_key_snapshot && !!row.pix_key_type_snapshot` por:

```ts
          hasPix: !!row.pix_key_snapshot && !!row.pix_key_type_snapshot,
          proofKind: ChargeRepository.proofKind(row),
          confirmationRequired: await ChargeRepository.confirmationRequired(db, row)
```

- [ ] **Step 4b: Estado público do comprovante**

Em `proofs/repositories/proof.ts`, substituir `stateView` por:

```ts
  export function stateView(charge: ChargeRepository.Row, token: string, secret: string): PublicProofState {
    if (!charge.proof_state || charge.proof_actor_hash !== actorHash({ token, secret })) {
      return { state: null, kind: null, reason: null, file: null };
    }

    return {
      state: charge.proof_state === StoredProofState.Uploading ? 'uploading' : ChargeRepository.visibleProofState(charge),
      kind: ChargeRepository.proofKind(charge),
      reason: charge.proof_reason ?? null,
      file: charge.proof_file ? { name: charge.proof_file.name, mime: charge.proof_file.mime, size: charge.proof_file.size } : null
    };
  }
```

Em `test/proofs/proofs.spec.ts`, atualizar as três asserções de `publicState`:
- as duas `deepEqual(await ProofRepository.publicState(db, …), { state: null, reason: null, file: null })` passam a `{ state: null, kind: null, reason: null, file: null }`;
- a de `state: 'pending'` passa a:

```ts
    deepEqual(await ProofRepository.publicState(db, own.token, SECRET), {
      state: 'pending',
      kind: 'file',
      reason: null,
      file: { name: 'proof.pdf', mime: 'application/pdf', size: 14 }
    });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test`
Expected: sem erros (a API volta a compilar depois da Task 1).

Run: `pnpm --filter @receivy/api test:integration`
Expected: o teste novo passa; a única falha é a já conhecida "searches billings by description and filters them by category".

- [ ] **Step 6: Parar para o usuário commitar**

---

### Task 4: Declarar pagamento na API (repositório, rotas e testes)

**Files:**
- Modify: `packages/api/src/proofs/repositories/proof.ts` (imports, `CLEARED`, `startUpload`, `review`, função nova `declare`)
- Create: `packages/api/src/proofs/endpoints/declare.ts`
- Create: `packages/api/src/proofs/endpoints/public-declare.ts`
- Modify: `packages/api/src/proofs/routes.ts`
- Test: `packages/api/test/proofs/proofs.spec.ts`, `packages/api/test/billings/payable.spec.ts`

**Interfaces:**
- Consumes: `ChargeRepository.confirmationRequired`, `ChargeRepository.proofKind` (Task 3); `ChargeInReviewError`, `ProofDeclarationForbiddenError` (Task 2).
- Produces:
  - `ProofRepository.declare(db: DbClient, storage: ProofStorage, id: string, actor: ProofRepository.Actor, now?: number): Promise<ChargeRepository.Row>`
  - `declarePaymentHandler` em `POST /charges/{id}/proof/declaration` → `ChargeDetail`
  - `publicDeclarePaymentHandler` em `POST /public/charges/{token}/proof/declaration` → `PublicProofState`
  - evento `proof.declared`; `charge.paid { via: 'declaration' }` ao aceitar uma declaração

- [ ] **Step 1: Escrever os testes que falham (cobranças a receber)**

Em `test/proofs/proofs.spec.ts`:
- imports: `import { ChargeInReviewError } from '../../src/charges/errors';` e acrescentar `ProofDeclarationForbiddenError` ao import de `../../src/proofs/errors`;
- no helper `row()`, acrescentar `proof_kind: true,` ao `select`;
- depois do teste `'settles the charge when the creditor accepts and explains when they reject'`:

```ts
  it('lets the paying side declare a payment without a file and the creditor answer it', async () => {
    const id = await charge();

    await rejects(() => ProofRepository.declare(db, storage, id, { userId: OWNER }), ProofDeclarationForbiddenError);
    await rejects(() => ProofRepository.declare(db, storage, id, { userId: OTHER }), HttpForbiddenError);

    const declared = await ProofRepository.declare(db, storage, id, actor);

    equal(declared.proof_state, 'pending');
    equal(declared.proof_kind, 'declaration');
    equal(declared.proof_file ?? null, null);
    equal(declared.proof_sender_user_id, DEBTOR);
    ok((await eventTypes(id)).includes('proof.declared'));
    await rejects(() => ProofRepository.declare(db, storage, id, actor), ChargeInReviewError);

    const seen = await ChargeRepository.get(db, OWNER, id);

    equal(seen.proofState, 'pending');
    equal(seen.proofKind, 'declaration');
    equal(seen.proof?.file, null);
    equal(seen.confirmationRequired, true);
    await rejects(() => ProofRepository.downloadUrl(db, storage, id, OWNER), HttpNotFoundError);

    equal((await ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted })).state, 'paid');
    deepEqual((await EventRepository.list(db, id, 'charge.paid'))[0]?.payload, { via: 'declaration' });

    const refusedId = await charge();

    await ProofRepository.declare(db, storage, refusedId, actor);
    await ProofRepository.review(db, refusedId, OWNER, { decision: ProofState.Rejected, reason: 'Não caiu' });

    const refused = await ChargeRepository.get(db, DEBTOR, refusedId);

    equal(refused.state, 'pending');
    equal(refused.proof?.kind, 'declaration');
    equal(refused.proof?.reason, 'Não caiu');
    ok(await ProofRepository.declare(db, storage, refusedId, actor), 'a refused declaration may be sent again');
  });

  it('lets the sender take back or attach a file over their own declaration, and nobody else', async () => {
    const id = await charge();
    const token = await publicActor(id);

    await ProofRepository.declare(db, storage, id, token);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, actor, input), ApiError);
    await rejects(() => ProofRepository.withdraw(db, storage, id, actor), HttpNotFoundError);
    deepEqual(await ProofRepository.publicState(db, token.token, SECRET), { state: 'pending', kind: 'declaration', reason: null, file: null });

    await upload(id, token);

    equal((await row(id)).proof_kind, 'file');
    equal((await ChargeRepository.get(db, OWNER, id)).proofKind, 'file');

    const withdrawnId = await charge();

    await ProofRepository.declare(db, storage, withdrawnId, actor);
    await ProofRepository.withdraw(db, storage, withdrawnId, actor);
    equal((await row(withdrawnId)).proof_state ?? null, null);
  });

  it("drops the sender's own live upload when they declare and refuses over someone else's", async () => {
    const id = await charge();
    const { key } = await reserve(id);

    await ProofRepository.declare(db, storage, id, actor);
    equal(await bucket.exists(key), false);

    const busyId = await charge();

    await reserve(busyId, await publicActor(busyId));
    await rejects(() => ProofRepository.declare(db, storage, busyId, actor), ApiError);
  });
```

- [ ] **Step 2: Escrever o teste que falha (conta a pagar)**

Em `test/billings/payable.spec.ts`:
- imports: `ProofState` em `@receivy/common`; `import { ProofDeclarationForbiddenError } from '../../src/proofs/errors';`, `import { ProofRepository } from '../../src/proofs/repositories/proof';`, `import type { ProofStorage } from '../../src/proofs/services/storage';`;
- depois do teste da Task 3:

```ts
  it('lets the owner declare a bill only to a payee who can confirm, and the payee answer it', async () => {
    const due = { startDate: '2026-09-05' };
    const confirmable = await BillingRepository.create(db, OWNER, 'payable-declare-active', payable({ ...due, payeeUserId: PAYEE, description: 'Declara' }));
    const alone = await BillingRepository.create(db, OWNER, 'payable-declare-alone', payable({ ...due, description: 'Sozinha', pix: undefined }));
    // A declaration never touches the bucket unless an upload slot was open.
    const storage = { delete: async () => undefined } as unknown as ProofStorage;
    const chargeId = confirmable.charges[0]!.id;

    await rejects(() => ProofRepository.declare(db, storage, alone.charges[0]!.id, { userId: OWNER }), ProofDeclarationForbiddenError);
    await rejects(() => ProofRepository.declare(db, storage, chargeId, { userId: PAYEE }), ProofDeclarationForbiddenError);
    await ProofRepository.declare(db, storage, chargeId, { userId: OWNER });

    equal((await ChargeRepository.get(db, PAYEE, chargeId)).proofKind, 'declaration');
    equal((await ProofRepository.review(db, chargeId, PAYEE, { decision: ProofState.Accepted })).state, 'paid');
  });
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api check-types:test`
Expected: FAIL — `ProofRepository.declare` não existe.

- [ ] **Step 4: Repositório de comprovantes**

Em `proofs/repositories/proof.ts`:

1. Imports: acrescentar `ChargePayer` e `ProofKind` ao import de `@receivy/common`; trocar `import { ChargeClosedError } from '../../charges/errors';` por `import { ChargeClosedError, ChargeInReviewError } from '../../charges/errors';`; acrescentar `ProofDeclarationForbiddenError` ao import de `../errors`.
2. Em `CLEARED`, depois de `proof_file: sqlNull,`: `proof_kind: sqlNull,`.
3. Em `startUpload`, trocar o `if (row.proof_state === StoredProofState.Pending || row.proof_state === StoredProofState.Accepted) {…}` por:

```ts
      // A file under review may not be replaced, except the sender's own declaration, which the file completes.
      const ownDeclaration = row.proof_kind === ProofKind.Declaration && ownsProof(row, actor);

      if (row.proof_state === StoredProofState.Accepted || (row.proof_state === StoredProofState.Pending && !ownDeclaration)) {
        throw new ProofPendingError();
      }
```

e, no `data` do `updateOne` logo abaixo, depois de `proof_state: StoredProofState.Uploading,`: `proof_kind: ProofKind.File,`.

4. Em `review`, trocar `payload: { via: 'proof' },` por `payload: { via: row.proof_kind === ProofKind.Declaration ? 'declaration' : 'proof' },`.

5. Depois de `withdraw`, acrescentar:

```ts
  /**
   * The paying side says it already paid, without a file: the charge waits in review for the other side. The
   * sender's own abandoned upload is dropped; anything under review, or someone else's live upload, refuses.
   */
  export async function declare(db: DbClient, storage: ProofStorage, id: string, actor: Actor, now = Date.now()): Promise<ChargeRepository.Row> {
    const { declared, previousKey } = await db.transaction(async (tx) => {
      const { row, direction } = await authorize(tx, id, actor, true);

      pending(row);

      // Whoever collects answers a declaration; they never send one.
      if (direction === Direction.Receivable) {
        throw new ProofDeclarationForbiddenError();
      }

      // The owner of a conta a pagar declares only to a payee who can confirm; otherwise the bill is settled by hand.
      if (ChargeRepository.payer(row) === ChargePayer.Owner && !(await ChargeRepository.confirmationRequired(tx, row))) {
        throw new ProofDeclarationForbiddenError();
      }

      if (row.proof_state === StoredProofState.Pending || row.proof_state === StoredProofState.Accepted) {
        throw new ChargeInReviewError();
      }

      const liveUpload = row.proof_state === StoredProofState.Uploading && !!row.proof_expires_at && Date.parse(row.proof_expires_at) > now;

      if (liveUpload && !ownsProof(row, actor)) {
        throw new UploadInProgressError();
      }

      const stamp = new Date(now).toISOString();

      await tx.charges.updateOne({
        where: { id },
        data: {
          ...CLEARED,
          proof_state: StoredProofState.Pending,
          proof_kind: ProofKind.Declaration,
          ...(userId(actor) ? { proof_sender: { id: userId(actor)! } } : {}),
          proof_actor_hash: actorHash(actor),
          proof_sent_at: stamp,
          updated_at: stamp
        }
      });
      await EventRepository.record(tx, {
        type: 'proof.declared',
        eventableType: EventableType.Charge,
        eventableId: id,
        actorId: userId(actor) ?? null,
        at: stamp
      });

      const current = await tx.charges.findOne({ select: ChargeRepository.SELECT, where: { id } });

      if (!current) {
        throw new HttpNotFoundError();
      }

      // A rejected file or an abandoned slot has no row pointing at it any more.
      return { declared: current, previousKey: row.proof_file?.key ?? null };
    });

    if (previousKey) {
      await storage.delete(previousKey).catch(() => undefined);
    }

    return declared;
  }
```

- [ ] **Step 5: Endpoints**

Criar `proofs/endpoints/declare.ts`:

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';

declare class DeclareRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ChargeResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function declarePaymentHandler(request: DeclareRequest, { db, proofFiles }: Service.Context<ProofProvider>): Promise<ChargeResponse> {
  const { userId } = request.identity;
  const row = await ProofRepository.declare(db, bucketProofStorage(proofFiles), request.parameters.id, { userId });

  return { status: 200, body: await AvatarRepository.sign(proofFiles, await ChargeRepository.dto(db, row, userId)) };
}
```

Criar `proofs/endpoints/public-declare.ts`:

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProofState } from '@receivy/common';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';
import { resolveThrottledActor } from '../utils/actor';

declare class PublicDeclareRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicStateResponse implements Http.Response {
  status: 200;
  body: PublicProofState;
}

export async function publicDeclarePaymentHandler(
  request: PublicDeclareRequest,
  { db, variables, proofFiles }: Service.Context<ProofProvider>
): Promise<PublicStateResponse> {
  const { charge, actor } = await resolveThrottledActor({ db, variables }, request.parameters.token);
  const row = await ProofRepository.declare(db, bucketProofStorage(proofFiles), charge.id, actor);

  return { status: 200, body: ProofRepository.stateView(row, actor.token, actor.secret) };
}
```

- [ ] **Step 6: Rotas**

Em `proofs/routes.ts`, acrescentar os imports `import type { declarePaymentHandler } from './endpoints/declare';` e `import type { publicDeclarePaymentHandler } from './endpoints/public-declare';`, e ao final da tupla:

```ts
  Http.UseRoute<{
    name: 'declarePayment';
    path: 'POST /charges/{id}/proof/declaration';
    authorizer: typeof sessionAuthorizer;
    handler: typeof declarePaymentHandler;
  }>,
  Http.UseRoute<{
    name: 'publicDeclarePayment';
    path: 'POST /public/charges/{token}/proof/declaration';
    handler: typeof publicDeclarePaymentHandler;
  }>
```

(Adicionar a vírgula depois da rota `publicWithdrawProof`.)

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: lint e typecheck limpos; os quatro testes novos passam; única falha é a conhecida busca por categoria.

Run: `pnpm --filter @receivy/api test`
Expected: `import-cycles.test.ts` e demais testes unitários passam (os endpoints importam o repositório; o repositório não importa notificações).

- [ ] **Step 8: Parar para o usuário commitar**

---

### Task 5: "Marcar pago" responde o que está em análise

**Files:**
- Modify: `packages/api/src/charges/repositories/charge.ts` (`pay`)
- Test: `packages/api/test/proofs/proofs.spec.ts`, `packages/api/test/billings/payable.spec.ts`

**Interfaces:**
- Consumes: `ProofDeclarationForbiddenError` (Task 2), `ChargeRepository.confirmationRequired` (Task 3), `ProofRepository.declare` (Task 4).
- Produces: `ChargeRepository.pay` aceita o comprovante ou a declaração pendente (`charge.paid { via: 'proof' | 'declaration' }`) e recusa com 403 o dono de conta a pagar cujo recebedor pode confirmar.

- [ ] **Step 1: Reescrever o teste que muda de comportamento**

Em `test/proofs/proofs.spec.ts`, substituir o teste `'leaves a pending proof alone on manual settlement or cancellation and reopens an accepted one'` inteiro por:

```ts
  it('answers what waits in review on manual settlement, leaves it alone on cancellation and reopens an accepted one', async () => {
    const id = await charge();

    await upload(id);
    await ChargeRepository.pay(db, OWNER, id);

    equal((await row(id)).proof_state, 'accepted', 'settling by hand accepts the file under review');
    ok((await eventTypes(id)).includes('proof.accepted'));
    deepEqual((await EventRepository.list(db, id, 'charge.paid'))[0]?.payload, { via: 'proof' });
    await rejects(() => ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted }), ApiError);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, actor, input), ApiError);
    ok(await ProofRepository.downloadUrl(db, storage, id, OWNER));

    const reopened = await ChargeRepository.reopen(db, OWNER, id);

    equal(reopened.state, 'pending');
    equal(reopened.paidAt, null);
    equal(reopened.proof?.state, 'pending', 'an accepted file goes back under review');
    equal((await row(id)).proof_reviewed_at ?? null, null);
    ok((await eventTypes(id)).includes('charge.reopened'));
    await rejects(() => ChargeRepository.reopen(db, OWNER, id), ApiError);
    equal((await ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted })).state, 'paid');

    const declaredId = await charge();

    await ProofRepository.declare(db, storage, declaredId, actor);
    await ChargeRepository.pay(db, OWNER, declaredId);
    deepEqual((await EventRepository.list(db, declaredId, 'charge.paid'))[0]?.payload, { via: 'declaration' });

    const cancelledId = await charge();

    await upload(cancelledId);
    await ChargeRepository.cancel(db, OWNER, cancelledId);

    equal((await row(cancelledId)).proof_state, 'pending');
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, cancelledId, actor, input), ApiError);
    await rejects(() => ProofRepository.withdraw(db, storage, cancelledId, actor), ApiError);
    ok(await ProofRepository.downloadUrl(db, storage, cancelledId, OWNER));
  });
```

- [ ] **Step 2: Teste da conta a pagar com recebedor ativo**

Em `test/billings/payable.spec.ts`, no teste `'lets the owner declare a bill only to a payee who can confirm, and the payee answer it'` (Task 4), logo antes de `await ProofRepository.declare(db, storage, chargeId, { userId: OWNER });`:

```ts
    await rejects(() => ChargeRepository.pay(db, OWNER, chargeId), ProofDeclarationForbiddenError);
    equal((await ChargeRepository.pay(db, OWNER, alone.charges[0]!.id)).state, 'paid', 'a bill nobody confirms settles at once');
```

Depois, procurar chamadas antigas que agora ficam proibidas:

Run: `grep -n "ChargeRepository.pay(db, OWNER" packages/api/test/billings/payable.spec.ts packages/api/test/notifications/notifications.spec.ts`

Para cada ocorrência sobre uma cobrança criada com `payeeUserId: PAYEE` (recebedor ativo), trocar o ator para `PAYEE` (quem recebe continua podendo marcar paga). Ocorrências sem recebedor ficam como estão.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration`
Expected: FAIL — `proof_state` continua `pending` depois do `pay`, e o dono consegue pagar a conta com recebedor ativo.

- [ ] **Step 4: Implementar**

Em `charges/repositories/charge.ts`, acrescentar `import { ProofDeclarationForbiddenError } from '../../proofs/errors';` (o arquivo de erros só importa `common/errors`, sem ciclo) e substituir `pay` por:

```ts
  /**
   * Whoever collects settles by hand, and a file or declaration waiting in review counts as accepted. The owner
   * of a conta a pagar settles alone only when no payee can confirm; otherwise they declare the payment.
   */
  export async function pay(db: DbClient, actorId: string, id: string, now = new Date()): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      const { row, direction } = await findForActor(tx, actorId, id, true);
      if (direction !== Direction.Receivable && !owns(row, actorId)) throw new HttpForbiddenError();
      if (row.state !== ChargeState.Pending) throw new ChargeClosedError();
      if (direction === Direction.Payable && (await confirmationRequired(tx, row))) throw new ProofDeclarationForbiddenError();
      const stamp = now.toISOString();
      const answering = row.proof_state === StoredProofState.Pending;
      const changed = await tx.charges.updateOne({
        select: { id: true },
        where: { id },
        data: {
          state: ChargeState.Paid,
          paid_at: stamp,
          ...(answering ? { proof_state: StoredProofState.Accepted, proof_reviewed_at: stamp, proof_reason: sqlNull } : {}),
          updated_at: stamp
        }
      });
      if (!changed) throw new HttpNotFoundError();
      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });
      if (!updated) throw new HttpNotFoundError();
      if (answering) {
        await activity(tx, { actorId, row: updated, type: 'proof.accepted', now: stamp, payload: { name: row.proof_file?.name } });
      }
      const via = !answering ? 'manual' : row.proof_kind === ProofKind.Declaration ? 'declaration' : 'proof';
      await activity(tx, { actorId, row: updated, type: 'charge.paid', now: stamp, payload: { via } });
      return dto(tx, updated, actorId);
    });
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: limpos; única falha é a conhecida busca por categoria.

Run: `pnpm --filter @receivy/api test`
Expected: passa, inclusive `import-cycles.test.ts`.

- [ ] **Step 6: Parar para o usuário commitar**

---

### Task 6: Nenhuma notificação de cobrança em análise

**Files:**
- Modify: `packages/api/src/notifications/services/send.ts` (`sendChargeNotice`, `planReminders`)
- Modify: `packages/api/src/notifications/repositories/notification.ts` (`manualReminder`)
- Test: `packages/api/test/notifications/notifications.spec.ts`

**Interfaces:**
- Consumes: `ChargeInReviewError` (Task 2), `ChargeSchema.proof_kind` (Task 2).
- Produces: evento `notice.skipped { reason: 'in_review' }`; `manualReminder` lança `ChargeInReviewError`; `planReminders` ignora cobranças em análise.

- [ ] **Step 1: Escrever o teste que falha**

Em `test/notifications/notifications.spec.ts`:
- imports: `ProofKind` em `@receivy/common`; `import { ChargeInReviewError } from '../../src/charges/errors';`; acrescentar `planReminders` ao import de `../../src/notifications/services/send`;
- depois do teste `'follows a push up by e-mail once, while the charge is open with nothing under review'`:

```ts
  it('sends nothing while a payment waits in review and refuses the manual reminder', async () => {
    const { id } = await charge();

    await db.charges.updateOne({
      where: { id },
      data: { proof_state: StoredProofState.Pending, proof_kind: ProofKind.Declaration, proof_sent_at: new Date(clock).toISOString() }
    });
    sent.reset();

    deepEqual(await send(id, NoticeTemplate.Reminder, 0), { channels: [] });
    equal(sent.pushes.length + sent.emails.length, 0);
    equal((await EventRepository.list(db, id, 'notice.skipped'))[0]?.payload['reason'], 'in_review');
    await rejects(() => NotificationRepository.manualReminder(db, OWNER, id, context, () => clock), ChargeInReviewError);

    notify.events.clear();
    await planReminders(db, notify, instantAt(DUE_DATE, REMINDER_HOUR, TZ).getTime() - 3600_000);
    equal(notify.events.has(notifyIdentifier(id)), false);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration`
Expected: FAIL — o lembrete sai por push/e-mail e o `manualReminder` não lança.

- [ ] **Step 3: Bloqueio no envio**

Em `send.ts`, logo depois do `if (!charge || charge.state !== ChargeState.Pending) {…}` de `sendChargeNotice`:

```ts
  // Somebody said it was paid, with a file or without: nothing chases them while the other side answers.
  if (charge.proof_state === StoredProofState.Pending) {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { template, ...(options.offsetDays === undefined ? {} : { offsetDays: options.offsetDays }), reason: 'in_review' }
    });
    return { channels: [] };
  }
```

Em `planReminders`, trocar o `select` por `select: { id: true, billing_id: true, due_date: true, proof_state: true },` e, no começo do `for (const charge of records) {`:

```ts
    if (charge.proof_state === StoredProofState.Pending) {
      continue;
    }
```

- [ ] **Step 4: Bloqueio no Lembrar manual**

Em `notifications/repositories/notification.ts`:
- `import { ChargeClosedError, ChargeInReviewError } from '../../charges/errors';`
- `import { StoredProofState } from '../../charges/schemas/charge';`
- depois do `if (row.state !== ChargeState.Pending) { throw new ChargeClosedError(); }`:

```ts
      if (row.proof_state === StoredProofState.Pending) {
        throw new ChargeInReviewError();
      }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: limpos; o teste novo passa; única falha é a conhecida busca por categoria.

- [ ] **Step 6: Parar para o usuário commitar**

---

### Task 7: Pushes de pagamento informado, comprovante recebido, confirmado e não identificado

**Files:**
- Create: `packages/api/src/notifications/services/payment-notices.ts`
- Modify: `packages/api/src/proofs/provider.ts`, `packages/api/src/charges/provider.ts`
- Modify: `packages/api/src/proofs/endpoints/declare.ts`, `public-declare.ts`, `complete-upload.ts`, `public-complete-upload.ts`, `review.ts`
- Modify: `packages/api/src/charges/endpoints/pay.ts`
- Test: `packages/api/test/notifications/notifications.spec.ts`

**Interfaces:**
- Consumes: `pushToUser` (`notifications/services/direct.ts`), `notificationTransport` (`notifications/services/transport.ts`), endpoints da Task 4, `pay` da Task 5.
- Produces:
  - `const enum PaymentNotice { Declared = 'declared', ProofReceived = 'proof_received', Confirmed = 'confirmed', NotIdentified = 'not_identified' }`
  - `type PaymentNoticeContext = { transport: NotificationTransport; origin: string }`
  - `paymentNoticeContext(variables: PaymentNoticeVariables): PaymentNoticeContext`
  - `pushPaymentNotice(db: DbClient, context: PaymentNoticeContext, chargeId: string, notice: PaymentNotice): Promise<void>` — nunca lança; grava `notice.payment { key, notice }` e não repete a mesma chave

Os pushes saem dos endpoints, depois do commit. O módulo novo não importa `ChargeRepository`, para não criar ciclo com `charges/repositories/charge.ts`.

- [ ] **Step 1: Escrever o teste que falha**

Em `test/notifications/notifications.spec.ts`, acrescentar o import `import { PaymentNotice, pushPaymentNotice } from '../../src/notifications/services/payment-notices';` e, depois do teste da Task 6:

```ts
  it('pushes who has to answer a declared payment and who paid once it is answered, never twice', async () => {
    const { id, userId } = await charge();
    const payments = { transport: sent.transport, origin: 'https://receivy.example' };

    await soleDevice(OWNER, 'ExponentPushToken[owner-review]', 'owner-review');
    await soleDevice(userId, 'ExponentPushToken[debtor-review]', 'debtor-review');
    await db.charges.updateOne({
      where: { id },
      data: { proof_state: StoredProofState.Pending, proof_kind: ProofKind.Declaration, proof_sent_at: new Date(clock).toISOString() }
    });
    sent.reset();

    await pushPaymentNotice(db, payments, id, PaymentNotice.Declared);
    await pushPaymentNotice(db, payments, id, PaymentNotice.Declared);

    equal(sent.pushes.length, 1, 'the same submission is pushed once');
    equal(sent.pushes[0]?.token, 'ExponentPushToken[owner-review]');
    equal(sent.pushes[0]?.title, 'Pagamento informado');
    ok(/^Recipient disse que pagou .+ · R\$\s12,34\. Confirme o recebimento\.$/.test(sent.pushes[0]?.body ?? ''));
    equal(sent.pushes[0]?.url, `https://receivy.example/charges/${id}`);

    await db.charges.updateOne({ where: { id }, data: { proof_state: StoredProofState.Rejected, proof_reason: 'Não caiu' } });
    await pushPaymentNotice(db, payments, id, PaymentNotice.NotIdentified);

    equal(sent.pushes.length, 2);
    equal(sent.pushes[1]?.token, 'ExponentPushToken[debtor-review]');
    equal(sent.pushes[1]?.title, 'Pagamento não identificado');
    ok(sent.pushes[1]?.body.endsWith(': Não caiu'));
    equal(sent.emails.length, 0, 'payment notices never e-mail');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api check-types:test`
Expected: FAIL — o módulo `payment-notices` não existe.

- [ ] **Step 3: Módulo de pushes**

Criar `notifications/services/payment-notices.ts`:

```ts
import { ChargePayer, formatMoney } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { pushToUser } from './direct';
import { type NotificationTransport, notificationTransport } from './transport';

export const enum PaymentNotice {
  Declared = 'declared',
  ProofReceived = 'proof_received',
  Confirmed = 'confirmed',
  NotIdentified = 'not_identified'
}

export type PaymentNoticeContext = { transport: NotificationTransport; origin: string };

export type PaymentNoticeVariables = { PUBLIC_WEB_ORIGIN: string; NOTIFICATION_PUSH_TRANSPORT?: string; EXPO_ACCESS_TOKEN?: string };

/** Push only: the provider's e-mail settings are not needed, so the transport's e-mail side answers `disabled`. */
export function paymentNoticeContext(variables: PaymentNoticeVariables): PaymentNoticeContext {
  return { transport: notificationTransport({ ...variables }), origin: variables.PUBLIC_WEB_ORIGIN };
}

function copy(notice: PaymentNotice, name: string, what: string, reason: string | undefined) {
  switch (notice) {
    case PaymentNotice.Declared:
      return { title: 'Pagamento informado', body: `${name} disse que pagou ${what}. Confirme o recebimento.` };

    case PaymentNotice.ProofReceived:
      return { title: 'Comprovante recebido', body: `${name} enviou o comprovante de ${what}.` };

    case PaymentNotice.Confirmed:
      return { title: 'Pagamento confirmado', body: `${name} confirmou ${what}.` };

    default:
      return { title: 'Pagamento não identificado', body: `${name}: ${reason ?? 'o pagamento não foi identificado.'}` };
  }
}

/**
 * Tells the other side of a payment under review: whoever answers hears about a declaration or a file, whoever
 * paid hears the answer. One push per submission and notice, sent after the action committed; it never throws.
 */
export async function pushPaymentNotice(db: DbClient, context: PaymentNoticeContext, chargeId: string, notice: PaymentNotice): Promise<void> {
  try {
    const charge = await db.charges.findOne({
      select: { creditor_id: true, debtor_user_id: true, payer: true, description: true, amount_cents: true, proof_reason: true, proof_sent_at: true },
      where: { id: chargeId }
    });

    if (!charge) {
      return;
    }

    const ownerPays = charge.payer === ChargePayer.Owner;
    const payerId = ownerPays ? charge.creditor_id : charge.debtor_user_id;
    const reviewerId = ownerPays ? charge.debtor_user_id : charge.creditor_id;
    const toReviewer = notice === PaymentNotice.Declared || notice === PaymentNotice.ProofReceived;
    const recipientId = toReviewer ? reviewerId : payerId;
    const actorId = toReviewer ? payerId : reviewerId;

    if (!recipientId) {
      return;
    }

    // Completing an upload and the bucket event may both report the same file.
    const key = `${notice}:${charge.proof_sent_at ?? ''}`;

    if ((await EventRepository.list(db, chargeId, 'notice.payment')).some((event) => event.payload['key'] === key)) {
      return;
    }

    const actor = actorId ? await db.users.findOne({ select: { name: true }, where: { id: actorId } }) : undefined;
    const name = actor?.name?.trim().split(/\s+/)[0] || 'Alguém';
    const what = `${charge.description} · ${formatMoney({ amountCents: charge.amount_cents, currency: 'BRL' })}`;

    await pushToUser(db, context.transport, recipientId, {
      ...copy(notice, name, what, charge.proof_reason),
      url: `${context.origin.replace(/\/+$/, '')}/charges/${chargeId}`
    });
    await EventRepository.record(db, {
      type: 'notice.payment',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { key, notice }
    });
  } catch (error) {
    console.error('Payment notice failed', { chargeId, notice, error: error instanceof Error ? error.message : 'unknown' });
  }
}
```

- [ ] **Step 4: Rodar e ver o teste passar**

Run: `pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: o teste novo passa.

- [ ] **Step 5: Variáveis nos providers**

Em `proofs/provider.ts`, no bloco `variables`, depois de `PUBLIC_LINK_HMAC_SECRET`:

```ts
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
```

Em `charges/provider.ts`, substituir a classe por:

```ts
export declare class ChargeProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    proofFiles: Environment.Service<ProofFiles>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };
}
```

As três variáveis já estão em `ez4.project.js`.

- [ ] **Step 6: Disparar dos endpoints**

Em cada endpoint abaixo, importar `import { PaymentNotice, paymentNoticeContext, pushPaymentNotice } from '../../notifications/services/payment-notices';` e acrescentar `variables` à desestruturação do contexto quando faltar.

`proofs/endpoints/declare.ts` — antes do `return`:

```ts
  await pushPaymentNotice(db, paymentNoticeContext(variables), row.id, PaymentNotice.Declared);
```

`proofs/endpoints/public-declare.ts` — antes do `return`: a mesma linha.

`proofs/endpoints/complete-upload.ts` e `public-complete-upload.ts` — antes do `return`:

```ts
  await pushPaymentNotice(db, paymentNoticeContext(variables), row.id, PaymentNotice.ProofReceived);
```

`proofs/endpoints/review.ts` — trocar o corpo por:

```ts
  const detail = await ProofRepository.review(db, request.parameters.id, request.identity.userId, request.body);
  const notice = detail.state === ChargeState.Paid ? PaymentNotice.Confirmed : PaymentNotice.NotIdentified;

  await pushPaymentNotice(db, paymentNoticeContext(variables), detail.id, notice);

  return { status: 200, body: await AvatarRepository.sign(proofFiles, detail) };
```

`charges/endpoints/pay.ts` — trocar o corpo por:

```ts
  const detail = await ChargeRepository.pay(db, request.identity.userId, request.parameters.id);

  // Settling by hand answered whatever waited in review: whoever paid hears it like a confirmation.
  if (detail.proof?.state === ProofState.Accepted && detail.proof.reviewedAt === detail.paidAt) {
    await pushPaymentNotice(db, paymentNoticeContext(variables), detail.id, PaymentNotice.Confirmed);
  }

  return { status: 200, body: await AvatarRepository.sign(proofFiles, detail) };
```

(e `{ db, proofFiles, variables }: Service.Context<ChargeProvider>` na assinatura). Em `review.ts`, importar `ChargeState` de `@receivy/common` como valor; em `pay.ts`, importar `ProofState` como valor — o repo compara `const enum` pelos membros, nunca por literal.

- [ ] **Step 7: Verificar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test && pnpm --filter @receivy/api test:integration`
Expected: limpos; `import-cycles.test.ts` passa; única falha de integração é a conhecida busca por categoria.

Run: `pnpm --filter @receivy/api test:http-smoke`
Expected: o `ez4 serve --local` sobe com as variáveis novas dos providers (o script ainda pode cair no fixture antigo de `users.status`, que já falhava antes; o que importa é o servidor responder o health).

- [ ] **Step 8: Parar para o usuário commitar**

---

### Task 8: Rotas liberadas no BFF, OpenAPI, cliente mobile e link de push

**Files:**
- Modify: `docs/api-oas.yml` (gerado)
- Modify: `packages/web/src/lib/financial-proxy.ts`, `financial-proxy.test.ts`
- Modify: `packages/web/src/lib/public-proof-proxy.ts`, `public-proof-proxy.test.ts`
- Modify: `packages/web/src/lib/openapi-contract.test.ts`
- Modify: `packages/mobile/src/financial/client.ts`
- Modify: `packages/mobile/src/notifications/open.ts`, `open.test.ts`

**Interfaces:**
- Consumes: rotas da Task 4.
- Produces: `financialClient.declarePayment(id: string): Promise<ChargeDetail>`; BFF aceita `POST /api/financial/charges/{id}/proof/declaration` e `POST /api/public-proof/{token}/proof/declaration`; o app abre `https://<web>/charges/<uuid>`.

- [ ] **Step 1: Regenerar a OpenAPI**

Run: `pnpm --filter @receivy/api openapi:generate`
Expected: `docs/api-oas.yml` ganha `/charges/{id}/proof/declaration` e `/public/charges/{token}/proof/declaration`.

- [ ] **Step 2: Escrever os testes que falham**

`financial-proxy.test.ts`: na lista de rotas permitidas (linha com `["POST", "charges/charge-id/proof"]`), acrescentar `["POST", "charges/charge-id/proof/declaration"],`.

`public-proof-proxy.test.ts`, ao final:

```ts
it("forwards a payment declaration for the payer's own link", async () => {
  upstream.mockResolvedValue(Response.json({ state: "pending", kind: "declaration", reason: null, file: null }));
  const response = await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token/proof/declaration", { method: "POST", headers: { origin: "http://localhost:3000" }, body: "" }), "token", "proof/declaration");
  expect(response.status).toBe(200);
  expect(upstream).toHaveBeenCalledWith("public/charges/token/proof/declaration", { method: "POST", body: "" });
  expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "GET" }), "token", "proof/declaration")).status).toBe(404);
});
```

`openapi-contract.test.ts`: em `DEDICATED_BFF`, na linha das rotas públicas de comprovante, acrescentar `"POST public/charges/{p}/proof/declaration",`.

`mobile/src/notifications/open.test.ts`, ao final:

```ts
it("opens a charge by its uuid, which is where payment notices point", () => {
  expect(
    notificationUrl("https://receivy.example/charges/2b7c1b0e-1e2f-4c3d-8a9b-0c1d2e3f4a5b", "https://receivy.example"),
  ).toBe("https://receivy.example/charges/2b7c1b0e-1e2f-4c3d-8a9b-0c1d2e3f4a5b");
  expect(notificationUrl("https://receivy.example/charges/x", "https://receivy.example")).toBeNull();
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- src/lib && cd packages/mobile && pnpm test -- src/notifications/open.test.ts`
Expected: FAIL nas rotas novas, no contrato OpenAPI (operação sem rota no BFF) e no link de cobrança.

- [ ] **Step 4: Implementar**

`financial-proxy.ts`: trocar `["POST", new RegExp(`^charges/${ID}/proof(?:/review|/complete)?$`)]` por `["POST", new RegExp(`^charges/${ID}/proof(?:/review|/complete|/declaration)?$`)]`.

`public-proof-proxy.ts`: trocar a linha do `allowed` e o comentário por:

```ts
  // The payer's own slot only: reserve (POST), read its state (GET), take it back (DELETE), confirm the bytes landed or declare a payment (POST).
  const allowed = (path === "proof" && ["POST", "GET", "DELETE"].includes(request.method)) || (["proof/complete", "proof/declaration"].includes(path) && request.method === "POST");
```

`mobile/src/financial/client.ts`, depois de `withdrawProof`:

```ts
    declarePayment(id: string) { return request<ChargeDetail>(`charges/${id}/proof/declaration`, { method: "POST" }, "Não foi possível informar o pagamento."); },
```

`mobile/src/notifications/open.ts`: trocar a regex do `pathname` por `/^\/(pay\/[A-Za-z0-9_.-]+|billings\/[0-9a-f-]{36}|charges\/[0-9a-f-]{36})$/`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test -- src/lib`
Expected: PASS (as falhas de fixture de `ChargeProof.kind` em telas são da Task 9).

Run: `cd packages/mobile && pnpm test -- src/notifications/open.test.ts`
Expected: PASS.

- [ ] **Step 6: Parar para o usuário commitar**

---

### Task 9: Web — detalhe da cobrança e cartão de comprovante

**Files:**
- Modify: `packages/web/src/components/app/proof-card.tsx`
- Modify: `packages/web/src/components/screens/charge-detail-screen.tsx`
- Test: `packages/web/src/components/screens/charge-detail-screen.test.tsx` e todas as fixtures de `ChargeProof` no web

**Interfaces:**
- Consumes: `ProofKind`, `canDeclarePayment`, `canWithdrawProof`, `canAcceptProof`, `proofNote` (Task 1); `POST /api/financial/charges/{id}/proof/declaration` (Task 8).
- Produces: `ProofCard` com props novas `onDeclare?: () => void`, `onWithdraw?: () => void`, `onReject?: () => void`.

- [ ] **Step 1: Corrigir fixtures de `ChargeProof`**

Run: `grep -rln "sentByViewer" packages/web/src --include=*.test.tsx`

Em cada arquivo listado, no helper que monta `ChargeProof`, acrescentar `kind: ProofKind.File,` antes de `...overrides` e `ProofKind` ao import de `@receivy/common`.

- [ ] **Step 2: Escrever os testes que falham**

Em `charge-detail-screen.test.tsx`, dentro de `describe("ChargeDetailScreen", …)`:

```tsx
  it("lets the debtor declare a payment and take it back", async () => {
    const declared = charge({
      proofState: ProofState.Pending,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null, sentByViewer: true }),
    });
    serve(charge({ confirmationRequired: true }), {
      "POST /api/financial/charges/charge/proof/declaration": () => Response.json(declared),
    });

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Já paguei" }));
    const dialog = await screen.findByRole("dialog", { name: "Informar pagamento?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Já paguei" }));

    expect(await screen.findByText(/aguardando confirmação de Ana/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anexar comprovante" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver comprovante" })).not.toBeInTheDocument();
  });

  it("lets the creditor confirm or refuse a declared payment with a reason", async () => {
    const declared = charge({
      direction: Direction.Receivable,
      ownedByViewer: true,
      proofState: ProofState.Pending,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null }),
    });
    const refused = { ...declared, proofState: ProofState.Rejected, proof: proof({ kind: ProofKind.Declaration, file: null, state: ProofState.Rejected, reason: "Não caiu" }) };
    serve(declared, { "POST /api/financial/charges/charge/proof/review": () => Response.json(refused) });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText(/Ana informou que pagou/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar recebimento" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Não recebi" }));
    const dialog = await screen.findByRole("dialog", { name: "Não recebeu o pagamento?" });
    fireEvent.change(within(dialog).getByLabelText("Motivo (opcional)"), { target: { value: "Não caiu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Não recebi" }));

    await waitFor(() =>
      expect(browserFetch).toHaveBeenCalledWith(
        "/api/financial/charges/charge/proof/review",
        expect.objectContaining({ body: JSON.stringify({ decision: "rejected", reason: "Não caiu" }) }),
      ),
    );
  });
```

Acrescentar `ProofKind` ao import de `@receivy/common` do arquivo.

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd packages/web && npx vitest run --pool=forks src/components/screens/charge-detail-screen.test.tsx`
Expected: FAIL — não existe "Já paguei" nem o cartão de pagamento informado.

- [ ] **Step 4: Cartão de comprovante**

Em `proof-card.tsx`:

1. Import de `@receivy/common`: `canAcceptProof, canDeclarePayment, canMarkPaid, canUploadProof, canWithdrawProof, fileSizeText, momentText, proofNote, proofStateLabel, ProofKind, ProofState, type ChargeDetail`.
2. Constantes, depois de `DROPZONE`:

```tsx
const OUTLINE_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-outline/50 text-xs font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-50";
const PRIMARY_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50";
```

3. Em `ProofCardProps`, depois de `onAccept: () => void;`:

```tsx
  /** The paying side says it already paid, without a file. */
  onDeclare?: () => void;
  /** The sender takes back what nobody answered yet. */
  onWithdraw?: () => void;
  /** Whoever collects says the declared payment did not arrive. */
  onReject?: () => void;
```

4. Na assinatura de `ProofCard`, desestruturar também `onDeclare, onWithdraw, onReject`, e logo depois de `const settle = canMarkPaid(charge);`:

```tsx
  const declare = canDeclarePayment(charge) && !!onDeclare;
```

5. No ramo `if (!proof)`, depois do bloco `{upload ? (…) : (…)}`:

```tsx
        {declare && (
          <button type="button" disabled={busy} onClick={onDeclare} className={OUTLINE_BUTTON}>
            <Check size={16} aria-hidden="true" />
            Já paguei
          </button>
        )}
```

6. Logo depois do fechamento do ramo `if (!proof) {…}`:

```tsx
  if (proof.kind === ProofKind.Declaration) {
    const state = proofStateLabel(proof);
    const note = proofNote(charge);
    const answer = canAcceptProof(charge);
    const withdraw = canWithdrawProof(charge) && !!onWithdraw;
    const sent = momentText(proof.sentAt);
    const waiting = proof.state === ProofState.Pending;
    const line = proof.sentByViewer
      ? `Informado em ${sent}${waiting ? ` · aguardando confirmação de ${charge.counterpartName}` : ""}`
      : `${charge.counterpartName} informou que pagou em ${sent}, sem comprovante`;

    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Receipt size={20} aria-hidden="true" className="text-primary-strong" />
            <h2 className="m-0 text-base font-bold text-ink">Pagamento informado</h2>
          </div>
          <StatusTag label={state.label} tone={state.tone} />
        </div>

        <p className="m-0 text-sm leading-5 text-ink">{line}</p>

        {note && <p className="m-0 text-xs leading-4 text-muted">{note}</p>}

        {upload && picked && <PickedPreview file={picked} url={previewUrl} busy={busy} sending={sending} onPick={pick} onSend={onSend} />}

        <div className="flex flex-wrap gap-2">
          {withdraw && (
            <button type="button" disabled={busy} onClick={onWithdraw} className={OUTLINE_BUTTON}>
              Desfazer
            </button>
          )}
          {declare && (
            <button type="button" disabled={busy} onClick={onDeclare} className={OUTLINE_BUTTON}>
              Informar de novo
            </button>
          )}
          {upload && !picked && <FilePicker label="Anexar comprovante" disabled={busy} onPick={pick} className={PRIMARY_BUTTON} />}
          {answer && onReject && (
            <button type="button" disabled={busy} onClick={onReject} className={OUTLINE_BUTTON}>
              Não recebi
            </button>
          )}
          {answer && (
            <button type="button" disabled={busy} onClick={onAccept} className={PRIMARY_BUTTON}>
              <Check size={16} aria-hidden="true" />
              Confirmar recebimento
            </button>
          )}
        </div>
      </section>
    );
  }
```

7. No ramo de arquivo (o `return` final), dentro do `<div className="flex gap-2">` dos botões, antes do `{settle && (…)}`:

```tsx
        {declare && (
          <button type="button" disabled={busy} onClick={onDeclare} className={OUTLINE_BUTTON}>
            Já paguei
          </button>
        )}
```

e trocar `proof.file.mime`/`proof.file.name`/`proof.file.size` por `proof.file!.mime`/`proof.file!.name`/`proof.file!.size` (o ramo de declaração já saiu antes, então aqui sempre há arquivo).

- [ ] **Step 5: Tela de detalhe**

Em `charge-detail-screen.tsx`:

1. Import de `@receivy/common`: acrescentar `canDeclarePayment` e `ProofKind`.
2. Estados, depois de `confirmPaid`:

```tsx
  const [confirmDeclare, setConfirmDeclare] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
```

3. Funções, depois de `markPaid`:

```tsx
  async function declare() {
    await run(async () => {
      setCharge(await request<ChargeDetail>(`${base}/proof/declaration`, { method: "POST" }, "Não foi possível informar o pagamento."));
      setConfirmDeclare(false);
      setNotice("Pagamento informado. Aguarde a confirmação.");
    }, "Não foi possível informar o pagamento.");
  }

  async function withdraw() {
    await run(async () => {
      await request<void>(`${base}/proof`, { method: "DELETE" }, "Não foi possível desfazer.");
      setCharge(await request<ChargeDetail>(base));
      setNotice("Pagamento informado desfeito.");
    }, "Não foi possível desfazer.");
  }

  async function reject() {
    await run(async () => {
      const body = { decision: "rejected", ...(reason.trim() ? { reason: reason.trim() } : {}) };

      setCharge(await request<ChargeDetail>(`${base}/proof/review`, jsonInit("POST", body), "Não foi possível responder."));
      setRejecting(false);
      setReason("");
      setNotice("Resposta enviada.");
    }, "Não foi possível responder.");
  }
```

4. Depois de `const uploadAllowed = canUploadProof(charge);`:

```tsx
  const declaration = proof?.kind === ProofKind.Declaration;
```

e trocar `footerLabel` por:

```tsx
  const footerLabel = uploadAllowed ? (proof && !declaration ? "Enviar novo comprovante" : "Enviar comprovante") : "Ver comprovante enviado";
```

5. No tile "Comprovante" das ações rápidas, trocar a condição `(!receivable || ownBill) && proof` por `(!receivable || ownBill) && proof && !declaration`.

6. No `<ProofCard …/>`, acrescentar:

```tsx
            onDeclare={canDeclarePayment(charge) ? () => setConfirmDeclare(true) : undefined}
            onWithdraw={() => void withdraw()}
            onReject={() => setRejecting(true)}
```

7. No rodapé, trocar `{pending && !markable && (uploadAllowed || proof) && (` por `{pending && !markable && (uploadAllowed || (proof && !declaration)) && (`.

8. Depois do diálogo `confirmPaid`:

```tsx
      {confirmDeclare && (
        <ConfirmDialog
          title="Informar pagamento?"
          icon={Check}
          tone="primary"
          explanation={`${charge.counterpartName} vai receber um aviso para confirmar o recebimento.`}
          confirmLabel="Já paguei"
          busy={busy}
          onConfirm={() => void declare()}
          onCancel={() => setConfirmDeclare(false)}
        />
      )}

      {rejecting && (
        <ConfirmDialog
          title="Não recebeu o pagamento?"
          icon={CircleStop}
          explanation="A cobrança volta a ficar pendente e a pessoa recebe o motivo."
          detail={
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
              Motivo (opcional)
              <textarea
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                className="rounded-xl border border-outline bg-surface p-3 text-sm font-normal text-ink"
              />
            </label>
          }
          confirmLabel="Não recebi"
          busy={busy}
          onConfirm={() => void reject()}
          onCancel={() => setRejecting(false)}
        />
      )}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: PASS em todos os arquivos.

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 10: Web — feed e link público

**Files:**
- Modify: `packages/web/src/components/screens/feed-screen.tsx` (`ChargeCard`, `FeedScreen`)
- Modify: `packages/web/src/components/app/proof-panel.tsx`
- Modify: `packages/web/src/app/pay/[token]/page.tsx`
- Test: `packages/web/src/components/screens/feed-screen.test.tsx`, `packages/web/src/components/app/proof-panel.test.tsx`

**Interfaces:**
- Consumes: `ChargeActionKind.DeclarePayment`, `PublicProofState.kind` (Task 1); rotas do BFF (Task 8).
- Produces: `ProofPanel` com prop nova `creditor?: string`.

- [ ] **Step 1: Escrever os testes que falham**

Em `feed-screen.test.tsx`, depois do teste `"marks the owner's own bill without Pix as paid after confirming and reloads the feed"`:

```tsx
  it("declares the owner's own bill to a payee who confirms instead of settling it", async () => {
    vi.mocked(browserFetch).mockImplementation(async (path, init) => {
      if (path === BASE) {
        return Response.json({
          summary,
          items: [charge({ id: "charge-6", description: "Aluguel", payer: "owner", ownedByViewer: true, hasPix: false, confirmationRequired: true })],
          nextCursor: null,
        });
      }
      if (path === "/api/financial/charges/charge-6/proof/declaration" && (init as RequestInit | undefined)?.method === "POST") {
        return Response.json({});
      }
      throw new Error(`unexpected ${String(path)}`);
    });
    render(<FeedScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Marcar pago" }));
    const dialog = await screen.findByRole("dialog", { name: "Marcar como pago?" });
    expect(within(dialog).getByText("Maria vai receber um aviso para confirmar o recebimento.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Marcar pago" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("/api/financial/charges/charge-6/proof/declaration", { method: "POST" }));
    expect(browserFetch).not.toHaveBeenCalledWith("/api/financial/charges/charge-6/pay", expect.anything());
  });
```

No tipo `ChargeOverrides` do mesmo arquivo, acrescentar `confirmationRequired?: boolean;`. Garantir `waitFor` no import de `@testing-library/react`.

Em `proof-panel.test.tsx`, ao final:

```tsx
it("declares a payment without a file and lets the payer take it back", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "POST" && url === `${STATUS}/declaration`) return Response.json({ state: "pending", kind: "declaration", reason: null, file: null });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return empty();
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} creditor="Ana" />);
  fireEvent.click(await screen.findByRole("button", { name: "Já paguei e não tenho comprovante" }));
  expect(await screen.findByText("Pagamento informado · aguardando confirmação de Ana.")).toBeTruthy();
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Já paguei e não tenho comprovante" })).toBeTruthy());
  expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/web && npx vitest run --pool=forks src/components/screens/feed-screen.test.tsx src/components/app/proof-panel.test.tsx`
Expected: FAIL — o feed chama `/pay` e o painel não tem "Já paguei e não tenho comprovante".

- [ ] **Step 3: Feed**

Em `feed-screen.tsx`, no `ChargeCard`:

1. Acrescentar a prop `onDeclare: () => void;` ao tipo e à desestruturação.
2. Estado: `const [confirmDeclare, setConfirmDeclare] = useState(false);`
3. Depois do bloco `{action?.kind === ChargeActionKind.MarkPaid && (…)}`:

```tsx
      {action?.kind === ChargeActionKind.DeclarePayment && (
        <button
          type="button"
          onClick={() => setConfirmDeclare(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-success-soft px-2.5 text-[11.5px] font-extrabold text-success md:h-10 md:rounded-xl md:px-3.5 md:text-[13px] md:font-bold"
        >
          <Check size={15} aria-hidden="true" className="hidden md:block" />
          {action.label}
        </button>
      )}
```

4. Depois do diálogo `confirmPaid`:

```tsx
      {confirmDeclare && (
        <ConfirmDialog
          title="Marcar como pago?"
          icon={Check}
          tone="primary"
          explanation={`${charge.counterpartName} vai receber um aviso para confirmar o recebimento.`}
          confirmLabel="Marcar pago"
          onConfirm={() => {
            setConfirmDeclare(false);
            onDeclare();
          }}
          onCancel={() => setConfirmDeclare(false)}
        />
      )}
```

No `FeedScreen`, depois de `markPaid`:

```tsx
  async function declare(chargeId: string) {
    try {
      const response = await browserFetch(`/api/financial/charges/${chargeId}/proof/declaration`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, PAY_ERROR));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : PAY_ERROR);
      return;
    }

    // The card turns Em análise, so the feed reloads on the current filters.
    await load();
  }
```

e no `<ChargeCard …/>` renderizado: `onDeclare={() => void declare(item.charge.id)}`.

- [ ] **Step 4: Painel público**

Em `proof-panel.tsx`:

1. Assinatura: `export function ProofPanel({ base, state, uploadsEnabled = true, onChanged, creditor = "quem cobra" }: { base: string; state: ChargeState; uploadsEnabled?: boolean; onChanged?: () => void; creditor?: string; })`.
2. Depois de `withdraw`:

```tsx
  /** The payer already paid and has no file: the charge waits for the creditor, and a file may still follow. */
  async function declare() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${base}/proof/declaration`, { method: "POST" });
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível informar o pagamento."));
      showStatus(await response.json() as PublicProofState);
      onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível informar o pagamento.");
    } finally { setBusy(false); }
  }
```

3. Trocar as linhas de `effectiveState` e `pending` por:

```tsx
  const effectiveState = status?.state === "accepted" ? "paid" : state;
  const declared = status?.state === "pending" && status.kind === "declaration";
  // A declaration keeps the dropzone: the payer may still attach the file.
  const pending = !declared && (status?.state === "pending" || (!uploadsEnabled && status?.state !== "rejected"));
```

4. Trocar o parágrafo de rejeição por:

```tsx
      {status?.state === "rejected" && (
        <p className={HINT}>
          {status.kind === "declaration" ? "Pagamento não identificado" : "Comprovante rejeitado"}
          {status.reason ? `: ${status.reason}.` : "."} Você pode {status.kind === "declaration" ? "informar de novo ou enviar um comprovante." : "enviar outro arquivo."}
        </p>
      )}
```

5. No ramo final (upload), trocar o parágrafo `HINT` inicial por:

```tsx
          {declared ? (
            <div className="flex flex-col gap-2 rounded-xl bg-primary-soft/40 p-3">
              <p role="status" className="m-0 text-sm font-semibold text-primary-strong">Pagamento informado · aguardando confirmação de {creditor}.</p>
              <button type="button" disabled={busy} onClick={() => void withdraw()} className={DANGER_BUTTON}>
                Desfazer
              </button>
            </div>
          ) : (
            <p className={HINT}>Envie JPG, PNG ou PDF de até 10 MB. O credor confirmará o pagamento após revisar.</p>
          )}
```

e, logo depois do botão `PRIMARY_BUTTON` ("Enviar comprovante"):

```tsx
          {!declared && (
            <button type="button" disabled={busy} onClick={() => void declare()} className="self-center text-[12.5px] font-semibold text-primary disabled:opacity-50">
              Já paguei e não tenho comprovante
            </button>
          )}
```

- [ ] **Step 5: Página pública**

Em `app/pay/[token]/page.tsx`, no `<ProofPanel …/>`, acrescentar `creditor={charge.creditorFirstName}`.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: PASS.

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 11: Mobile — detalhe, cartão de comprovante e feed

**Files:**
- Create: `packages/mobile/src/components/app/reject-reason-sheet.tsx`
- Modify: `packages/mobile/src/components/app/proof-card.tsx`
- Modify: `packages/mobile/src/components/screens/charge-detail-screen.tsx`
- Modify: `packages/mobile/src/components/screens/feed-screen.tsx`
- Test: `packages/mobile/src/components/screens/charge-detail-screen.test.tsx`, `packages/mobile/src/components/screens/feed-screen.test.tsx` e fixtures de `ChargeProof`

**Interfaces:**
- Consumes: regras da Task 1; `financialClient.declarePayment` (Task 8).
- Produces:
  - `RejectReasonSheet({ visible, busy, onCancel, onConfirm }: { visible: boolean; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void })`
  - `ProofCard` com props novas `onDeclare?: () => void`, `onReject?: () => void`

- [ ] **Step 1: Corrigir fixtures de `ChargeProof`**

Run: `grep -rln "sentByViewer" packages/mobile/src --include=*.test.tsx`

Em cada helper que monta `ChargeProof`, acrescentar `kind: ProofKind.File,` antes de `...overrides` e `ProofKind` ao import de `@receivy/common`.

- [ ] **Step 2: Escrever os testes que falham**

Em `charge-detail-screen.test.tsx`, dentro de `describe("ChargeDetailScreen", …)`:

```tsx
  it("lets the debtor declare a payment after confirming", async () => {
    const declared = charge({ proofState: ProofState.Pending, proofKind: ProofKind.Declaration, proof: proof({ kind: ProofKind.Declaration, file: null }) });
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ confirmationRequired: true })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      declarePayment: jest.fn().mockResolvedValue(declared),
      startProofUpload: jest.fn(),
      completeProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
      withdrawProof: jest.fn(),
    };
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Já paguei")?.onPress?.());

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Já paguei" }));

    expect(Alert.alert).toHaveBeenCalledWith("Informar pagamento?", "Ana vai receber um aviso para confirmar o recebimento.", expect.any(Array));
    expect(client.declarePayment).toHaveBeenCalledWith("charge");
    expect(await screen.findByText(/aguardando confirmação de Ana/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeOnTheScreen();
  });

  it("lets the creditor refuse a declared payment with a reason", async () => {
    const declared = charge({
      direction: Direction.Receivable,
      ownedByViewer: true,
      proofState: ProofState.Pending,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null, sentByViewer: false }),
    });
    const client = {
      charge: jest.fn().mockResolvedValue(declared),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      completeProofUpload: jest.fn(),
      reviewProof: jest.fn().mockResolvedValue(declared),
      downloadProof: jest.fn(),
      withdrawProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText(/Ana informou que pagou/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Confirmar recebimento" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Não recebi" }));
    await fireEvent.changeText(screen.getByLabelText("Motivo opcional"), "Não caiu");
    await fireEvent.press(screen.getAllByRole("button", { name: "Não recebi" }).at(-1)!);

    expect(client.reviewProof).toHaveBeenCalledWith("charge", "rejected", "Não caiu");
  });
```

Em `feed-screen.test.tsx`, depois do teste `"marks the owner's own bill without Pix as paid after confirming and reloads quietly"`, usando o mesmo helper de render que esse teste usa:

```tsx
  it("declares the owner's own bill to a payee who confirms", async () => {
    const own = charge({ id: "own", description: "Aluguel", payer: ChargePayer.Owner, ownedByViewer: true, hasPix: false, confirmationRequired: true });
    const timeline = jest.fn().mockResolvedValue(page([item(own, Direction.Payable)]));
    const declarePayment = jest.fn().mockResolvedValue({});
    const pay = jest.fn();
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar pago")?.onPress?.());

    await renderFeed(<FeedScreen client={{ timeline, pay, declarePayment }} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Marcar pago" }));

    expect(Alert.alert).toHaveBeenCalledWith("Marcar como pago?", "Maria vai receber um aviso para confirmar o recebimento.", expect.any(Array));
    expect(declarePayment).toHaveBeenCalledWith("own");
    expect(pay).not.toHaveBeenCalled();
  });
```

Acrescentar `ProofKind` ao import de `@receivy/common` onde faltar.

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd packages/mobile && pnpm test -- src/components/screens/charge-detail-screen.test.tsx src/components/screens/feed-screen.test.tsx`
Expected: FAIL — não há "Já paguei", "Não recebi" nem a ação de declaração no feed.

- [ ] **Step 4: Folha de motivo**

Criar `components/app/reject-reason-sheet.tsx`:

```tsx
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

type RejectReasonSheetProps = {
  visible: boolean;
  busy: boolean;
  onCancel: () => void;
  /** The trimmed reason; empty when the creditor gave none. */
  onConfirm: (reason: string) => void;
};

/** "Não recebi": the charge goes back to pending and the payer reads the optional reason. */
export function RejectReasonSheet({ visible, busy, onCancel, onConfirm }: RejectReasonSheetProps) {
  const colors = useThemeColors();
  const [reason, setReason] = useState("");

  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-scrim px-6">
        <View className="w-full gap-4 rounded-3xl bg-surface p-6">
          <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
            Não recebeu o pagamento?
          </Text>
          <Text className="leading-5 text-muted">A cobrança volta a ficar pendente e a pessoa recebe o motivo.</Text>
          <TextInput
            accessibilityLabel="Motivo opcional"
            value={reason}
            maxLength={500}
            multiline
            onChangeText={setReason}
            placeholder="Motivo (opcional)"
            placeholderTextColor={colors.muted}
            className="min-h-20 rounded-xl border border-outline bg-canvas p-3 text-[16px] tracking-normal text-ink"
          />
          <View className="flex-row gap-3">
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={onCancel} className="min-h-12 flex-1 items-center justify-center rounded-xl border border-outline">
              <Text className="font-bold text-primary">Voltar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Não recebi"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onConfirm(reason.trim())}
              className="min-h-12 flex-1 items-center justify-center rounded-xl bg-danger-solid"
            >
              <Text className="font-bold text-on-danger">Não recebi</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 5: Cartão de comprovante**

Em `components/app/proof-card.tsx`:

1. Import de `@receivy/common`: `canAcceptProof, canDeclarePayment, canMarkPaid, canUploadProof, canWithdrawProof, fileSizeText, momentText, proofNote, proofStateLabel, ProofKind, ProofState, type ChargeDetail`.
2. Em `ProofCardProps`, depois de `onWithdraw?`:

```tsx
  /** The paying side says it already paid, without a file. */
  onDeclare?: () => void;
  /** Whoever collects says the declared payment did not arrive. */
  onReject?: () => void;
```

3. Depois de `UploadButton`:

```tsx
function CardButton({ label, primary = false, disabled, onPress }: { label: string; primary?: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 flex-1 items-center justify-center rounded-xl px-3 ${primary ? "bg-primary" : "border border-outline/50"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`text-xs font-semibold ${primary ? "text-on-primary" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
```

4. Em `ProofCard`, desestruturar `onDeclare, onReject` e, depois de `const withdraw = …`:

```tsx
  const declare = canDeclarePayment(charge) && !!onDeclare;
```

5. No ramo `if (!proof)`, depois do bloco `{upload ? (…) : (…)}`: `{declare && <CardButton label="Já paguei" disabled={busy} onPress={onDeclare!} />}`.

6. Logo depois do ramo `if (!proof) {…}`:

```tsx
  if (proof.kind === ProofKind.Declaration) {
    const state = proofStateLabel(proof);
    const note = proofNote(charge);
    const answer = canAcceptProof(charge);
    const sent = momentText(proof.sentAt);
    const line = proof.sentByViewer
      ? `Informado em ${sent}${proof.state === ProofState.Pending ? ` · aguardando confirmação de ${charge.counterpartName}` : ""}`
      : `${charge.counterpartName} informou que pagou em ${sent}, sem comprovante`;

    return (
      <View className="gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            <Image source={ICONS.receipt} tintColor={colors.primaryStrong} style={{ width: 20, height: 20 }} />
            <Text accessibilityRole="header" className="text-base font-bold text-ink">
              Pagamento informado
            </Text>
          </View>
          <StatusTag label={state.label} tone={state.tone} />
        </View>

        <Text className="text-sm leading-5 text-ink">{line}</Text>
        {note && <Text className="text-xs leading-4 text-muted">{note}</Text>}

        <View className="flex-row flex-wrap gap-2">
          {withdraw && <CardButton label="Desfazer" disabled={busy} onPress={onWithdraw!} />}
          {declare && <CardButton label="Informar de novo" disabled={busy} onPress={onDeclare!} />}
          {upload && <CardButton label="Anexar comprovante" primary disabled={busy} onPress={onUpload} />}
          {answer && onReject && <CardButton label="Não recebi" disabled={busy} onPress={onReject} />}
          {answer && <CardButton label="Confirmar recebimento" primary disabled={busy} onPress={onAccept} />}
        </View>
      </View>
    );
  }
```

7. No ramo de arquivo, trocar `proof.file.mime`/`proof.file.name`/`proof.file.size` por `proof.file!.…`, e antes do bloco `{secondary && (…)}` acrescentar `{declare && <CardButton label="Já paguei" disabled={busy} onPress={onDeclare!} />}`.

- [ ] **Step 6: Tela de detalhe**

Em `screens/charge-detail-screen.tsx`:

1. Imports: `canDeclarePayment` e `ProofKind` de `@receivy/common`; `import { RejectReasonSheet } from "@/components/app/reject-reason-sheet";`.
2. Tipo `Client`: acrescentar `"declarePayment"` ao `Pick` dentro do `Partial<…>`.
3. Estado: `const [rejecting, setRejecting] = useState(false);`
4. Funções, depois de `confirmPaid`:

```tsx
  function confirmDeclare(detail: ChargeDetail) {
    Alert.alert("Informar pagamento?", `${detail.counterpartName} vai receber um aviso para confirmar o recebimento.`, [
      { text: "Voltar", style: "cancel" },
      { text: "Já paguei", onPress: () => void declare() },
    ]);
  }

  async function declare() {
    if (!client.declarePayment) {
      return;
    }

    const detail = await run(() => client.declarePayment!(id), "Não foi possível informar o pagamento.");

    if (!detail) {
      return;
    }

    setCharge(detail);
    setNotice("Pagamento informado. Aguarde a confirmação.");
  }

  async function rejectDeclaration(reason: string) {
    if (!client.reviewProof) {
      return;
    }

    const detail = await run(() => client.reviewProof!(id, "rejected", reason || undefined), "Não foi possível responder.");

    setRejecting(false);

    if (!detail) {
      return;
    }

    setCharge(detail);
    setNotice("Resposta enviada.");
  }
```

5. Em `withdrawProof`, antes do `run`: `const wasDeclaration = charge?.proof?.kind === ProofKind.Declaration;` e trocar o `setNotice(…)` final por `setNotice(wasDeclaration ? "Pagamento informado desfeito." : "Comprovante apagado. Envie outro quando quiser.");`.
6. Depois de `const uploadProofAllowed = canUploadProof(charge);`: `const viewable = proof?.kind === ProofKind.File;`
7. Trocar `proofTile` por `const proofTile = proofsEnabled && (!receivable || (charge.payer === "owner" && viewable));` e, no `ActionTile` do comprovante, trocar `proof ?` por `viewable ?` nas três ocorrências (`label`, `icon`, `hint`, `onPress`).
8. No `<ProofCard …/>`, acrescentar:

```tsx
            onDeclare={client.declarePayment ? () => confirmDeclare(charge) : undefined}
            onReject={() => setRejecting(true)}
```

9. No rodapé, trocar `(uploadProofAllowed || proof)` por `(uploadProofAllowed || viewable)` e, nos dois textos, `proof ? "Enviar novo comprovante"` por `viewable ? "Enviar novo comprovante"`.
10. Antes de `{notice ? <Toast … /> : null}`:

```tsx
      <RejectReasonSheet visible={rejecting} busy={busy} onCancel={() => setRejecting(false)} onConfirm={(reason) => void rejectDeclaration(reason)} />
```

- [ ] **Step 7: Feed**

Em `screens/feed-screen.tsx`:

1. `FeedScreenProps.client`: `Pick<FinancialClient, "timeline"> & Partial<Pick<FinancialClient, "pay" | "declarePayment">>`.
2. `ChargeRowProps`: acrescentar `onDeclare: () => void;` e desestruturar em `ChargeRow`.
3. Em `ChargeRow`, depois do bloco `MarkPaid`:

```tsx
      {action?.kind === ChargeActionKind.DeclarePayment && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={onDeclare}
          className="h-[30px] justify-center rounded-[9px] bg-success-soft px-2.5"
        >
          <Text className="font-sans text-[11.5px] font-extrabold text-success">{action.label}</Text>
        </Pressable>
      )}
```

4. Em `FeedScreen`, depois de `markPaid`:

```tsx
  function confirmDeclare(charge: ChargeSummary) {
    Alert.alert("Marcar como pago?", `${charge.counterpartName} vai receber um aviso para confirmar o recebimento.`, [
      { text: "Voltar", style: "cancel" },
      { text: "Marcar pago", onPress: () => void declare(charge.id) },
    ]);
  }

  async function declare(chargeId: string) {
    if (!client.declarePayment) {
      return;
    }

    try {
      await client.declarePayment(chargeId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível informar o pagamento.");
      return;
    }

    // The row turns Em análise: a quiet reload keeps the list on screen meanwhile.
    await load(undefined, undefined, true);
  }
```

5. No `<ChargeRow …/>`: `onDeclare={() => confirmDeclare(item.charge)}`.

- [ ] **Step 8: Rodar e ver passar**

Run: `cd packages/mobile && npx tsc --noEmit -p tsconfig.json && pnpm lint && pnpm test`
Expected: PASS em todas as suítes.

- [ ] **Step 9: Parar para o usuário commitar**

---

### Task 12: Documentação, roteiro de QA e seed

**Files:**
- Modify: `docs/notifications.md`
- Modify: `docs/api-errors.md`
- Modify: `docs/manual-qa-script.md` (seção 6)
- Modify: `packages/api/scripts/seed-local.mjs`

**Interfaces:**
- Consumes: tudo das Tasks 1–11 (sem código novo de produção).

- [ ] **Step 1: `docs/notifications.md`**

Depois do parágrafo `## Channels and the follow-up rule` (antes de `## Local`), acrescentar:

```md
## Charges under review

A charge is under review while `proof_state = 'pending'`, whether the payer sent a file (`proof_kind = 'file'`)
or declared the payment without one (`proof_kind = 'declaration'`). Nothing chases it meanwhile:
`sendChargeNotice` records `notice.skipped { reason: 'in_review' }` for the initial notice, reminders, the
follow-up and the manual reminder; `planReminders` does not arm it; `POST /charges/{id}/reminders` answers 409
`CHARGE_IN_REVIEW`. Reminders whose day passed during the review are not sent later.

Payment notices are push only (`notifications/services/payment-notices.ts`), fired by the endpoints after the
action commits and never retried:

| When | To | Title |
| --- | --- | --- |
| `POST /charges/{id}/proof/declaration` (or the public one) | whoever answers: the owner of a conta a receber, the payee of a conta a pagar | Pagamento informado |
| `POST /charges/{id}/proof/complete` (or the public one) | the same | Comprovante recebido |
| review accepted, or `pay` answering what was under review | whoever paid | Pagamento confirmado |
| review rejected | whoever paid | Pagamento não identificado |

Each push opens `<PUBLIC_WEB_ORIGIN>/charges/<id>` and is recorded once per submission as
`notice.payment { key, notice }`.
```

- [ ] **Step 2: `docs/api-errors.md`**

Na tabela de status, acrescentar a linha `| 403 | `ForbiddenError` subclasses | the screen's own fallback (`apiErrorMessage` shows `message` only on 409/422/429) |` depois da linha `401 / 403 / 404`, e ao final do arquivo:

```md
## Payment review errors

| Code | Status | When |
|---|---|---|
| `CHARGE_IN_REVIEW` | 409 | declaring a payment, or `POST /charges/{id}/reminders`, while a file or a declaration waits for an answer |
| `PROOF_DECLARATION_FORBIDDEN` | 403 | declaring from the collecting side; declaring or `pay` by the owner of a conta a pagar when the payee can (declare) or cannot (pay) confirm |
```

- [ ] **Step 3: `docs/manual-qa-script.md`**

No fim da seção `## 6. Cobrança do Bruno — link público e comprovante`, antes de `## 7.`:

```md
Pagamento informado sem comprovante:

- [ ] Nova cobrança para o Bruno. Janela anônima: abrir o link e tocar em "Já paguei e não tenho comprovante". Esperado: "Pagamento informado · aguardando confirmação de Ana"; dropzone continua disponível.
- [ ] Como Ana: feed mostra "Em análise" e o selo "Pagamento informado", sem "Lembrar". `Lembrar` via curl devolve 409 `CHARGE_IN_REVIEW`.
- [ ] Ana abre a cobrança: "Bruno informou que pagou…". Tocar "Não recebi" com motivo "Não caiu". Esperado: volta a pendente; a página pública mostra "Pagamento não identificado: Não caiu."
- [ ] Anônimo informa de novo e anexa um PDF. Esperado: vira "Comprovante enviado"; Ana confirma e a cobrança fica paga (`charge.paid { via: 'proof' }`).
- [ ] Conta a pagar da Ana para a Carla (Carla com conta ativa): "Marcar pago" abre "Marcar como pago?" e deixa em análise; Carla confirma no app dela. Com recebedor que nunca entrou, "Marcar pago" marca paga direto.
```

- [ ] **Step 4: Seed**

Em `packages/api/scripts/seed-local.mjs`:

1. No objeto `charge` montado dentro do laço, depois de `proof_state: proof,`: `proof_kind: null,`.
2. Trocar a linha `const proof = outcome.startsWith('proof_') ? outcome.slice('proof_'.length) : null;` por:

```js
        const declared = outcome === 'declared';
        const proof = declared ? 'pending' : outcome.startsWith('proof_') ? outcome.slice('proof_'.length) : null;
```

3. Trocar `if (proof) {` (o bloco que gera o PDF) por `if (proof && !declared) {` e, dentro do `Object.assign(charge, {…})` desse bloco, acrescentar `proof_kind: 'file',`.
4. Logo depois desse bloco:

```js
        if (declared) {
          // A payment declared without a file: the owner answers it; accounts nobody signed into used the public link.
          const senderId = PEOPLE[debtor.person]?.status === 'active' ? userIdOf(debtor.person) : null;
          const sentAt = later(createdAtCharge, instant(earlier(dueDate, today), 9));

          Object.assign(charge, {
            proof_kind: 'declaration',
            proof_sender_user_id: senderId,
            proof_actor_hash: sha256(senderId ? `user:${senderId}` : `link:${chargeId}`),
            proof_sent_at: sentAt
          });
          event('proof.declared', 'charge', chargeId, senderId, {}, sentAt);
        }
```

5. Na conta `mercado`, trocar `outcome: ({ person }) => (person === 'rafa' ? 'proof_pending' : 'pending')` por `outcome: ({ person }) => (person === 'rafa' ? 'proof_pending' : 'declared')`.

- [ ] **Step 5: Verificar**

Run: `cd packages/api && npx biome check scripts/seed-local.mjs && node --env-file=local.env scripts/seed-local.mjs seed-check@example.test --dry-run`
Expected: Biome limpo; o dry-run conclui sem erro de constraint (requer a coluna `proof_kind` no banco local, criada pelo usuário na Task 2).

Run: `pnpm --filter @receivy/api openapi:check`
Expected: "OpenAPI matches reflected routes and schemas."

- [ ] **Step 6: Parar para o usuário commitar**

---

## Self-review

- **Cobertura da spec:** dados e contrato (Tasks 1–3), rotas e erros (2, 4, 5), bloqueio de notificações (6), pushes (7), BFF/OpenAPI/deep link (8), UI web (9–10) e mobile (11), documentação e seed (12). Fora de escopo mantido: filtro "Em análise", totais do resumo, reenvio de lembretes perdidos, e-mail para quem pagou pelo link.
- **Diferenças registradas na spec:** códigos de erro em maiúsculas; push de arquivo enviado sai da conclusão do upload, não do evento do bucket.
- **Mudança de comportamento existente:** `pay` com comprovante pendente agora aceita o comprovante (Task 5 reescreve o teste que garantia o contrário).
- **Nomes conferidos entre tarefas:** `ProofKind`, `chargeInReview`, `canDeclarePayment`, `ChargeActionKind.DeclarePayment`, `ChargeRepository.proofKind`, `ChargeRepository.confirmationRequired`, `ProofRepository.declare`, `PaymentNotice`, `pushPaymentNotice`, `paymentNoticeContext`, `declarePayment` (cliente mobile), `RejectReasonSheet`.
