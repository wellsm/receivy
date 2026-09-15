# Sem avisos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem cobra desliga os avisos automáticos de um participante (na conta) ou de uma cobrança ("Não notificar"), sem perder o "Lembrar" manual nem os pushes de pagamento da parte A.

**Architecture:** `allocations.silenced` guarda o padrão do participante e é copiado para cada cobrança criada para ele dentro de `persistChargePlan` (criação, processamento mensal, edição, convite); `charges.silenced` é o único valor que o gate de envio lê. Duas rotas `PUT` gravam o valor (participante: allocation + pendentes; cobrança: só ela) e registram eventos; `sendChargeNotice` ganha o gate `silenced` logo depois do gate `in_review` da parte A, com exceção do canal `'both'` (manual). Web e mobile mostram a chave no formulário, o selo "Sem avisos" e as ações nos detalhes da conta e da cobrança.

**Tech Stack:** EZ4 0.52 (API, `node:test` + `DatabaseTester` em `receivy_tests`), `@receivy/common` (vitest), Next 16 + Tailwind (web, vitest), Expo + Uniwind (mobile, jest/RNTL).

**Spec:** `docs/superpowers/specs/2026-09-15-sem-avisos-design.md`

## Global Constraints

- Nunca commitar, nunca rodar migração, nunca deploy: cada tarefa termina em "parar para o usuário commitar".
- Sem dependência nova.
- Código, identificadores e comentários em inglês; textos de UI em pt-BR, exatamente como escritos aqui (copiados da spec).
- API: repositórios em `export namespace`, helpers privados fora do namespace, contexto desestruturado nos handlers, `const enum` comparado por membro (nunca por literal).
- Código de erro novo: `SILENCE_UNAVAILABLE` (409), classe `SilenceUnavailableError` em `packages/api/src/charges/errors.ts`, usada pelas duas rotas.
- Toda variável nova de provider EZ4: `Environment.VariableOrValue<'NOME', 'literal'>` e entrada em `ez4.project.js`. Este plano não cria nenhuma.
- Repositórios não importam serviços de notificação novos (o teste `src/import-cycles.test.ts` barra ciclos).
- Nunca rodar `biome check --write`, `biome lint --fix` ou `biome --write` amplo: o safe fix `noConstEnum` transforma os `const enum` do projeto em `enum`. Formatar só os arquivos tocados com `npx biome format --write <arquivo>`. Se `biome check <arquivo>` acusar só ordem de import, mover o especificador para onde o diff do diagnóstico mostra, à mão.
- Diálogo ou sheet com entrada transitória zera o estado no cancelar e no confirmar.
- Sem one-liners densos nem ternários empilhados; sem hooks depois de early return.
- Antes de encerrar cada tarefa: lint e typecheck do pacote tocado.
- Comandos de verificação:
  - common: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
  - api: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
  - web: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
  - mobile: `cd packages/mobile && npx tsc --noEmit -p tsconfig.json && pnpm lint && pnpm test`

## Notas de leitura

- A decomposição segue a sugerida: common → persistência na API → rotas → gate de notificação → BFF/OpenAPI/cliente → web → mobile → docs e seed.
- Ambiguidades resolvidas aqui (registradas também no Self-review):
  1. `ChargeSummary.silenced` é opcional no tipo (a API sempre manda), como `dueRule` e `proofKind`: nenhuma fixture de `ChargeDetail` em web, mobile ou common precisa mudar. `BillingAllocation.silenced` é obrigatório: todas as fixtures existentes usam `allocations: []`. `BillingDraft.silenced` é opcional para não quebrar drafts guardados.
  2. "Mesmo valor já gravado" não grava nada: nem allocation, nem cobranças, nem evento. Assim um `PATCH` que reenvia o valor atual de cada participante não apaga ajustes feitos cobrança a cobrança.
  3. No `PATCH` com split, só quem **continua** na conta e muda de valor grava as pendentes e gera `billing.participant_silenced`/`unsilenced`; quem entra só recebe o valor na allocation (como na criação, sem evento).
  4. "Quem deve não vê diferença": a API manda `silenced: true` só para o credor (`dto` e timeline); o devedor sempre lê `false`.
  5. `announceCharges` e `followUpCharge` pulam a cobrança silenciada sem registrar evento (texto literal da seção 3 da spec). Os `notice.skipped { reason: 'silenced' }` pedidos na seção 5 vêm do gate de `sendChargeNotice`, testado com os templates `initial` e `reminder` e com o canal `email` do reforço.
  6. A seção 7 do `docs/manual-qa-script.md` já existe (convite): o roteiro novo entra como `## 20. Sem avisos`.
  7. No formulário, o texto de apoio aparece uma vez, abaixo das chaves dos participantes.
  8. Numa conta Única/Parcelada a divisão é congelada na edição, então a chave do formulário fica desabilitada; o dono usa a ação do detalhe.
  9. Mensagem de `SILENCE_UNAVAILABLE` (a spec não traz): "Só uma conta a receber tem avisos automáticos para pausar."
  10. `api.ts` passa a listar `PUT` em `cors.allowMethods` (as rotas novas são as primeiras com `PUT`).

### Migração (do usuário, não é passo de tarefa)

```sql
ALTER TABLE allocations ADD COLUMN silenced boolean;
ALTER TABLE charges ADD COLUMN silenced boolean;
```

O `test:integration` recria o banco de teste (`--reset`) a partir dos schemas, então os testes da API não dependem dessa migração. O banco local (`serve --local` sem `--reset`) e o seed dependem.

## File map

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/common/src/domain/split.ts` | `silenced?` nas partes `User`, repassado por `resolveBillingSplit` |
| `packages/common/src/domain/billing.ts`, `contracts.ts` | `BillingAllocation.silenced`, `ChargeSummary.silenced?` |
| `packages/common/src/domain/billing-draft.ts` | `BillingDraft.silenced?` e envio no split |
| `packages/common/src/domain/charge-text.ts` | `canSilenceCharge` |
| `packages/api/src/billings/schemas/billing.ts`, `charges/schemas/charge.ts` | colunas `silenced` |
| `packages/api/src/charges/errors.ts`, `api.ts` | `SilenceUnavailableError`, `httpErrors`, `PUT` no CORS |
| `packages/api/src/billings/utils/body.ts` | `silenced?` no corpo do split |
| `packages/api/src/charges/services/materialize.ts` | cobrança nasce com o `silenced` da allocation |
| `packages/api/src/billings/repositories/billing.ts` | `splitFor`, `saveAllocations`, `patch`, `silenceParticipant` |
| `packages/api/src/charges/repositories/charge.ts`, `timeline/repositories/timeline.ts` | `silenced` no DTO e na timeline, `ChargeRepository.silence` |
| `packages/api/src/billings/endpoints/silence-participant.ts`, `billings/routes.ts` (novo endpoint) | `PUT /billings/{id}/participants/{userId}/silenced` |
| `packages/api/src/charges/endpoints/silence.ts`, `charges/routes.ts` (novo endpoint) | `PUT /charges/{id}/silenced` |
| `packages/api/src/notifications/services/send.ts` | gate `silenced` |
| `packages/api/test/billings/silenced.spec.ts` (novo), `test/notifications/notifications.spec.ts` | integração |
| `docs/api-oas.yml`, `packages/web/src/lib/financial-proxy.ts`, `packages/web/src/app/api/financial/[...path]/route.ts`, `packages/mobile/src/financial/client.ts` | contrato, BFF e cliente |
| `packages/web/src/components/forms/billing-form-screen.tsx`, `screens/billing-detail-screen.tsx`, `screens/charge-detail-screen.tsx` | UI web |
| `packages/mobile/src/components/forms/billing-form-screen.tsx`, `screens/billing-detail-screen.tsx`, `screens/charge-detail-screen.tsx` | UI mobile |
| `docs/notifications.md`, `docs/api-errors.md`, `docs/manual-qa-script.md`, `packages/api/scripts/seed-local.mjs` | documentação e dados de teste |

---

### Task 1: Tipos e regra em `@receivy/common`

**Files:**
- Modify: `packages/common/src/domain/split.ts:4-58`
- Modify: `packages/common/src/domain/billing.ts:105-112` (`BillingAllocation`)
- Modify: `packages/common/src/domain/contracts.ts:52-80` (`ChargeSummary`)
- Modify: `packages/common/src/domain/billing-draft.ts:29-54,127-212`
- Modify: `packages/common/src/domain/charge-text.ts:218-226` (depois de `canCancelCharge`)
- Test: `packages/common/src/domain/split.test.ts`, `charge-text.test.ts`, `billing-draft.test.ts`

**Interfaces:**
- Produces:
  - `SplitParty = { kind: SplitPartKind.Owner } | { kind: SplitPartKind.User; userId: string; silenced?: boolean }`; as partes `User` de `SplitMode.Percentage`, `SplitMode.Fixed` e `SplitMode.Shares` ganham o mesmo `silenced?: boolean`
  - `resolveBillingSplit` devolve `silenced` na parte que o trouxe e lança `RangeError('Participante inválido.')` quando não é booleano
  - `BillingAllocation.silenced: boolean`
  - `ChargeSummary.silenced?: boolean` (e `ChargeDetail`, por extensão)
  - `BillingDraft.silenced?: Record<string, boolean>` (chave = user id); `buildBillingInput` só manda `silenced` para quem tem chave no draft
  - `canSilenceCharge(charge: ChargeDetail): boolean`

Nenhuma fixture de web ou mobile muda nesta tarefa: `BillingAllocation` só aparece como `allocations: []` (`grep -rn "splitMode:" packages/web/src packages/mobile/src` não acha nada) e os outros campos são opcionais. A API deixa de compilar em `BillingRepository.splitFor` (falta `silenced` na allocation) até a Task 2.

- [ ] **Step 1: Escrever os testes que falham**

Em `split.test.ts`, antes do `});` que fecha `describe('billing split', …)`:

```ts
  it('carries the silenced flag of a participant and refuses anything but a boolean', () => {
    expect(resolveBillingSplit(100, { mode: SplitMode.Equal, parts: [{ ...ana, silenced: true }, owner] })).toEqual([
      { ...ana, silenced: true, amountCents: 50 },
      { ...owner, amountCents: 50 }
    ]);
    expect(resolveBillingSplit(100, { mode: SplitMode.Fixed, parts: [{ ...bia, silenced: false, amountCents: 40 }] })).toEqual([
      { ...bia, silenced: false, amountCents: 40 },
      { ...owner, amountCents: 60 }
    ]);
    expect(() =>
      resolveBillingSplit(100, { mode: SplitMode.Equal, parts: [{ ...ana, silenced: 'yes' as unknown as boolean }] })
    ).toThrow('Participante inválido.');
  });
```

Em `charge-text.test.ts`, acrescentar `canSilenceCharge` ao import de `./charge-text` (entre `canShare` e `canUploadProof`) e, ao final do arquivo:

```ts
describe('silenced charges', () => {
  it('lets only the creditor of a pending conta a receber pause its notices', () => {
    const creditor = charge({ direction: Direction.Receivable, ownedByViewer: true });

    expect(canSilenceCharge(creditor)).toBe(true);
    expect(canSilenceCharge({ ...creditor, silenced: true })).toBe(true);
    expect(canSilenceCharge({ ...creditor, state: ChargeState.Paid })).toBe(false);
    expect(canSilenceCharge({ ...creditor, ownedByViewer: false })).toBe(false);
    expect(canSilenceCharge(charge({ direction: Direction.Payable }))).toBe(false);
    expect(canSilenceCharge(charge({ direction: Direction.Receivable, payer: ChargePayer.Owner, ownedByViewer: false }))).toBe(false);
  });
});
```

Em `billing-draft.test.ts`, ao final do arquivo:

```ts
describe('silenced participants', () => {
  it('sends the switch only for the participants the draft holds it for', () => {
    expect(buildBillingInput(base).split).toEqual({ mode: 'equal', parts: [{ kind: 'user', userId: 'p1' }, { kind: 'owner' }] });
    expect(buildBillingInput({ ...base, silenced: { p1: true } }).split).toEqual({
      mode: 'equal',
      parts: [{ kind: 'user', userId: 'p1', silenced: true }, { kind: 'owner' }]
    });
    expect(
      buildBillingInput({
        ...base,
        mode: SplitMode.Fixed,
        values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,01' } },
        silenced: { p1: false }
      }).split
    ).toEqual({ mode: 'fixed', parts: [{ kind: 'user', userId: 'p1', amountCents: 4001, silenced: false }] });
    expect(buildBillingInput({ ...base, mode: SplitMode.Shares, silenced: { p1: true } }).split).toEqual({
      mode: 'shares',
      parts: [
        { kind: 'user', userId: 'p1', silenced: true, shares: 1 },
        { kind: 'owner', shares: 1 }
      ]
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/common && npx vitest run src/domain/split.test.ts src/domain/charge-text.test.ts src/domain/billing-draft.test.ts`
Expected: FAIL — `resolveBillingSplit` descarta `silenced` e não lança, `canSilenceCharge` não existe, `buildBillingInput` não manda `silenced`.

- [ ] **Step 3: Partes do split**

Em `split.ts`, trocar `SplitParty` e `BillingSplit` por:

```ts
export type SplitParty = { kind: SplitPartKind.Owner } | { kind: SplitPartKind.User; userId: string; silenced?: boolean };

export type BillingSplit =
  | { mode: SplitMode.Equal; parts: SplitParty[] }
  // Keep schema-visible unions explicit: EZ4 cannot extract object/union intersections.
  | {
      mode: SplitMode.Percentage;
      parts: (
        | { kind: SplitPartKind.Owner; basisPoints: number }
        | { kind: SplitPartKind.User; userId: string; silenced?: boolean; basisPoints: number }
      )[];
    }
  | { mode: SplitMode.Fixed; parts: { kind: SplitPartKind.User; userId: string; silenced?: boolean; amountCents: number }[] }
  | {
      mode: SplitMode.Shares;
      parts: ({ kind: SplitPartKind.Owner; shares: number } | { kind: SplitPartKind.User; userId: string; silenced?: boolean; shares: number })[];
    };
```

No laço de validação de `resolveBillingSplit`, logo depois do `if` de `'Contato inválido.'`:

```ts
    if (part.kind === SplitPartKind.User && part.silenced !== undefined && typeof part.silenced !== 'boolean') {
      throw new RangeError('Participante inválido.');
    }
```

Trocar a montagem de `parties` por:

```ts
  const parties: SplitParty[] = split.parts.map((part) => partyOf(part));
```

E, depois de `resolveBillingSplit` (antes de `resolveAmounts`):

```ts
/** The party without its mode weight; `silenced` rides along only when the part carries it. */
function partyOf(part: BillingSplit['parts'][number]): SplitParty {
  if (part.kind === SplitPartKind.Owner) {
    return { kind: SplitPartKind.Owner };
  }

  if (part.silenced === undefined) {
    return { kind: SplitPartKind.User, userId: part.userId };
  }

  return { kind: SplitPartKind.User, userId: part.userId, silenced: part.silenced };
}
```

- [ ] **Step 4: Contratos**

Em `billing.ts`, em `BillingAllocation`, depois de `order: number;`:

```ts
  /** The participant's "Não notificar": the value new charges of theirs start with. Always false on the owner part. */
  silenced: boolean;
```

Em `contracts.ts`, em `ChargeSummary`, depois de `confirmationRequired?: boolean;`:

```ts
  /** The creditor paused the automatic notices of this charge. The API always sends it, true only to the creditor. */
  silenced?: boolean;
```

- [ ] **Step 5: Draft**

Em `billing-draft.ts`, em `BillingDraft`, depois de `reminders: ReminderDraft[];`:

```ts
  /** "Não notificar" per participant user id. A participant without a key sends nothing, so the API keeps what it stores. */
  silenced?: Record<string, boolean>;
```

Antes de `buildSplit`:

```ts
/** The switch travels only when the draft holds it for that participant. */
function silencedOf(draft: BillingDraft, userId: string): { silenced?: boolean } {
  const value = draft.silenced?.[userId];

  if (value === undefined) {
    return {};
  }

  return { silenced: value };
}
```

Em `buildSplit`, no ramo `SplitMode.Fixed`, trocar o objeto da parte por:

```ts
      parts: draft.selected.map((userId) => ({
        kind: SplitPartKind.User,
        userId,
        ...silencedOf(draft, userId),
        amountCents: parseBRLCents(values[userId] ?? '')
      }))
```

Em `buildBillingInput`, trocar a montagem de `parties` por:

```ts
  const parties = [
    ...draft.selected.map((userId) => ({ kind: SplitPartKind.User, userId, ...silencedOf(draft, userId) }) satisfies SplitParty),
    ...(draft.owner ? [{ kind: SplitPartKind.Owner } satisfies SplitParty] : [])
  ];
```

Os ramos `Shares` e `Percentage` já espalham `party`, então herdam o campo.

- [ ] **Step 6: Regra da cobrança**

Em `charge-text.ts`, depois de `canCancelCharge`:

```ts
/** Only the creditor of a conta a receber pauses the automatic notices of a pending charge; "Lembrar" stays available. */
export function canSilenceCharge(charge: ChargeDetail): boolean {
  return (
    charge.state === ChargeState.Pending &&
    charge.ownedByViewer !== false &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner
  );
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd packages/common && npx vitest run src/domain/split.test.ts src/domain/charge-text.test.ts src/domain/billing-draft.test.ts`
Expected: PASS.

- [ ] **Step 8: Verificar os pacotes**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
Expected: sem erro de tipo, Biome limpo, todos os testes passando.

Run: `pnpm --filter @receivy/web check-types && cd packages/mobile && npx tsc --noEmit -p tsconfig.json`
Expected: sem erros (nenhuma fixture precisou mudar).

Run: `cd packages/api && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c silenced`
Expected: erros só em `billings/repositories/billing.ts` (`splitFor` sem `silenced`), resolvidos na Task 2.

- [ ] **Step 9: Parar para o usuário commitar**

---

### Task 2: Colunas, erro e cópia de `silenced` na API

**Files:**
- Modify: `packages/api/src/billings/schemas/billing.ts:48-61` (`AllocationSchema`)
- Modify: `packages/api/src/charges/schemas/charge.ts:20-66` (`ChargeSchema`)
- Modify: `packages/api/src/charges/errors.ts`
- Modify: `packages/api/src/api.ts:17,68-101`
- Modify: `packages/api/src/billings/utils/body.ts:18-24` (`SplitBody`)
- Modify: `packages/api/src/charges/services/materialize.ts:2,117-176` (`persistChargePlan`)
- Modify: `packages/api/src/charges/repositories/charge.ts:62-143,247-292` (`SELECT`, `Row`, `dto`)
- Modify: `packages/api/src/timeline/repositories/timeline.ts:145-165`
- Modify: `packages/api/src/billings/repositories/billing.ts` (import, helpers privados, `splitFor`, `saveAllocations`, `patch`)
- Create: `packages/api/test/billings/silenced.spec.ts`

**Interfaces:**
- Consumes: `SplitParty.silenced`, `BillingAllocation.silenced`, `ChargeSummary.silenced` (Task 1).
- Produces:
  - `AllocationSchema.silenced?: boolean`, `ChargeSchema.silenced?: boolean`, `ChargeRepository.Row.silenced?: boolean` (e `silenced: true` em `ChargeRepository.SELECT`)
  - `class SilenceUnavailableError extends ConflictError` — code `SILENCE_UNAVAILABLE`, registrada no 409 de `api.ts`
  - `BillingRepository.SilenceChange = { userId: string; silenced: boolean }`
  - `BillingRepository.saveAllocations(db: DbClient, id: string, totalCents: number, split: BillingSplit, now: string): Promise<SilenceChange[]>`
  - helpers privados de `billings/repositories/billing.ts`: `silencedParticipants(db: DbClient, billingId: string): Promise<Map<string, boolean>>`, `silencedFor(part: SplitParty, before: Map<string, boolean>): boolean`, `silencePendingCharges(db: DbClient, billingId: string, userId: string, silenced: boolean, now: string): Promise<void>`, `participantSilenceEvent(silenced: boolean): string`
  - `ChargeDetail.silenced` e `TimelineItem.charge.silenced`: `true` só quando o leitor é o credor e a coluna é `true`
  - eventos `billing.participant_silenced` / `billing.participant_unsilenced` com payload `{ userId }` quando um `PATCH` muda o valor de quem continua

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/api/test/billings/silenced.spec.ts`:

```ts
import { deepEqual, equal, ok } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { BillingFrequency, type BillingInput, BillingType, PixKeyType, SplitMode, SplitPartKind } from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'd1111111-1111-4111-8111-111111111111';
const OTHER = 'd2222222-2222-4222-8222-222222222222';
const TZ = 'America/Sao_Paulo';
const date = (value: string) => new Date(`${value}T12:00:00Z`);

let pixId: string;
let anaId: string;
let anaContactId: string;
let brunoId: string;
let carlaId: string;

/** A monthly recorrente starting in February, with Ana silenced and Bruno notified. */
function recurring(key: string, overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Indefinite,
    frequency: BillingFrequency.Monthly,
    description: key,
    totalCents: 10_000,
    startDate: '2026-02-15',
    timezone: TZ,
    paymentMethodId: pixId,
    split: {
      mode: SplitMode.Equal,
      parts: [
        { kind: SplitPartKind.User, userId: anaId, silenced: true },
        { kind: SplitPartKind.User, userId: brunoId }
      ]
    },
    ...overrides
  };
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_user_id: true, due_date: true, state: true, silenced: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return records;
}

async function allocationFlags(billingId: string) {
  const { records } = await db.allocations.findMany({
    select: { user_id: true, silenced: true },
    where: { billing_id: billingId, kind: SplitPartKind.User },
    order: { allocation_order: Order.Asc }
  });

  return records.map((row) => [row.user_id, row.silenced === true]);
}

describe('sem avisos on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'silenced-owner@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'silenced-other@example.com', name: 'Outra' });

    const ana = await ContactRepository.save(db, OWNER, { name: 'Ana', email: 'silenced-ana@example.com' });

    anaId = ana.userId;
    anaContactId = ana.id;
    brunoId = (await ContactRepository.save(db, OWNER, { name: 'Bruno', email: 'silenced-bruno@example.com' })).userId;
    carlaId = (await ContactRepository.save(db, OWNER, { name: 'Carla', email: 'silenced-carla@example.com' })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER]));

  it('copies a silenced participant to the allocation and to every charge created for them', async () => {
    const created = await BillingRepository.create(
      db,
      OWNER,
      'silenced-create',
      {
        type: BillingType.Until,
        frequency: BillingFrequency.Monthly,
        description: 'Curso',
        totalCents: 6_000,
        startDate: '2026-03-10',
        endDate: '2026-04-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: {
          mode: SplitMode.Fixed,
          parts: [
            { kind: SplitPartKind.User, userId: anaId, silenced: true, amountCents: 3_000 },
            { kind: SplitPartKind.User, userId: brunoId, amountCents: 3_000 }
          ]
        }
      },
      date('2026-03-01')
    );

    deepEqual(await allocationFlags(created.id), [
      [anaId, true],
      [brunoId, false]
    ]);
    deepEqual(
      created.allocations.map((allocation) => [allocation.kind, allocation.silenced]),
      [
        ['user', true],
        ['user', false],
        ['owner', false]
      ]
    );

    const rows = await chargeRows(created.id);

    equal(rows.length, 4);
    ok(rows.filter((row) => row.debtor_user_id === anaId).every((row) => row.silenced === true));
    ok(rows.filter((row) => row.debtor_user_id === brunoId).every((row) => row.silenced !== true));

    const anaCharge = created.charges.find((charge) => charge.debtorUserId === anaId)!;

    equal(anaCharge.silenced, true);
    equal(created.charges.find((charge) => charge.debtorUserId === brunoId)!.silenced, false);
    equal((await ChargeRepository.get(db, anaId, anaCharge.id)).silenced, false, 'whoever owes sees no difference');

    const ledger = await TimelineRepository.contactLedger(db, OWNER, anaContactId);

    equal(ledger.charges.find((charge) => charge.id === anaCharge.id)?.silenced, true);
  });

  it('copies the participant value to the charges of each new month', async () => {
    const billing = await BillingRepository.create(db, OWNER, 'silenced-monthly', recurring('Aluguel'), date('2026-01-01'));
    const done = await BillingRepository.materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    equal(done.materialized, true);

    const rows = await chargeRows(billing.id);

    equal(rows.length, 2);
    equal(rows.find((row) => row.debtor_user_id === anaId)?.silenced, true);
    equal(rows.find((row) => row.debtor_user_id === brunoId)?.silenced === true, false);
  });

  it('keeps the value of whoever stays, applies the one sent and moves their pending charges', async () => {
    const billing = await BillingRepository.create(db, OWNER, 'silenced-edit', recurring('Internet'), date('2026-01-01'));

    await BillingRepository.materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    const edited = await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      {
        totalCents: 12_000,
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId, silenced: true },
            { kind: SplitPartKind.User, userId: carlaId, silenced: true }
          ]
        }
      },
      date('2026-02-10')
    );

    deepEqual(await allocationFlags(billing.id), [
      [anaId, true],
      [brunoId, true],
      [carlaId, true]
    ]);
    deepEqual(
      edited.allocations.map((allocation) => allocation.silenced),
      [true, true, true]
    );
    equal((await chargeRows(billing.id)).find((row) => row.debtor_user_id === brunoId)?.silenced, true, 'the value sent reaches the pending charge');
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: brunoId }],
      'whoever enters takes the value without an event, like at creation'
    );

    await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      {
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId, silenced: false },
            { kind: SplitPartKind.User, userId: brunoId, silenced: true }
          ]
        }
      },
      date('2026-02-11')
    );

    equal((await chargeRows(billing.id)).find((row) => row.debtor_user_id === anaId)?.silenced, false);
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_unsilenced')).map((event) => event.payload),
      [{ userId: anaId }]
    );
    equal((await EventRepository.list(db, billing.id, 'billing.participant_silenced')).length, 1, 'the same value records nothing');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api check-types:test`
Expected: FAIL — `silenced` não existe em `AllocationSchema`/`ChargeSchema` nem no split do `BillingPatch` da API.

Run: `pnpm --filter @receivy/api test:integration`
Expected: FAIL nos três testes de `sem avisos on native PostgreSQL` (coluna ausente ou `silenced` nunca gravado).

- [ ] **Step 3: Colunas**

Em `billings/schemas/billing.ts`, em `AllocationSchema`, depois de `allocation_order: number;`:

```ts
  /** "Não notificar" of a 'user' part: new charges of this participant copy it. Null (owner part, older rows) reads as false. */
  silenced?: boolean;
```

Em `charges/schemas/charge.ts`, em `ChargeSchema`, depois de `link_revoked_at?: String.DateTime;`:

```ts
  /** "Não notificar": the only value the notice gate reads. Null on older rows reads as false. */
  silenced?: boolean;
```

As colunas aceitam nulo; no banco local o usuário roda a migração do topo do plano. Não rodar na tarefa.

- [ ] **Step 4: Erro e gateway**

Em `charges/errors.ts`, ao final:

```ts
export class SilenceUnavailableError extends ConflictError {
  constructor(message = 'Só uma conta a receber tem avisos automáticos para pausar.') {
    super(message, 'SILENCE_UNAVAILABLE');
  }
}
```

Em `api.ts`:
- `import type { ChargeClosedError, ChargeInReviewError, ChargeNotPaidError, SilenceUnavailableError } from './charges/errors';`
- na lista `409`, depois de `ChargeInReviewError,`, acrescentar `SilenceUnavailableError,`.

- [ ] **Step 5: Corpo do split**

Em `billings/utils/body.ts`, trocar o braço `User` de `SplitBody.parts` por:

```ts
    | {
        kind: SplitPartKind.User;
        userId: String.UUID;
        silenced?: boolean;
        amountCents?: number;
        basisPoints?: number;
        shares?: Integer.Range<1, 1000>;
      }
```

- [ ] **Step 6: Cobrança nasce com o valor da allocation**

Em `charges/services/materialize.ts`, trocar o import de `@receivy/common` por:

```ts
import { type BillingPlan, type BillingType, ChargePayer, ChargeState, type PaymentMethod, SplitPartKind, UserStatus } from '@receivy/common';
```

Antes de `recordCreation`:

```ts
/** Participants whose allocation says "Não notificar": every charge created for them starts silenced. */
async function silencedDebtors(db: DbClient, billingId: string): Promise<Set<string>> {
  const { records } = await db.allocations.findMany({
    select: { user_id: true },
    where: { billing_id: billingId, kind: SplitPartKind.User, silenced: true }
  });
  const silenced = new Set<string>();

  for (const row of records) {
    if (row.user_id) {
      silenced.add(row.user_id);
    }
  }

  return silenced;
}
```

Em `persistChargePlan`, logo depois de `const noticeChargeIds: string[] = [];`:

```ts
  // Creation, the monthly sweep, edits and invites all land here, after the allocations are saved.
  const silenced = await silencedDebtors(db, billing.id);
```

E, no `data` do `insertOne`, depois de `state: ChargeState.Pending,`:

```ts
        ...(recipient && silenced.has(recipient.userId) ? { silenced: true } : {}),
```

- [ ] **Step 7: DTO e timeline**

Em `charges/repositories/charge.ts`:
- em `SELECT`, depois de `link_revoked_at: true,`: `silenced: true,`
- em `Row`, depois de `link_revoked_at?: string;`:

```ts
    /** "Não notificar" of this charge; undefined reads as false. */
    silenced?: boolean;
```

- em `dto`, depois de `confirmationRequired: await confirmationRequired(db, row),`:

```ts
      // Only the creditor sees the switch: whoever owes reads every charge the same.
      silenced: owns(row, userId) && row.silenced === true,
```

Em `timeline/repositories/timeline.ts`, no objeto `charge` do item, trocar a última linha `confirmationRequired: await ChargeRepository.confirmationRequired(db, row)` por:

```ts
          confirmationRequired: await ChargeRepository.confirmationRequired(db, row),
          silenced: ChargeRepository.owns(row, userId) && row.silenced === true
```

- [ ] **Step 8: Allocations guardam e preservam o valor**

Em `billings/repositories/billing.ts`, no import de `@receivy/common`, acrescentar `type SplitParty` depois de `SplitPartKind,`.

Depois da função `userIds`, acrescentar os helpers privados:

```ts
/** The stored "Não notificar" of each participant of a billing, by user id. */
async function silencedParticipants(db: DbClient, billingId: string): Promise<Map<string, boolean>> {
  const { records } = await db.allocations.findMany({
    select: { user_id: true, silenced: true },
    where: { billing_id: billingId, kind: SplitPartKind.User }
  });
  const silenced = new Map<string, boolean>();

  for (const row of records) {
    if (row.user_id) {
      silenced.set(row.user_id, row.silenced === true);
    }
  }

  return silenced;
}

/** The part's own value wins; a participant who stays without one keeps theirs; the owner part is never silenced. */
function silencedFor(part: SplitParty, before: Map<string, boolean>): boolean {
  if (part.kind !== SplitPartKind.User) {
    return false;
  }

  if (part.silenced !== undefined) {
    return part.silenced;
  }

  return before.get(part.userId) ?? false;
}

/** A participant's switch lands on their pending charges of the billing; paid and cancelled ones keep theirs. */
async function silencePendingCharges(db: DbClient, billingId: string, userId: string, silenced: boolean, now: string): Promise<void> {
  await db.charges.updateMany({
    where: { billing_id: billingId, debtor_user_id: userId, state: ChargeState.Pending },
    data: { silenced, updated_at: now }
  });
}

function participantSilenceEvent(silenced: boolean): string {
  return silenced ? 'billing.participant_silenced' : 'billing.participant_unsilenced';
}
```

Em `splitFor`, no `select` do `findMany`, depois de `allocation_order: true`, acrescentar `silenced: true`, e no `rows.map` das `allocations`, depois de `order: row.allocation_order,`:

```ts
      silenced: row.silenced === true,
```

Trocar `saveAllocations` inteiro por:

```ts
  /** A participant who stayed in the split and whose "Não notificar" the saved split changed. */
  export type SilenceChange = { userId: string; silenced: boolean };

  /**
   * Rewrites the allocations of a billing. Whoever stays keeps their `silenced` unless the part sends one; whoever
   * enters takes the part's value (absent is false). Returns the changes of those who stayed, so their pending
   * charges can follow.
   */
  export async function saveAllocations(
    db: DbClient,
    id: string,
    totalCents: number,
    split: BillingSplit,
    now: string
  ): Promise<SilenceChange[]> {
    const resolved = resolveBillingSplit(totalCents, split);
    const before = await silencedParticipants(db, id);
    const changes: SilenceChange[] = [];

    await db.allocations.deleteMany({ where: { billing_id: id } });

    for (const [index, part] of resolved.entries()) {
      const original = split.parts[index];
      const silenced = silencedFor(part, before);

      if (part.kind === SplitPartKind.User && before.has(part.userId) && before.get(part.userId) !== silenced) {
        changes.push({ userId: part.userId, silenced });
      }

      await db.allocations.insertOne({
        data: {
          id: crypto.randomUUID(),
          billing: { id },
          kind: part.kind,
          ...(part.kind === SplitPartKind.User ? { user: { id: part.userId }, silenced } : {}),
          split_mode: split.mode,
          amount_cents: part.amountCents,
          allocation_order: index,
          ...(original && 'basisPoints' in original ? { basis_points: original.basisPoints } : {}),
          // Only the `shares` mode owns the quota column; a stray field on another mode stays null.
          ...(split.mode === SplitMode.Shares && original && 'shares' in original ? { shares: original.shares } : {}),
          created_at: now
        }
      });
    }

    return changes;
  }
```

`create` e `InviteRepository.joinSplit` continuam chamando `saveAllocations` sem usar o retorno (na criação ninguém "continua"; no convite o split vem de `splitFor`, sem `silenced`, e preserva todos).

Em `patch`, trocar:

```ts
      if (patch.split !== undefined || patch.totalCents !== undefined) {
        await saveAllocations(tx, id, totalCents, split, instant);
      }
```

por:

```ts
      if (patch.split !== undefined || patch.totalCents !== undefined) {
        const changes = await saveAllocations(tx, id, totalCents, split, instant);

        // Same rule as PUT /billings/{id}/participants/{userId}/silenced for whoever stayed and changed.
        for (const change of changes) {
          await silencePendingCharges(tx, id, change.userId, change.silenced, instant);
          await audit(tx, ownerId, id, participantSilenceEvent(change.silenced), instant, { userId: change.userId });
        }
      }
```

- [ ] **Step 9: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: lint e tipos limpos; os três testes novos passam e nenhum teste existente quebra (se a falha conhecida da busca por categoria ainda existir, ela não é desta tarefa).

Run: `cd packages/api && npx vitest run src/import-cycles.test.ts`
Expected: PASS.

- [ ] **Step 10: Parar para o usuário commitar**

---

### Task 3: Rotas `PUT` de participante e de cobrança

**Files:**
- Modify: `packages/api/src/charges/repositories/charge.ts:23,316-335` (import e função nova no namespace)
- Create: `packages/api/src/charges/endpoints/silence.ts`
- Modify: `packages/api/src/charges/routes.ts`
- Modify: `packages/api/src/billings/repositories/billing.ts:57-66,1098` (import e função nova no namespace)
- Create: `packages/api/src/billings/endpoints/silence-participant.ts`
- Modify: `packages/api/src/billings/routes.ts`
- Modify: `packages/api/src/api.ts:132-137` (`cors.allowMethods`)
- Test: `packages/api/test/billings/silenced.spec.ts`

**Interfaces:**
- Consumes: `SilenceUnavailableError`, `ChargeRepository.Row.silenced`, `silencedParticipants`, `silencePendingCharges`, `participantSilenceEvent` (Task 2).
- Produces:
  - `ChargeRepository.silence(db: DbClient, creditorId: string, id: string, silenced: boolean, now?: Date): Promise<ChargeDetail>` — 404 para quem não é credor, 409 `SILENCE_UNAVAILABLE` em conta a pagar, 409 `CHARGE_CLOSED` fora de pendente, evento `charge.silenced` / `charge.unsilenced`
  - `BillingRepository.silenceParticipant(db: DbClient, ownerId: string, id: string, userId: string, silenced: boolean, now?: Date, link?: InviteLinkContext): Promise<BillingDetail>` — 404 para outro dono ou não participante, 409 `SILENCE_UNAVAILABLE` em conta a pagar, evento `billing.participant_silenced` / `billing.participant_unsilenced { userId }`
  - handlers `silenceChargeHandler` e `silenceParticipantHandler`; rotas `silenceCharge` (`PUT /charges/{id}/silenced`) e `silenceBillingParticipant` (`PUT /billings/{id}/participants/{userId}/silenced`), corpo `{ silenced: boolean }`

- [ ] **Step 1: Escrever os testes que falham**

Em `test/billings/silenced.spec.ts`, trocar o bloco de imports por:

```ts
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import { BillingFrequency, type BillingInput, BillingType, ChargeState, Direction, PixKeyType, SplitMode, SplitPartKind } from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeClosedError, SilenceUnavailableError } from '../../src/charges/errors';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';
```

Depois de `allocationFlags`, acrescentar:

```ts
/** The owner's own bill, owed to Ana: nothing here has notices to pause. */
function payableOnce(key: string): BillingInput {
  return {
    type: BillingType.Once,
    direction: Direction.Payable,
    description: key,
    totalCents: 5_000,
    startDate: '2026-03-10',
    timezone: TZ,
    payeeUserId: anaId
  };
}
```

E, antes do `});` que fecha o `describe`:

```ts
  it('switches a participant on the allocation and on their pending charges only', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'silenced-participant',
      {
        type: BillingType.Until,
        frequency: BillingFrequency.Monthly,
        description: 'Parcelas',
        totalCents: 3_000,
        startDate: '2026-03-10',
        endDate: '2026-05-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-01')
    );
    const paid = billing.charges[0]!.id;
    const cancelled = billing.charges[1]!.id;
    const stamp = new Date().toISOString();

    await db.charges.updateOne({ where: { id: paid }, data: { state: ChargeState.Paid, paid_at: stamp, updated_at: stamp } });
    await db.charges.updateOne({ where: { id: cancelled }, data: { state: ChargeState.Cancelled, cancelled_at: stamp, updated_at: stamp } });

    const silenced = await BillingRepository.silenceParticipant(db, OWNER, billing.id, anaId, true, date('2026-03-02'));

    deepEqual(
      silenced.allocations.map((allocation) => allocation.silenced),
      [true]
    );
    deepEqual(
      silenced.charges.map((charge) => [charge.state, charge.silenced]),
      [
        ['paid', false],
        ['cancelled', false],
        ['pending', true]
      ]
    );
    deepEqual(
      (await chargeRows(billing.id)).map((row) => row.silenced ?? null),
      [null, null, true],
      'paid and cancelled charges are never written'
    );

    await BillingRepository.silenceParticipant(db, OWNER, billing.id, anaId, true, date('2026-03-03'));

    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: anaId }],
      'the same value records nothing'
    );

    const resumed = await BillingRepository.silenceParticipant(db, OWNER, billing.id, anaId, false, date('2026-03-04'));

    deepEqual(
      resumed.charges.map((charge) => charge.silenced),
      [false, false, false]
    );
    equal((await EventRepository.list(db, billing.id, 'billing.participant_unsilenced')).length, 1);
  });

  it('refuses another owner, a non-participant and a conta a pagar on the participant route', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'silenced-refusals',
      {
        type: BillingType.Once,
        description: 'Jantar',
        totalCents: 2_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-01')
    );
    const payable = await BillingRepository.create(db, OWNER, 'silenced-refusals-payable', payableOnce('Luz'), date('2026-03-01'));

    await rejects(() => BillingRepository.silenceParticipant(db, OTHER, billing.id, anaId, true), HttpNotFoundError);
    await rejects(() => BillingRepository.silenceParticipant(db, OWNER, billing.id, carlaId, true), HttpNotFoundError);
    await rejects(() => BillingRepository.silenceParticipant(db, OWNER, payable.id, anaId, true), SilenceUnavailableError);
    equal(await db.events.count({ where: { eventable_id: billing.id, type: 'billing.participant_silenced' } }), 0);
  });

  it('switches one charge for its creditor and nobody else', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'silenced-charge',
      {
        type: BillingType.Once,
        description: 'Pizza',
        totalCents: 4_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId }
          ]
        }
      },
      date('2026-03-01')
    );
    const target = billing.charges.find((charge) => charge.debtorUserId === anaId)!;
    const detail = await ChargeRepository.silence(db, OWNER, target.id, true);

    equal(detail.silenced, true);
    deepEqual(
      (await chargeRows(billing.id)).filter((row) => row.silenced === true).map((row) => row.id),
      [target.id]
    );
    deepEqual(await allocationFlags(billing.id), [
      [anaId, false],
      [brunoId, false]
    ]);

    await ChargeRepository.silence(db, OWNER, target.id, true);

    equal((await EventRepository.list(db, target.id, 'charge.silenced')).length, 1, 'the same value records nothing');

    await ChargeRepository.silence(db, OWNER, target.id, false);

    equal((await EventRepository.list(db, target.id, 'charge.unsilenced')).length, 1);
    await rejects(() => ChargeRepository.silence(db, OTHER, target.id, true), HttpNotFoundError);
    await rejects(() => ChargeRepository.silence(db, anaId, target.id, true), HttpNotFoundError);

    await ChargeRepository.pay(db, OWNER, target.id);
    await rejects(() => ChargeRepository.silence(db, OWNER, target.id, true), ChargeClosedError);

    const payable = await BillingRepository.create(db, OWNER, 'silenced-charge-payable', payableOnce('Água'), date('2026-03-01'));

    await rejects(() => ChargeRepository.silence(db, OWNER, payable.charges[0]!.id, true), SilenceUnavailableError);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api check-types:test`
Expected: FAIL — `BillingRepository.silenceParticipant` e `ChargeRepository.silence` não existem.

- [ ] **Step 3: Repositório da cobrança**

Em `charges/repositories/charge.ts`, trocar o import de erros por:

```ts
import { ChargeClosedError, ChargeNotPaidError, SilenceUnavailableError } from '../errors';
```

Depois de `cancel`, dentro do namespace:

```ts
  /**
   * The creditor of a conta a receber pauses or resumes the automatic notices of one pending charge. Anyone else
   * gets a 404; sending the value already stored answers without writing or recording anything.
   */
  export async function silence(db: DbClient, creditorId: string, id: string, silenced: boolean, now = new Date()): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      await lockAccountReferences(tx, 'write');

      const row = await tx.charges.findOne({ select: SELECT, where: { id, creditor_id: creditorId }, lock: true });

      if (!row) {
        throw new HttpNotFoundError();
      }

      if (payer(row) === ChargePayer.Owner) {
        throw new SilenceUnavailableError();
      }

      if (row.state !== ChargeState.Pending) {
        throw new ChargeClosedError();
      }

      const current = row.silenced === true;

      if (current === silenced) {
        return dto(tx, row, creditorId);
      }

      const stamp = now.toISOString();

      await tx.charges.updateOne({ where: { id }, data: { silenced, updated_at: stamp } });

      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });

      if (!updated) {
        throw new HttpNotFoundError();
      }

      await activity(tx, { actorId: creditorId, row: updated, type: silenced ? 'charge.silenced' : 'charge.unsilenced', now: stamp });

      return dto(tx, updated, creditorId);
    });
  }
```

- [ ] **Step 4: Endpoint e rota da cobrança**

Criar `charges/endpoints/silence.ts`:

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ChargeProvider } from '../provider';
import { ChargeRepository } from '../repositories/charge';

declare class SilenceRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: { silenced: boolean };
}

declare class ItemResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function silenceChargeHandler(request: SilenceRequest, { db, proofFiles }: Service.Context<ChargeProvider>): Promise<ItemResponse> {
  const detail = await ChargeRepository.silence(db, request.identity.userId, request.parameters.id, request.body.silenced);

  return { status: 200, body: await AvatarRepository.sign(proofFiles, detail) };
}
```

Em `charges/routes.ts`, acrescentar `import type { silenceChargeHandler } from './endpoints/silence';` depois do import de `reopen` e, ao final da tupla:

```ts
  Http.UseRoute<{
    name: 'silenceCharge';
    path: 'PUT /charges/{id}/silenced';
    authorizer: typeof sessionAuthorizer;
    handler: typeof silenceChargeHandler;
  }>
```

(com vírgula depois do `}>` da rota `reopenCharge`).

- [ ] **Step 5: Repositório da conta**

Em `billings/repositories/billing.ts`, depois do import de `ChargeRepository`:

```ts
import { SilenceUnavailableError } from '../../charges/errors';
```

Depois de `preview`, dentro do namespace:

```ts
  /**
   * The owner of a conta a receber switches one participant's automatic notices: the allocation and every pending
   * charge of theirs in the billing follow, paid and cancelled ones stay. Sending the value already stored writes nothing.
   */
  export async function silenceParticipant(
    db: DbClient,
    ownerId: string,
    id: string,
    userId: string,
    silenced: boolean,
    now = new Date(),
    link?: InviteLinkContext
  ): Promise<BillingDetail> {
    return db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);

      const row = await billingRow(tx, ownerId, id, true);

      if (direction(row) === Direction.Payable) {
        throw new SilenceUnavailableError();
      }

      const current = (await silencedParticipants(tx, id)).get(userId);

      if (current === undefined) {
        throw new HttpNotFoundError();
      }

      if (current === silenced) {
        return dto(tx, row, now, link);
      }

      const instant = now.toISOString();

      await tx.allocations.updateMany({ where: { billing_id: id, kind: SplitPartKind.User, user_id: userId }, data: { silenced } });
      await silencePendingCharges(tx, id, userId, silenced, instant);
      await audit(tx, ownerId, id, participantSilenceEvent(silenced), instant, { userId });

      return dto(tx, row, now, link);
    });
  }
```

- [ ] **Step 6: Endpoint e rota da conta**

Criar `billings/endpoints/silence-participant.ts`:

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';
import { BillingRepository } from '../repositories/billing';
import { inviteLink } from '../utils/context';

declare class SilenceParticipantRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID; userId: String.UUID };
  body: { silenced: boolean };
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function silenceParticipantHandler(
  request: SilenceParticipantRequest,
  { db, variables, proofFiles }: Service.Context<BillingProvider>
): Promise<DetailResponse> {
  const detail = await BillingRepository.silenceParticipant(
    db,
    request.identity.userId,
    request.parameters.id,
    request.parameters.userId,
    request.body.silenced,
    new Date(),
    inviteLink({ variables })
  );

  return { status: 200, body: await AvatarRepository.sign(proofFiles, detail) };
}
```

Em `billings/routes.ts`, acrescentar `import type { silenceParticipantHandler } from './endpoints/silence-participant';` depois do import de `resolve-guest` e, ao final da tupla:

```ts
  Http.UseRoute<{
    name: 'silenceBillingParticipant';
    path: 'PUT /billings/{id}/participants/{userId}/silenced';
    authorizer: typeof sessionAuthorizer;
    handler: typeof silenceParticipantHandler;
  }>
```

(com vírgula depois do `}>` da rota `resolveBillingGuest`).

- [ ] **Step 7: CORS**

Em `api.ts`, trocar `allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'];` por `allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];`.

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: limpos; os seis testes de `sem avisos on native PostgreSQL` passam.

Run: `cd packages/api && npx vitest run src/import-cycles.test.ts`
Expected: PASS.

- [ ] **Step 9: Parar para o usuário commitar**

---

### Task 4: Gate `silenced` nas notificações

**Files:**
- Modify: `packages/api/src/notifications/services/send.ts` (`sendChargeNotice`, `followUpCharge`, `announceCharges`, `planReminders`)
- Test: `packages/api/test/notifications/notifications.spec.ts`

**Interfaces:**
- Consumes: `ChargeSchema.silenced`, `ChargeRepository.SELECT.silenced` (Task 2); `ChargeRepository.silence` (Task 3).
- Produces: evento `notice.skipped { template, offsetDays?, reason: 'silenced' }` para todo canal diferente de `'both'`; `announceCharges`, `planReminders` e `followUpCharge` ignoram cobrança silenciada sem registrar evento. `pushPaymentNotice` e `NotificationRepository.manualReminder` não mudam.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/notifications/notifications.spec.ts`, depois do teste `'sends nothing while a payment waits in review and refuses the manual reminder'` (os imports já cobrem tudo):

```ts
  it('keeps every automatic notice of a silenced charge quiet and lets the manual reminder through', async () => {
    clock = Date.parse(`${DUE_DATE}T11:00:00Z`);
    sent.reset();

    const quiet = await charge();
    const control = await charge();

    await ChargeRepository.silence(db, OWNER, quiet.id, true);

    deepEqual(await send(quiet.id, NoticeTemplate.Initial), { channels: [] });
    deepEqual(await send(quiet.id, NoticeTemplate.Reminder, 0), { channels: [] });
    deepEqual(await sendChargeNotice(db, context, quiet.id, NoticeTemplate.Reminder, clock, { offsetDays: 0, channel: 'email' }), {
      channels: []
    });
    equal(sent.pushes.length + sent.emails.length, 0);

    const skipped = (await EventRepository.list(db, quiet.id, 'notice.skipped')).map((event) => event.payload);

    equal(skipped.length, 3);
    ok(skipped.every((payload) => payload['reason'] === 'silenced'));
    deepEqual(skipped.map((payload) => payload['template']).sort(), ['initial', 'reminder', 'reminder']);
    ok(skipped.some((payload) => payload['offsetDays'] === 0));

    await announceCharges(db, context, [quiet.id], clock);

    equal(sent.pushes.length + sent.emails.length, 0, 'no initial notice for a silenced charge');
    equal(notify.events.has(notifyIdentifier(quiet.id)), false);

    notify.events.clear();
    await planReminders(db, notify, instantAt(DUE_DATE, REMINDER_HOUR, TZ).getTime() - 3600_000);

    equal(notify.events.has(notifyIdentifier(quiet.id)), false);
    ok(notify.events.has(notifyIdentifier(control.id)), 'the charge beside it is still planned');

    deepEqual(await NotificationRepository.manualReminder(db, OWNER, quiet.id, context, () => clock), { queued: true });
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, quiet.address);
  });

  it('drops the e-mail follow-up of a charge silenced after its push', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[silenced-followup]', 'silenced-followup');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: ['push'] });

    const armed = notify.events.get(notifyIdentifier(id));

    ok(armed);
    await ChargeRepository.silence(db, OWNER, id, true);

    deepEqual(await followUpCharge(db, context, armed.event, armed.date.getTime()), { channels: [] });
    equal(sent.emails.length, 0);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api test:integration`
Expected: FAIL nos dois testes novos — os avisos saem por e-mail, `planReminders` agenda a cobrança silenciada e o reforço envia o e-mail.

- [ ] **Step 3: Gate no envio**

Em `send.ts`, em `sendChargeNotice`, logo depois do bloco `if (charge.proof_state === StoredProofState.Pending) {…}`:

```ts
  // The creditor paused the automatic notices: only the manual reminder (channel 'both') still reaches the debtor.
  if (charge.silenced && options.channel !== 'both') {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { template, ...(options.offsetDays === undefined ? {} : { offsetDays: options.offsetDays }), reason: 'silenced' }
    });
    return { channels: [] };
  }
```

- [ ] **Step 4: Reforço, aviso inicial e plano**

Em `followUpCharge`, trocar o `findOne` e o primeiro `if` por:

```ts
  const charge = await db.charges.findOne({ select: { state: true, proof_state: true, silenced: true }, where: { id: event.chargeId } });

  if (!charge || charge.state !== ChargeState.Pending || charge.proof_state === StoredProofState.Pending) {
    return { channels: [] };
  }

  // Silenced between the push and this e-mail: the creditor's latest word wins.
  if (charge.silenced) {
    return { channels: [] };
  }
```

Em `announceCharges`, trocar o `select` por `select: { payer: true, due_date: true, billing_id: true, silenced: true },` e, logo depois do `if (!charge || ChargeRepository.payer(charge) === ChargePayer.Owner) {…}`:

```ts
    // A silenced charge gets no hello; the manual reminder is still there.
    if (charge.silenced) {
      continue;
    }
```

Em `planReminders`, trocar o `select` por `select: { id: true, billing_id: true, due_date: true, proof_state: true, silenced: true },` e, logo depois do `if (charge.proof_state === StoredProofState.Pending) {…}`:

```ts
    if (charge.silenced) {
      continue;
    }
```

Um agendamento `charge:<id>:notify` armado antes do silêncio continua existindo: o disparo passa por `sendChargeNotice` e cai no gate. Nada é cancelado.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: limpos; os testes novos e os de notificação existentes passam.

- [ ] **Step 6: Parar para o usuário commitar**

---

### Task 5: OpenAPI, BFF e cliente mobile

**Files:**
- Modify: `docs/api-oas.yml` (gerado)
- Modify: `packages/web/src/lib/financial-proxy.ts:10-26`, `packages/web/src/lib/financial-proxy.test.ts`
- Modify: `packages/web/src/app/api/financial/[...path]/route.ts`
- Modify: `packages/mobile/src/financial/client.ts`, `packages/mobile/src/financial/client.test.ts`

**Interfaces:**
- Consumes: rotas `PUT /billings/{id}/participants/{userId}/silenced` e `PUT /charges/{id}/silenced` (Task 3).
- Produces:
  - BFF aceita `PUT /api/financial/billings/{id}/participants/{userId}/silenced` e `PUT /api/financial/charges/{id}/silenced`
  - `financialClient.silenceParticipant(billingId: string, userId: string, silenced: boolean): Promise<BillingDetail>`
  - `financialClient.silenceCharge(id: string, silenced: boolean): Promise<ChargeDetail>`

- [ ] **Step 1: Regenerar a OpenAPI**

Run: `pnpm --filter @receivy/api openapi:generate`
Expected: `docs/api-oas.yml` ganha `put` em `/billings/{id}/participants/{userId}/silenced` e em `/charges/{id}/silenced`, e `silenced` nas partes `user` do split e em `ChargeDetail`/`BillingAllocation`.

- [ ] **Step 2: Escrever os testes que falham**

Em `financial-proxy.test.ts`, na lista de rotas permitidas, depois de `["POST", "charges/charge-id/proof/declaration"],`:

```ts
    ["PUT", "billings/id/participants/user-id/silenced"], ["PUT", "charges/charge-id/silenced"],
```

E na lista de recusadas, depois de `["POST", "charges/charge-id/payments"], ["GET", "charges/charge-id/proofs"], ["GET", "charges/charge-id/proof"],`:

```ts
    ["POST", "charges/charge-id/silenced"], ["PUT", "charges/charge-id/silenced/extra"], ["PATCH", "billings/id/participants/user-id/silenced"], ["PUT", "billings/id/participants/user-id"],
```

Em `mobile/src/financial/client.test.ts`, antes do `});` final:

```ts
  it("switches the notices of a participant and of a charge with PUT", async () => {
    const authenticatedFetch = jest.fn().mockResolvedValue(Response.json({ id: "x" }));
    const client = createFinancialClient({ authenticatedFetch });

    await client.silenceParticipant("billing", "user", true);
    await client.silenceCharge("charge", false);

    expect(authenticatedFetch).toHaveBeenNthCalledWith(1, "billings/billing/participants/user/silenced", { method: "PUT", body: JSON.stringify({ silenced: true }) });
    expect(authenticatedFetch).toHaveBeenNthCalledWith(2, "charges/charge/silenced", { method: "PUT", body: JSON.stringify({ silenced: false }) });
  });
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- src/lib`
Expected: FAIL — `isAllowedFinancialRoute` recusa os dois `PUT`, e `openapi-contract.test.ts` acusa as operações novas sem rota no BFF e os caminhos sem cobertura no cliente Expo.

Run: `cd packages/mobile && pnpm test -- src/financial/client.test.ts`
Expected: FAIL — `client.silenceParticipant is not a function`.

- [ ] **Step 4: Implementar**

Em `financial-proxy.ts`, depois da linha `["PATCH", new RegExp(`^billings/${ID}$`)],`:

```ts
  ["PUT", new RegExp(`^billings/${ID}/participants/${ID}/silenced$`)], ["PUT", new RegExp(`^charges/${ID}/silenced$`)],
```

Em `app/api/financial/[...path]/route.ts`, depois de `export const POST = handle;`:

```ts
export const PUT = handle;
```

Em `mobile/src/financial/client.ts`, depois de `resolveGuest(…) {…},`:

```ts
    silenceParticipant(billingId: string, userId: string, silenced: boolean) {
      return request<BillingDetail>(`billings/${billingId}/participants/${userId}/silenced`, { method: "PUT", body: JSON.stringify({ silenced }) }, "Não foi possível atualizar os avisos.");
    },
```

E depois de `declarePayment(id: string) {…},`:

```ts
    silenceCharge(id: string, silenced: boolean) {
      return request<ChargeDetail>(`charges/${id}/silenced`, { method: "PUT", body: JSON.stringify({ silenced }) }, "Não foi possível atualizar os avisos.");
    },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test -- src/lib`
Expected: PASS.

Run: `cd packages/mobile && npx tsc --noEmit -p tsconfig.json && pnpm test -- src/financial/client.test.ts`
Expected: PASS.

Run: `pnpm --filter @receivy/api openapi:check`
Expected: "OpenAPI matches reflected routes and schemas."

- [ ] **Step 6: Parar para o usuário commitar**

---

### Task 6: Web — formulário, detalhe da conta e detalhe da cobrança

**Files:**
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx:164-188,296-307,666-684`
- Modify: `packages/web/src/components/screens/billing-detail-screen.tsx:3-4,185-187,320-326,381-409,582-696,803-856`
- Modify: `packages/web/src/components/screens/charge-detail-screen.tsx:3-25,192-205,319-326,343-353,395-402`
- Test: `packages/web/src/components/forms/billing-form-screen.test.tsx`, `packages/web/src/components/screens/billing-detail-screen.test.tsx`, `packages/web/src/components/screens/charge-detail-screen.test.tsx`

**Interfaces:**
- Consumes: `BillingDraft.silenced`, `BillingAllocation.silenced`, `ChargeSummary.silenced`, `canSilenceCharge` (Task 1); BFF `PUT` (Task 5).
- Produces: chave `role="switch"` com nome `Não notificar {nome}` por participante no formulário; botões `Não notificar {nome}` / `Voltar a notificar {nome}` nas linhas do detalhe da conta; botão `Não notificar esta cobrança` / `Voltar a notificar` no detalhe da cobrança; selo "Sem avisos".

- [ ] **Step 1: Escrever os testes que falham**

Em `billing-form-screen.test.tsx`, depois do teste `'shows the validation error inline when no contact is selected'`:

```tsx
it("sends Não notificar on the participant it was switched for", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");

  const quiet = screen.getByRole("switch", { name: "Não notificar Ana" });

  expect(quiet).not.toBeChecked();
  expect(screen.getByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeInTheDocument();

  await user.click(quiet);
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");
  expect(JSON.parse(String(post?.init.body)).split).toEqual({
    mode: "equal",
    parts: [{ kind: "user", userId: "u1", silenced: true }, { kind: "owner" }],
  });
});

it("offers Não notificar only on a conta a receber", async () => {
  api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));

  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(screen.queryByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).not.toBeInTheDocument();
});
```

E ao final do arquivo (depois de `indefiniteBilling` existir):

```tsx
it("seeds Não notificar from the allocations and sends the new value on edit", async () => {
  const silencedBilling: BillingDetail = {
    ...indefiniteBilling,
    allocations: [{ kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 9_000, currency: "BRL" }, order: 0, silenced: true }],
  };
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(silencedBilling) : undefined));
  const { user } = renderForm(silencedBilling);

  const quiet = await screen.findByRole("switch", { name: "Não notificar Ana" });

  expect(quiet).toBeChecked();

  await user.click(quiet);
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");
  expect(JSON.parse(String(patch?.init.body)).split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u1", silenced: false }] });
});
```

Em `billing-detail-screen.test.tsx`, ao final:

```tsx
it("silences a participant after confirmation and turns the notices back on without asking", async () => {
  const quietBilling = billing({
    charges: [charge({ id: "c6", name: "Carlos" })],
    allocations: [{ kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 6_000, currency: "BRL" }, order: 0, silenced: true }],
  });
  const loudBilling = billing({ charges: quietBilling.charges, allocations: [{ ...quietBilling.allocations[0]!, silenced: false }] });
  const bodies: string[] = [];
  const calls = await open(loudBilling, (path, init) => {
    if (path !== "/api/financial/billings/b1/participants/u1/silenced" || init?.method !== "PUT") return undefined;

    bodies.push(String(init.body));

    return Response.json(JSON.parse(String(init.body)).silenced ? quietBilling : loudBilling);
  });
  const user = setup();

  expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Não notificar Carlos" }));

  const dialog = await screen.findByRole("dialog", { name: "Não notificar Carlos?" });

  expect(within(dialog).getByText("Os lembretes automáticos das cobranças pendentes e futuras de Carlos nesta conta param.")).toBeInTheDocument();
  expect(calls).not.toContain("PUT /api/financial/billings/b1/participants/u1/silenced");

  await user.click(within(dialog).getByRole("button", { name: "Não notificar" }));

  expect(await screen.findByText("Sem avisos")).toBeInTheDocument();
  expect(bodies).toEqual(['{"silenced":true}']);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Voltar a notificar Carlos" }));

  expect(await screen.findByText("Avisos reativados para Carlos.")).toBeInTheDocument();
  expect(bodies).toEqual(['{"silenced":true}', '{"silenced":false}']);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();
});
```

Em `charge-detail-screen.test.tsx`, antes do `});` que fecha o `describe`:

```tsx
  it("pauses and resumes the notices of one charge, keeping Lembrar", async () => {
    const put = vi.fn((silenced: boolean) => Response.json(charge({ direction: Direction.Receivable, silenced })));

    vi.mocked(browserFetch).mockImplementation(async (path, init) => {
      if (init?.method === "PUT" && path === "/api/financial/charges/charge/silenced") {
        return put(JSON.parse(String(init.body)).silenced);
      }

      return Response.json(charge({ direction: Direction.Receivable }));
    });

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Não notificar esta cobrança" }));

    expect(await screen.findByText("Avisos desta cobrança pausados.")).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith(true);
    expect(screen.getByText("Sem avisos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lembrar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Voltar a notificar" }));

    expect(await screen.findByText("Avisos reativados.")).toBeInTheDocument();
    expect(put).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();
  });

  it("offers no notice switch to whoever owes", async () => {
    serve(charge());

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Valor a pagar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: FAIL — não existe `switch` "Não notificar Ana", nem botão "Não notificar Carlos", nem "Não notificar esta cobrança".

- [ ] **Step 3: Formulário**

Em `billing-form-screen.tsx`, antes de `draftFromBilling`:

```tsx
/** Each participant's current "Não notificar", so saving the edit sends back what the billing already has. */
function silencedFromBilling(billing: BillingDetail): Record<string, boolean> {
  const silenced: Record<string, boolean> = {};

  for (const allocation of billing.allocations) {
    if (allocation.kind === SplitPartKind.User && allocation.userId) {
      silenced[allocation.userId] = allocation.silenced;
    }
  }

  return silenced;
}
```

Em `draftFromBilling`, depois de `reminders: …,`:

```tsx
    silenced: silencedFromBilling(billing),
```

Depois da função `toggle`:

```tsx
  function switchSilenced(userId: string, silenced: boolean) {
    update({ silenced: { ...draft.silenced, [userId]: silenced } });
  }
```

No fieldset "Participantes", logo depois do bloco `{chosen.length > 0 && (<div className="flex flex-wrap gap-2">…</div>)}` dos chips:

```tsx
        {chosen.length > 0 && (
          <div className="flex flex-col gap-2">
            {chosen.map(contact => (
              <label key={contact.userId} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <InitialsAvatar name={contact.displayName} size={24} avatar={contact.avatar} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-semibold text-ink">{contact.displayName}</span>
                    <span className="text-[11px] text-muted">Não notificar</span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Não notificar ${contact.displayName}`}
                  className="h-5 w-5 accent-primary"
                  checked={draft.silenced?.[contact.userId] === true}
                  onChange={event => switchSilenced(contact.userId, event.target.checked)}
                />
              </label>
            ))}
            <p className="m-0 text-[11px] text-muted">Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.</p>
          </div>
        )}
```

O fieldset já é `disabled={locked || frozen}` e só aparece com `!payable`: a chave some na conta a pagar e fica desabilitada numa conta Única/Parcelada em edição.

- [ ] **Step 4: Detalhe da conta**

Em `billing-detail-screen.tsx`:
- no import de `@receivy/common`, acrescentar `SplitPartKind` e `type BillingAllocation`;
- no import de `lucide-react`, acrescentar `BellOff`;
- depois de `const [confirmReopen, setConfirmReopen] = useState<ChargeDetail | null>(null);`:

```tsx
  // The participant whose notices wait for the owner's confirmation before going quiet.
  const [confirmSilence, setConfirmSilence] = useState<{ userId: string; name: string } | null>(null);
```

- depois da função `reopen`:

```tsx
  /** "Não notificar" / "Voltar a notificar" for one participant; the answer is the billing with its pending charges updated. */
  async function silenceParticipant(detail: BillingDetail, userId: string, name: string, silenced: boolean) {
    await run(async () => {
      const updated = await request<BillingDetail>(`/api/financial/billings/${detail.id}/participants/${userId}/silenced`, jsonInit("PUT", { silenced }), "Não foi possível atualizar os avisos.");

      setBilling(updated);
      setConfirmSilence(null);

      if (silenced) {
        return;
      }

      setNotice(`Avisos reativados para ${name}.`);
    }, "Não foi possível atualizar os avisos.");
  }
```

- depois da função `statusLine` (dentro do componente, depois do early return, sem hooks):

```tsx
  /** The participant behind a row while the billing still splits with them; a conta a pagar has none. */
  function participantOf(detail: BillingDetail, charge: ChargeDetail): BillingAllocation | undefined {
    if (detail.direction === "payable") {
      return undefined;
    }

    return detail.allocations.find((allocation) => allocation.kind === SplitPartKind.User && allocation.userId === charge.debtorUserId);
  }

  /** Silencing asks first; turning the notices back on does not. */
  function toggleSilence(detail: BillingDetail, participant: BillingAllocation, name: string) {
    const userId = participant.userId;

    if (!userId) {
      return;
    }

    if (participant.silenced) {
      void silenceParticipant(detail, userId, name, false);
      return;
    }

    setConfirmSilence({ userId, name });
  }
```

- no `current?.charges.map`, depois de `const avatar = …;`:

```tsx
              const participant = participantOf(billing, charge);
              const quiet = participant?.silenced === true;
```

- no botão "Abrir cobrança de …", trocar `<span className="block truncate text-sm font-semibold text-ink">{name}</span>` por:

```tsx
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-ink">{name}</span>
                          {quiet && <StatusTag label="Sem avisos" tone="neutral" compact />}
                        </span>
```

- no fim do `<article>` da linha, depois do bloco `{charge.state === "paid" && !ended && (…)}`:

```tsx
                  {participant && !ended && (
                    <div className="flex justify-end border-t border-outline/20 pt-2.5">
                      <button
                        type="button"
                        aria-label={quiet ? `Voltar a notificar ${name}` : `Não notificar ${name}`}
                        disabled={busy}
                        onClick={() => toggleSilence(billing, participant, name)}
                        className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted disabled:opacity-50"
                      >
                        {quiet ? <Bell size={12} aria-hidden="true" /> : <BellOff size={12} aria-hidden="true" />}
                        {quiet ? "Voltar a notificar" : "Não notificar"}
                      </button>
                    </div>
                  )}
```

- depois do diálogo `confirmReopen`:

```tsx
      {confirmSilence && (
        <ConfirmDialog
          title={`Não notificar ${confirmSilence.name}?`}
          icon={BellOff}
          tone="primary"
          explanation={`Os lembretes automáticos das cobranças pendentes e futuras de ${confirmSilence.name} nesta conta param.`}
          confirmLabel="Não notificar"
          busy={busy}
          onConfirm={() => void silenceParticipant(billing, confirmSilence.userId, confirmSilence.name, true)}
          onCancel={() => setConfirmSilence(null)}
        />
      )}
```

- [ ] **Step 5: Detalhe da cobrança**

Em `charge-detail-screen.tsx`:
- no import de `@receivy/common`, acrescentar `canSilenceCharge` entre `canShare` e `canUploadProof`;
- no import de `lucide-react`, acrescentar `BellOff`;
- depois da função `cancel`:

```tsx
  async function silence(silenced: boolean) {
    await run(async () => {
      setCharge(await request<ChargeDetail>(`${base}/silenced`, jsonInit("PUT", { silenced }), "Não foi possível atualizar os avisos."));
      setNotice(silenced ? "Avisos desta cobrança pausados." : "Avisos reativados.");
    }, "Não foi possível atualizar os avisos.");
  }
```

- depois de `const cancellable = canCancelCharge(charge);`: `const silenceable = canSilenceCharge(charge);`
- no hero, trocar `<StatusTag label={state.label} tone={state.tone} compact />` por:

```tsx
              <div className="flex items-center gap-1.5">
                {charge.silenced && <StatusTag label="Sem avisos" tone="neutral" compact />}
                <StatusTag label={state.label} tone={state.tone} compact />
              </div>
```

- trocar o bloco `{shareable && (<div className="flex justify-end px-1">…Trocar e compartilhar link…</div>)}` por:

```tsx
              {(shareable || silenceable) && (
                <div className="flex justify-end gap-4 px-1">
                  {silenceable && (
                    <button type="button" disabled={busy} onClick={() => void silence(!charge.silenced)} className="inline-flex min-h-8 items-center gap-1 text-[11px] font-semibold text-muted disabled:opacity-50">
                      {charge.silenced ? <Bell size={12} aria-hidden="true" /> : <BellOff size={12} aria-hidden="true" />}
                      {charge.silenced ? "Voltar a notificar" : "Não notificar esta cobrança"}
                    </button>
                  )}
                  {shareable && (
                    <button type="button" disabled={busy} onClick={() => void shareLink(true)} className="min-h-8 text-[11px] font-semibold text-primary disabled:opacity-50">
                      Trocar e compartilhar link
                    </button>
                  )}
                </div>
              )}
```

O "Lembrar" continua no mesmo lugar, na fileira de `ActionTile` logo acima. Erros da API (`SILENCE_UNAVAILABLE`, `CHARGE_CLOSED`) aparecem pelo `run` como as outras ações.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @receivy/web test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: PASS.

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: PASS em todas as suítes.

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 7: Mobile — formulário, detalhe da conta e detalhe da cobrança

**Files:**
- Modify: `packages/mobile/src/components/forms/billing-form-screen.tsx:211-235,459-461,840-859`
- Modify: `packages/mobile/src/components/screens/billing-detail-screen.tsx:5-36,375,428,619-731`
- Modify: `packages/mobile/src/components/screens/charge-detail-screen.tsx:6-41,322,356,384-394,432-471`
- Test: `packages/mobile/src/components/forms/billing-form-screen.test.tsx`, `packages/mobile/src/components/screens/billing-detail-screen.test.tsx`, `packages/mobile/src/components/screens/charge-detail-screen.test.tsx`

**Interfaces:**
- Consumes: `BillingDraft.silenced`, `BillingAllocation.silenced`, `ChargeSummary.silenced`, `canSilenceCharge` (Task 1); `financialClient.silenceParticipant`, `financialClient.silenceCharge` (Task 5).
- Produces: `Switch` com `accessibilityLabel` `Não notificar {nome}` no formulário; `Client` do detalhe da conta passa a exigir `silenceParticipant`; `Client` do detalhe da cobrança aceita `silenceCharge` opcional; mesmos textos da Task 6.

- [ ] **Step 1: Escrever os testes que falham**

Em `billing-form-screen.test.tsx`, depois do teste `'drops the owner from the split when I do not take part'`:

```tsx
  it("sends Não notificar on the participant it was switched for", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();

    expect(screen.getByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Não notificar Ana")).toHaveProp("value", false);

    await fireEvent(screen.getByLabelText("Não notificar Ana"), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u1", silenced: true }, { kind: "owner" }] });
  });

  it("seeds Não notificar from the allocations and sends the new value on edit", async () => {
    const silencedBilling: BillingDetail = {
      ...onceBilling,
      id: "b3",
      type: BillingType.Indefinite,
      frequency: BillingFrequency.Monthly,
      allocations: [{ kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 9_000, currency: "BRL" }, order: 0, silenced: true }],
    };
    const patchBilling = jest.fn().mockResolvedValue(silencedBilling);

    await render(<BillingFormScreen client={financialApi({ patchBilling }) as never} contacts={contactsApi()} billing={silencedBilling} onSaved={jest.fn()} onBack={jest.fn()} />);

    const quiet = await screen.findByLabelText("Não notificar Ana");

    expect(quiet).toHaveProp("value", true);

    await fireEvent(quiet, "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling.mock.calls[0][1].split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u1", silenced: false }] });
  });
```

Em `billing-detail-screen.test.tsx`:
- acrescentar `type BillingAllocation` ao import de `@receivy/common`;
- em `makeClient`, depois de `resolveGuest: …,`: `silenceParticipant: jest.fn().mockResolvedValue(detail),`
- antes do `});` que fecha o `describe`:

```tsx
  it("silences a participant after confirmation and turns the notices back on without asking", async () => {
    const allocation: BillingAllocation = { kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 6_000, currency: "BRL" }, order: 0, silenced: false };
    const loud = billing({ charges: [charge({ id: "c6", name: "Carlos" })], allocations: [allocation] });
    const quiet = billing({ charges: loud.charges, allocations: [{ ...allocation, silenced: true }] });
    const silenceParticipant = jest.fn(async (_billingId: string, _userId: string, silenced: boolean) => (silenced ? quiet : loud));

    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Não notificar")?.onPress?.());

    await open(makeClient(loud, { silenceParticipant }));
    await fireEvent.press(screen.getByRole("button", { name: "Não notificar Carlos" }));

    expect(Alert.alert).toHaveBeenCalledWith("Não notificar Carlos?", "Os lembretes automáticos das cobranças pendentes e futuras de Carlos nesta conta param.", expect.any(Array));
    await waitFor(() => expect(silenceParticipant).toHaveBeenCalledWith("b1", "u1", true));
    expect(await screen.findByText("Sem avisos")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Voltar a notificar Carlos" }));

    await waitFor(() => expect(silenceParticipant).toHaveBeenLastCalledWith("b1", "u1", false));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Avisos reativados para Carlos.")).toBeOnTheScreen();
    expect(screen.queryByText("Sem avisos")).toBeNull();
  });
```

Em `charge-detail-screen.test.tsx`, antes do `});` que fecha o `describe`:

```tsx
  it("pauses and resumes the notices of one charge, keeping Lembrar", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      silenceCharge: jest.fn(async (_id: string, silenced: boolean) => charge({ direction: Direction.Receivable, silenced })),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Não notificar esta cobrança" }));

    await waitFor(() => expect(client.silenceCharge).toHaveBeenCalledWith("charge", true));
    expect(await screen.findByText("Avisos desta cobrança pausados.")).toBeOnTheScreen();
    expect(screen.getByText("Sem avisos")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Lembrar" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Voltar a notificar" }));

    await waitFor(() => expect(client.silenceCharge).toHaveBeenLastCalledWith("charge", false));
    expect(await screen.findByText("Avisos reativados.")).toBeOnTheScreen();
    expect(screen.queryByText("Sem avisos")).toBeNull();
  });

  it("offers no notice switch to whoever owes", async () => {
    const client = { charge: jest.fn().mockResolvedValue(charge()), cancel: jest.fn(), pay: jest.fn(), publicLink: jest.fn(), publicChargeUrl: jest.fn(), silenceCharge: jest.fn() };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Valor a pagar")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).toBeNull();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/mobile && pnpm test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: FAIL — não existem "Não notificar Ana", "Não notificar Carlos" nem "Não notificar esta cobrança".

- [ ] **Step 3: Formulário**

Em `forms/billing-form-screen.tsx`, antes de `draftFromBilling`:

```tsx
/** Each participant's current "Não notificar", so saving the edit sends back what the billing already has. */
function silencedFromBilling(billing: BillingDetail): Record<string, boolean> {
  const silenced: Record<string, boolean> = {};

  for (const allocation of billing.allocations) {
    if (allocation.kind === SplitPartKind.User && allocation.userId) {
      silenced[allocation.userId] = allocation.silenced;
    }
  }

  return silenced;
}
```

Em `draftFromBilling`, depois de `reminders: …,`:

```tsx
    silenced: silencedFromBilling(billing),
```

Depois da função `toggle`:

```tsx
  function switchSilenced(userId: string, silenced: boolean) {
    update({ silenced: { ...draft.silenced, [userId]: silenced } });
  }
```

Em "Participantes", logo depois do bloco `{chosen.length > 0 && (<View className="flex-row flex-wrap gap-2">…</View>)}` dos chips:

```tsx
            {chosen.length > 0 && (
              <View className="gap-2">
                {chosen.map((contact) => (
                  <View key={contact.userId} className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
                    <View className="flex-1 flex-row items-center gap-2.5">
                      <InitialsAvatar name={contact.displayName} size={24} avatar={contact.avatar} />
                      <View className="flex-1">
                        <Text className="text-xs font-semibold text-ink" numberOfLines={1}>
                          {contact.displayName}
                        </Text>
                        <Text className="text-[11px] text-muted">Não notificar</Text>
                      </View>
                    </View>
                    <Switch
                      accessibilityLabel={`Não notificar ${contact.displayName}`}
                      disabled={locked || frozen}
                      value={draft.silenced?.[contact.userId] === true}
                      onValueChange={(value) => switchSilenced(contact.userId, value)}
                      trackColor={{ true: colors.primary }}
                    />
                  </View>
                ))}
                <Text className="text-[11px] text-muted">Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.</Text>
              </View>
            )}
```

- [ ] **Step 4: Detalhe da conta**

Em `screens/billing-detail-screen.tsx`:
- no import de `@receivy/common`, acrescentar `SplitPartKind` e `type BillingAllocation`;
- no tipo `Client`, acrescentar `"silenceParticipant"` à lista do `Pick`;
- depois da função `confirmReopen`:

```tsx
  /** "Não notificar" / "Voltar a notificar" for one participant; the answer is the billing with its pending charges updated. */
  async function silenceParticipant(detail: BillingDetail, userId: string, name: string, silenced: boolean) {
    await run(async () => {
      setBilling(await client.silenceParticipant(detail.id, userId, silenced));

      if (silenced) {
        return;
      }

      setNotice(`Avisos reativados para ${name}.`);
    }, "Não foi possível atualizar os avisos.");
  }

  /** Silencing asks first; turning the notices back on does not. */
  function toggleSilence(detail: BillingDetail, participant: BillingAllocation, name: string) {
    const userId = participant.userId;

    if (!userId) {
      return;
    }

    if (participant.silenced) {
      void silenceParticipant(detail, userId, name, false);
      return;
    }

    Alert.alert(`Não notificar ${name}?`, `Os lembretes automáticos das cobranças pendentes e futuras de ${name} nesta conta param.`, [
      { text: "Voltar", style: "cancel" },
      { text: "Não notificar", onPress: () => void silenceParticipant(detail, userId, name, true) },
    ]);
  }
```

- depois da função `statusLine` (depois do early return, sem hooks):

```tsx
  /** The participant behind a row while the billing still splits with them; a conta a pagar has none. */
  function participantOf(detail: BillingDetail, charge: ChargeDetail): BillingAllocation | undefined {
    if (detail.direction === "payable") {
      return undefined;
    }

    return detail.allocations.find((allocation) => allocation.kind === SplitPartKind.User && allocation.userId === charge.debtorUserId);
  }
```

- no `current?.charges.map`, depois de `const avatar = …;`:

```tsx
            const participant = participantOf(billing, charge);
            const quiet = participant?.silenced === true;
```

- no `Pressable` "Abrir cobrança de …", trocar o `<Text className="text-sm font-semibold text-ink" numberOfLines={1}>{name}</Text>` por:

```tsx
                      <View className="flex-row items-center gap-1.5">
                        <Text className="shrink text-sm font-semibold text-ink" numberOfLines={1}>
                          {name}
                        </Text>
                        {quiet && <Tag label="Sem avisos" tone="neutral" />}
                      </View>
```

- no fim da `View` da linha, depois do bloco `{charge.state === "paid" && (…)}`:

```tsx
                {participant && !ended && (
                  <View className="flex-row items-center justify-end border-t border-outline/20 pt-2.5">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={quiet ? `Voltar a notificar ${name}` : `Não notificar ${name}`}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={() => toggleSilence(billing, participant, name)}
                      className={`min-h-8 justify-center px-1 ${busy ? "opacity-50" : ""}`}
                    >
                      <Text className="text-[11px] font-semibold text-muted">{quiet ? "Voltar a notificar" : "Não notificar"}</Text>
                    </Pressable>
                  </View>
                )}
```

- [ ] **Step 5: Detalhe da cobrança**

Em `screens/charge-detail-screen.tsx`:
- no import de `@receivy/common`, acrescentar `canSilenceCharge` (depois de `canShare`) e `ChargeTone`;
- no tipo `Client`, trocar `"reopen" | "paymentMethods" | "savePaymentMethod" | "declarePayment"` por `"reopen" | "paymentMethods" | "savePaymentMethod" | "declarePayment" | "silenceCharge"`;
- depois da função `withdrawProof`:

```tsx
  async function silence(silenced: boolean) {
    if (!client.silenceCharge) {
      return;
    }

    const detail = await run(() => client.silenceCharge!(id, silenced), "Não foi possível atualizar os avisos.");

    if (!detail) {
      return;
    }

    setCharge(detail);
    setNotice(silenced ? "Avisos desta cobrança pausados." : "Avisos reativados.");
  }
```

- depois de `const cancellable = canCancelCharge(charge);`: `const silenceable = !!client.silenceCharge && canSilenceCharge(charge);`
- no hero, trocar `<StatusTag label={state.label} tone={state.tone} compact />` por:

```tsx
            <View className="flex-row items-center gap-1.5">
              {charge.silenced && <StatusTag label="Sem avisos" tone={ChargeTone.Neutral} compact />}
              <StatusTag label={state.label} tone={state.tone} compact />
            </View>
```

- nas ações rápidas, depois do `Pressable` "Trocar e compartilhar link" (ainda dentro da `View className="gap-2.5"`):

```tsx
            {silenceable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={charge.silenced ? "Voltar a notificar" : "Não notificar esta cobrança"}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void silence(!charge.silenced)}
                className="min-h-8 items-end justify-center px-1"
              >
                <Text className="text-[11px] font-semibold text-muted">{charge.silenced ? "Voltar a notificar" : "Não notificar esta cobrança"}</Text>
              </Pressable>
            )}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd packages/mobile && pnpm test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: PASS.

Run: `cd packages/mobile && npx tsc --noEmit -p tsconfig.json && pnpm lint && pnpm test`
Expected: PASS em todas as suítes. As rotas `src/app/(protected)/billings/[id].tsx` e `src/app/(protected)/charges/[id].tsx` não passam `client`, então usam o `financialClient` completo, que tem `silenceParticipant` e `silenceCharge` desde a Task 5.

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 8: Documentação, roteiro de QA e seed

**Files:**
- Modify: `docs/notifications.md` (seção nova antes de `## Local`)
- Modify: `docs/api-errors.md` (seção nova ao final)
- Modify: `docs/manual-qa-script.md` (seção `## 20. Sem avisos` antes de `## Divergências`)
- Modify: `packages/api/scripts/seed-local.mjs:198-266,568-627`

**Interfaces:**
- Consumes: tudo das Tasks 1–7 (sem código novo de produção).

- [ ] **Step 1: `docs/notifications.md`**

Antes de `## Local`:

```md
## Sem avisos

The owner of a conta a receber can switch off the automatic notices of one participant or of one charge
("Não notificar"). The only value the notice gate reads is `charges.silenced`. `allocations.silenced` is the
participant's default: `persistChargePlan` copies it to every charge created for them (creation, the monthly sweep,
charges an edit or an invite creates).

- `sendChargeNotice` records `notice.skipped { template, offsetDays?, reason: 'silenced' }` and sends nothing for a
  silenced charge, unless the channel is `'both'`: the manual reminder ("Lembrar") still goes out.
- `announceCharges` skips a silenced charge before the initial notice, `planReminders` does not arm it and
  `followUpCharge` sends no e-mail when the charge was silenced after its push. None of the three records an event.
- A `charge:<id>:notify` schedule armed before the charge was silenced still fires, goes through `sendChargeNotice`
  and hits the gate. Nothing is cancelled. Switching the notices back on resends nothing: the next planned reminder
  goes out, one whose day already passed is lost.
- Not silenced: the payment notices (`notice.payment`: Pagamento informado, Comprovante recebido, Pagamento
  confirmado, Pagamento não identificado), the manual reminder, and the owner's own reminders on a conta a pagar.

`PUT /billings/{id}/participants/{userId}/silenced` writes the allocation and the participant's pending charges
(`billing.participant_silenced` / `billing.participant_unsilenced { userId }`); a `PATCH /billings/{id}` whose split
changes the value of someone who stays does the same. `PUT /charges/{id}/silenced` writes one charge
(`charge.silenced` / `charge.unsilenced`). Sending the value already stored writes and records nothing. A conta a
pagar answers 409 `SILENCE_UNAVAILABLE`. Only the creditor reads `silenced: true`; whoever owes always reads `false`.
```

- [ ] **Step 2: `docs/api-errors.md`**

Ao final do arquivo:

```md
## Silence errors

| Code | Status | When |
|---|---|---|
| `SILENCE_UNAVAILABLE` | 409 | `PUT /billings/{id}/participants/{userId}/silenced` or `PUT /charges/{id}/silenced` on a conta a pagar |
```

- [ ] **Step 3: `docs/manual-qa-script.md`**

Antes de `## Divergências`:

```md
## 20. Sem avisos

Como Ana, com Bruno e Carla na agenda (vencimento hoje, para o aviso inicial sair na hora):

- [ ] Nova conta a receber com Bruno e Carla. Ligar "Não notificar" do Bruno; aparece "Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente." Criar. Esperado: só a Carla recebe o aviso inicial no Mailpit; a cobrança do Bruno fica sem `notice.sent`.
- [ ] Detalhe da conta: a linha do Bruno mostra o selo "Sem avisos"; a da Carla não.
- [ ] "Não notificar" na linha da Carla. Esperado: confirmação "Não notificar Carla?" com "Os lembretes automáticos das cobranças pendentes e futuras de Carla nesta conta param."; confirmar mostra o selo e grava `billing.participant_silenced { userId }`.
- [ ] "Voltar a notificar" na linha da Carla. Esperado: sem confirmação; aviso "Avisos reativados para Carla."; o selo some.
- [ ] Abrir a cobrança do Bruno: selo "Sem avisos" junto ao status e "Voltar a notificar" logo abaixo das ações, com "Lembrar" ao lado. Tocar. Esperado: "Avisos reativados."; o selo some só nessa cobrança (a linha do Bruno no detalhe da conta continua com o selo).
- [ ] "Não notificar esta cobrança" na mesma cobrança. Esperado: "Avisos desta cobrança pausados."
- [ ] `Lembrar` na cobrança silenciada. Esperado: o lembrete manual chega no Mailpit.
- [ ] Conta recorrente com o Bruno silenciado: editar, desligar a chave dele e salvar. Esperado: as pendentes do Bruno perdem o selo; o evento `billing.participant_unsilenced` aparece.
- [ ] Como Bruno (login dele): a cobrança não mostra "Sem avisos" em lugar nenhum.
- [ ] Conta a pagar: `curl -X PUT <api>/charges/<id>/silenced -H 'content-type: application/json' -d '{"silenced":true}'` com o token da Ana. Esperado: 409 `SILENCE_UNAVAILABLE`.
- [ ] Mobile: os mesmos passos no formulário, no detalhe da conta (a confirmação é o alerta nativo) e na cobrança.
```

- [ ] **Step 4: Seed**

Em `packages/api/scripts/seed-local.mjs`:

1. Na conta `aluguel`, trocar `{ person: 'caio', shares: 1 }` por `{ person: 'caio', shares: 1, silenced: true }`.
2. Na conta `emprestimo`, depois de `pix: 'email',`:

```js
    // Only this charge is silenced: Caio's allocation still notifies.
    silenceCharge: true,
```

3. No objeto de `rows.allocations.push({…})`, depois de `allocation_order: order,`:

```js
        silenced: part.silenced ? true : null,
```

4. No objeto `charge` montado dentro do laço, depois de `proof_reason: …,`:

```js
          silenced: debtor.silenced || billing.silenceCharge ? true : null,
```

5. Logo depois do `event('charge.created', …);` do laço:

```js
        if (billing.silenceCharge) {
          event('charge.silenced', 'charge', chargeId, creditorId, {}, createdAtCharge);
        }
```

A cobrança de uma allocation silenciada nasce silenciada sem evento, como na API.

- [ ] **Step 5: Verificar**

Run: `cd packages/api && npx biome check scripts/seed-local.mjs && node --env-file=local.env scripts/seed-local.mjs seed-check@example.test --dry-run`
Expected: Biome limpo; o dry-run conclui sem erro (requer as colunas `silenced` no banco local, criadas pelo usuário com a migração do topo do plano).

Run: `pnpm --filter @receivy/api openapi:check`
Expected: "OpenAPI matches reflected routes and schemas."

- [ ] **Step 6: Parar para o usuário commitar**

---

## Self-review

- **Cobertura da spec:** dados e contrato (Tasks 1–2); criação, processamento mensal, edição e convite copiando `silenced` (Task 2, via `persistChargePlan` e `saveAllocations`); `GET /billings/{id}`, `GET /charges/{id}`, timeline e ledger (Task 2); rotas novas, erros 404/409, eventos e "mesmo valor sem evento" (Task 3); gate de envio, `planReminders`, `announceCharges`, `followUpCharge`, manual intacto, agendamento antigo caindo no gate (Task 4); BFF, OpenAPI e cliente (Task 5); formulário, selos e ações web (Task 6) e mobile (Task 7); `notifications.md`, `api-errors.md`, roteiro de QA e seed (Task 8). Fora de escopo mantido: padrão no contato, selo/filtro no feed e nas listas, silenciar pushes de pagamento ou o manual, avisos do dono em conta a pagar.
- **Testes pedidos na spec:** API — criação, mensal, edição preserva/aplica (Task 2); rota do participante com pagas/canceladas intactas, 404 outro usuário e não participante, 409 conta a pagar, sem evento no mesmo valor (Task 3); rota da cobrança só grava a cobrança, 409 fechada e conta a pagar, 404 para quem não é credor (Task 3); envio com `notice.skipped { reason: 'silenced' }` para inicial, lembrete e reforço, `planReminders` sem agendar, manual enviando, silêncio entre push e reforço (Task 4). Common — tipos e `canSilenceCharge` (Task 1). Web e mobile — chave no corpo, confirmação do participante com selo, alternância na cobrança com "Lembrar" visível (Tasks 6–7). Proxy — rotas permitidas e variações recusadas (Task 5).
- **Placeholders:** nenhum TBD, nenhum "igual à Task N"; todo passo de código traz o código, com nomes e fixtures tirados dos arquivos atuais.
- **Nomes conferidos entre tarefas:** `silenced` (split, `BillingAllocation`, `ChargeSummary`, `BillingDraft`, colunas), `canSilenceCharge`, `SilenceUnavailableError` / `SILENCE_UNAVAILABLE`, `BillingRepository.SilenceChange`, `BillingRepository.saveAllocations` → `SilenceChange[]`, `silencedParticipants`, `silencedFor`, `silencePendingCharges`, `participantSilenceEvent`, `silencedDebtors`, `BillingRepository.silenceParticipant`, `ChargeRepository.silence`, `silenceParticipantHandler` / `silenceBillingParticipant`, `silenceChargeHandler` / `silenceCharge`, `financialClient.silenceParticipant`, `financialClient.silenceCharge`, `switchSilenced`, `silencedFromBilling`, `participantOf`, `toggleSilence`; eventos `billing.participant_silenced`, `billing.participant_unsilenced`, `charge.silenced`, `charge.unsilenced`; motivo `silenced`.
- **Ambiguidades e lacunas da spec** (decididas nas Notas de leitura): campo opcional em `ChargeSummary`; mesmo valor não grava nada; eventos de `PATCH` só para quem continua; devedor sempre lê `false`; `announceCharges`/`followUpCharge` sem evento; seção 7 do QA ocupada (vira 20); texto de apoio único; chave desabilitada em conta congelada; mensagem de `SILENCE_UNAVAILABLE` criada aqui; `PUT` no CORS.
