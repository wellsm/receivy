# Registros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono registra um valor que já recebeu ou já pagou (avulso ou recorrente), com a contraparte só pelo nome, sem participantes nem avisos; cada ocorrência fica paga no dia do vencimento e entra em "Recebido"/"Pago" do mês.

**Architecture:** `billings.settled` e `billings.counterpart_label` marcam o registro. `normalizeBillingInput` impõe as regras (só o dono, nome de 1 a 120, nada de participantes/recebedor/Pix/lembretes, recorrente a partir de hoje na criação). `planBillingCharges` gera uma cobrança por vencimento com o total, e `persistChargePlan` — o ponto por onde passam criação, processamento mensal, edição do mês e convite — não copia Pix e quita na mesma transação o que já venceu (`charge.paid { via: 'registered' }`, `paid_at` no início do dia do vencimento no fuso da conta). O `BillingCron` chama `BillingRepository.settleRegistered` depois de `materializeDueBillings` para o que venceu desde então, pulando cobrança reaberta. `sendChargeNotice`, `announceCharges`, `planReminders`, `followUpCharge` e o lembrete manual ganham o gate `settled`. Web e mobile mostram a chave "Já recebi"/"Já paguei", o campo "De quem"/"Para quem", o selo "Registro" e escondem o que um registro não tem.

**Tech Stack:** EZ4 0.52 (API, `node:test` + `DatabaseTester` em `receivy_tests`), `@receivy/common` (vitest), Next 16 + Tailwind (web, vitest), Expo + Uniwind (mobile, jest/RNTL 14).

**Spec:** `docs/superpowers/specs/2026-09-15-registros-design.md`

## Global Constraints

- Nunca commitar, nunca rodar migração, nunca deploy: cada tarefa termina em "parar para o usuário commitar".
- Sem dependência nova (o ícone web usa `Wallet`, que já existe em `lucide-react@0.544.0`).
- Código, identificadores e comentários em inglês; textos de UI e mensagens de erro em pt-BR, exatamente como escritos aqui (copiados da spec).
- API: repositórios em `export namespace`, helpers privados fora do namespace, contexto desestruturado nos handlers, `const enum` comparado por membro (nunca por literal).
- Códigos de erro novos, ambos 409: `SETTLED_LOCKED` — classe `SettledLockedError` em `packages/api/src/billings/errors.ts`, mensagem "Não dá para mudar um registro depois de criado."; `SETTLED_NO_REMINDERS` — classe `SettledNoRemindersError` em `packages/api/src/charges/errors.ts` (ao lado de `ChargeInReviewError`), mensagem "Registros não têm avisos.". As duas entram no `409` de `httpErrors` em `api.ts`.
- Repositórios não importam serviços de notificação novos (o teste `src/import-cycles.test.ts` barra ciclos).
- Nunca rodar `biome check --write`, `biome lint --fix` ou `biome --write` amplo: o safe fix `noConstEnum` transforma os `const enum` do projeto em `enum`. Formatar só os arquivos tocados com `npx biome format --write <arquivo>`. Se `biome check <arquivo>` acusar só ordem de import, mover o especificador à mão para onde o diff do diagnóstico mostra.
- Diálogo ou sheet com entrada transitória zera o estado no cancelar e no confirmar (este plano não cria nenhum).
- Sem one-liners densos nem ternários empilhados; sem hooks depois de early return.
- Antes de encerrar cada tarefa: lint e typecheck do pacote tocado.
- Comandos de verificação:
  - common: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
  - api: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
  - web: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
  - mobile: `cd packages/mobile && npx tsc --noEmit -p tsconfig.json && pnpm lint && pnpm test`

## Notas de leitura

- Decomposição: common (tipos, regras, categoria, gates e mapas de ícone) → persistência na API (colunas, criação, quitação em `persistChargePlan`, `PATCH`, leitura) → cron e notificações → OpenAPI → web → mobile → docs e seed. A persistência e as rotas ficam na mesma tarefa porque nenhuma rota nova é criada: tudo passa por `BillingRepository.create`/`patch` e pelos DTOs.
- O que o código atual obrigou a ajustar (e por quê):
  1. `planBillingCharges` só gera cobrança para partes `User` numa conta a receber; um registro a receber (split só do dono) sairia sem cobrança. `BillingPlanInput` ganha `settled?: boolean`, que usa o mesmo ramo da conta a pagar (uma cobrança por vencimento com o total, `userId = payeeUserId ?? null`).
  2. `persistChargePlan` recusa cobrança sem `userId` quando `payer !== owner` e copia a chave padrão da carteira em toda conta a receber. Para registro: aceita sem `userId`, não copia Pix (assim `sharingState` e `FirstSharePix` não aparecem) e quita o que vence até hoje. Como criação, `materializeNextOccurrence`, `rewriteMonthCharges` e `InviteRepository.joinSplit` passam por ali, a quitação vale em todo caminho que cria cobrança.
  3. `ChargeRepository.counterpartName` devolve "Você" sem devedor, e `recipientOf` devolve o nome do dono; web (detalhe da conta e da cobrança) lê `recipient.name`. As duas passam a devolver o nome livre do registro.
  4. `previewsFor` projeta só o que os contatos devem numa conta a receber (seria R$ 0 num registro); passa a projetar o total, como na conta a pagar.
  5. A timeline já conta o registro certo: a direção vem de `creditor_id` + `payer` (`ChargeRepository.direction`), e o registro a receber tem `payer = person` e credor = dono; `receivedTotal`/`paidTotal` somam cobranças pagas com vencimento no mês. Nada muda ali além dos campos novos; o teste da Task 2 confirma.
  6. Hoje uma conta a receber com split só do dono passa em `normalizeBillingInput` e é criada sem cobranças. A spec pede "receber só do dono sem settled continua recusado": `receivableSplit` passa a exigir ao menos uma parte `User` ("Selecione ao menos um contato."). Nenhum teste existente cria esse caso.
  7. Os mapas exaustivos `Record<BillingCategory, …>` estão em `common/billing-category.ts` (cores), `web/src/components/ui/category-icon.tsx` e `mobile/src/components/ui/category-icon.tsx` (ícones, o mobile com SVG em `assets/images/categories`). Os três entram na Task 1.
- Ambiguidades resolvidas aqui (registradas também no Self-review):
  1. A regra "recorrente começa hoje ou depois" só roda com relógio: `normalizeBillingInput(input, now?)` e `buildBillingInput(draft, now?)`. A API passa `now` na criação; `PATCH` e as edições dos apps não passam, senão um salário recorrente criado no mês passado não poderia mais ser renomeado.
  2. Num registro, `PATCH` com `split`, `paymentMethodId`, `pix`, `payeeUserId` ou `reminders` também responde 409 `SETTLED_LOCKED` (são os campos que a criação recusa; sem isso um `PATCH` colocaria participantes num registro).
  3. `settleRegistered` segue a regra literal da spec: toda cobrança `pending` de conta `settled` com vencimento até hoje, qualquer que seja o estado da conta. Pausar/encerrar com "Cancelar pendentes" deixa as cobranças `cancelled`, que o cron não toca; "Manter as deste mês" deixa pendentes que ainda quitam no dia.
  4. Além de `canRemind` (pedido na spec), `canShare`, `canSilenceCharge` e `canUploadProof` devolvem `false` para registro: são os gates de "link público", "Não notificar" e "comprovante" que a seção 4 manda esconder. No detalhe da cobrança o `ProofCard` some e "Marcar como pago" vira um `ActionTile` com o mesmo nome acessível; "Reabrir" e "Cancelar" seguem as regras atuais.
  5. O selo "Registro" entra por `chargeBadges` (feed web e mobile), `billingBadges` (listas de contas, que também trocam "N pessoas"/recebedor pelo nome livre) e como chip no cabeçalho dos detalhes.
  6. A chave "Já recebi"/"Já paguei" aparece na criação e, na edição, só quando a conta é registro (travada, com "Não dá para mudar depois de criada.").
  7. `settled` e `counterpartLabel` entram no hash de idempotência só quando é registro, como `dueRule`.
  8. Categoria "Salário e renda": cor `#6E9A1F`, ícone `Wallet` no web e `income.svg` (o mesmo desenho do lucide) no mobile.
  9. O corpo HTTP aceita `counterpartLabel` até 200 caracteres (`String.Max<200>`), para que um nome acima de 120 receba a mensagem do domínio ("Informe de quem é o valor." / "Informe para quem é o valor.") e não o erro genérico de schema.
- Lacunas da spec (não implementadas, só registradas): a API não impede criar convite (`POST /billings/{id}/invite`) nem link público (`POST /charges/{id}/public-link`) numa conta registro; a UI esconde os dois. A spec não diz nada sobre "Cancelar" numa cobrança de registro; continua disponível.

### Migração (do usuário, não é passo de tarefa)

```sql
ALTER TABLE billings ADD COLUMN counterpart_label text;
ALTER TABLE billings ADD COLUMN settled boolean;
```

A categoria nova só muda a restrição `billings_category_ck`, que o EZ4 sincroniza no `serve`/deploy. O `test:integration` recria o banco de teste (`--reset`) a partir dos schemas, então os testes da API não dependem dessa migração. O banco local (`serve --local` sem `--reset`) e o seed dependem.

## File map

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/common/src/domain/billing.ts`, `contracts.ts` | `settled`/`counterpartLabel` em `BillingInput`, `BillingPatch`, `BillingSummary`, `BillingDetail`, `ChargeSummary` |
| `packages/common/src/domain/billing-calendar.ts` | `normalizeBillingInput(input, now?)`, `normalizeCounterpartLabel`, split só do dono, receber sem contato recusado |
| `packages/common/src/domain/billing-category.ts` | `BillingCategory.Income`, rótulo e cor |
| `packages/common/src/domain/billing-plan.ts` | `BillingPlanInput.settled` |
| `packages/common/src/domain/billing-draft.ts` | `BillingDraft.settled`/`counterpartLabel`, `buildBillingInput(draft, now?)` |
| `packages/common/src/domain/charge-text.ts`, `feed.ts`, `billing-card.ts` | gates, selo "Registro", badges da lista |
| `packages/web/src/components/ui/category-icon.tsx`, `packages/mobile/src/components/ui/category-icon.tsx`, `packages/mobile/assets/images/categories/income.svg` | ícone da categoria nova |
| `packages/api/src/billings/schemas/billing.ts`, `billings/utils/body.ts`, `billings/services/request.ts`, `billings/errors.ts`, `api.ts` | colunas, corpo, hash, `SettledLockedError` |
| `packages/api/src/charges/services/materialize.ts` | quitação e ausência de Pix em `persistChargePlan` |
| `packages/api/src/charges/repositories/charge.ts`, `timeline/repositories/timeline.ts` | `settledBilling`, nome livre, DTO, `markRegistered` |
| `packages/api/src/billings/repositories/billing.ts` | criação, `PATCH`, DTOs, projeção, `settleRegistered` |
| `packages/api/src/billings/crons/materialize.ts` | chamada do `settleRegistered` |
| `packages/api/src/notifications/services/send.ts`, `notifications/repositories/notification.ts`, `charges/errors.ts` | gate `settled`, `SettledNoRemindersError` |
| `packages/api/test/billings/registros.spec.ts` (novo), `test/notifications/notifications.spec.ts` | integração |
| `docs/api-oas.yml` | contrato regenerado |
| `packages/web/src/components/forms/billing-form-screen.tsx`, `screens/billing-detail-screen.tsx`, `screens/charge-detail-screen.tsx` | UI web |
| `packages/mobile/src/components/forms/billing-form-screen.tsx`, `screens/billing-detail-screen.tsx`, `screens/charge-detail-screen.tsx` | UI mobile |
| `docs/notifications.md`, `docs/api-errors.md`, `docs/manual-qa-script.md`, `packages/api/scripts/seed-local.mjs` | documentação e dados de teste |

---

### Task 1: Contrato, regras e categoria em `@receivy/common`

**Files:**
- Modify: `packages/common/src/domain/billing.ts:57-78,82-103,126-151,153-186` (`BillingInput`, `BillingPatch`, `BillingSummary`, `BillingDetail`)
- Modify: `packages/common/src/domain/contracts.ts:52-82` (`ChargeSummary`)
- Modify: `packages/common/src/domain/billing-category.ts`
- Modify: `packages/common/src/domain/billing-calendar.ts:1-14,157-250`
- Modify: `packages/common/src/domain/billing-plan.ts:5-15,53`
- Modify: `packages/common/src/domain/billing-draft.ts:29-56,182-227`
- Modify: `packages/common/src/domain/charge-text.ts:152-164,194-236`
- Modify: `packages/common/src/domain/feed.ts:65-104,126-145`
- Modify: `packages/common/src/domain/billing-card.ts:48-81`
- Modify: `packages/web/src/components/ui/category-icon.tsx`
- Modify: `packages/mobile/src/components/ui/category-icon.tsx`
- Create: `packages/mobile/assets/images/categories/income.svg`
- Test: `packages/common/src/domain/billing-category.test.ts`, `billing-calendar.test.ts`, `billing-plan.test.ts`, `billing-draft.test.ts`, `charge-text.test.ts`, `feed.test.ts`, `billing-card.test.ts`

**Interfaces:**
- Produces:
  - `BillingInput.settled?: boolean`, `BillingInput.counterpartLabel?: string` (e, por extensão, em `NormalizedBillingInput`)
  - `BillingPatch.settled?: boolean`, `BillingPatch.counterpartLabel?: string`
  - `BillingSummary.settled?: boolean`, `BillingSummary.counterpartLabel?: string | null`; os mesmos dois em `BillingDetail` e `ChargeSummary` (e `ChargeDetail`, por extensão)
  - `normalizeBillingInput(input: BillingInput, now?: Date): NormalizedBillingInput` — com `settled: true` devolve `split = { mode: 'equal', parts: [{ kind: 'owner' }] }`, `settled: true` e `counterpartLabel` aparado; sem `settled`, `settled` e `counterpartLabel` saem `undefined`
  - `normalizeCounterpartLabel(label: string | undefined, direction: Direction): string` — lança `RangeError('Informe de quem é o valor.')` (receber) ou `RangeError('Informe para quem é o valor.')` (pagar)
  - mensagens `RangeError('Registro não tem participantes nem avisos.')`, `RangeError('Registro recorrente começa hoje ou depois.')` (só com `now`), `RangeError('Selecione ao menos um contato.')` (receber sem parte `User`)
  - `BillingCategory.Income = 'income'`, rótulo "Salário e renda", `BILLING_CATEGORY_COLORS.income = '#6E9A1F'`
  - `BillingPlanInput.settled?: boolean`
  - `BillingDraft.settled?: boolean`, `BillingDraft.counterpartLabel?: string`; `buildBillingInput(draft: BillingDraft, now?: Date): BillingInput`
  - `canRemind`, `canShare`, `canSilenceCharge` e `canUploadProof` devolvem `false` quando `charge.settled === true`
  - `chargeBadges` acrescenta `{ label: 'Registro', tone: BadgeTone.Neutral }` em registro; `chargeAction` nunca oferece "Lembrar" em registro
  - `billingBadges` de registro: `[tipo…, 'Registro', ('A pagar'), counterpartLabel]` no lugar de "N pessoas"/recebedor
  - `CATEGORY_ICONS.income` no web (`Wallet`) e no mobile (`income.svg`)

A API continua compilando: os campos novos são opcionais e `now` é opcional. Web e mobile só precisam do ícone novo nos mapas exaustivos.

- [ ] **Step 1: Escrever os testes que falham**

Em `billing-category.test.ts`, trocar o teste `'lists the new categories before Outro'` inteiro por:

```ts
  it('lists the new categories before Outro', () => {
    expect(BILLING_CATEGORIES.map((entry) => entry.label)).toEqual([
      'Alimentação',
      'Transporte',
      'Mercado',
      'Assinatura',
      'Empréstimo',
      'Moradia',
      'Viagem',
      'Saúde',
      'Educação',
      'Lazer',
      'Salário e renda',
      'Outro'
    ]);
  });
```

E, antes do `});` que fecha o `describe`:

```ts
  it('labels and tints Salário e renda', () => {
    expect(billingCategoryLabel(BillingCategory.Income)).toBe('Salário e renda');
    expect(billingCategoryColor(BillingCategory.Income)).toBe('#6E9A1F');
    expect(isBillingCategory('income')).toBe(true);
  });
```

Em `billing-calendar.test.ts`, trocar os imports do topo por:

```ts
import { describe, expect, it } from 'vitest';
import { BillingDueRule, BillingFrequency, type BillingInput, BillingType, DEFAULT_BILLING_REMINDERS, SplitPartKind } from './billing';
import {
  addCalendarDays,
  billingDates,
  billingDueDates,
  civilHour,
  endOfMonth,
  materializationDate,
  materializationHorizon,
  normalizeBillingInput,
  normalizeCounterpartLabel,
  zonedInstant
} from './billing-calendar';
import { Direction, PixKeyType, SplitMode } from './contracts';
import type { BillingSplit } from './split';
```

E, depois do `describe('billing calendar', …)` (antes de `describe('zonedInstant', …)`):

```ts
describe('registros', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const registro: BillingInput = {
    type: BillingType.Once,
    totalCents: 500_000,
    startDate: '2026-08-05',
    timezone: 'America/Sao_Paulo',
    settled: true,
    counterpartLabel: '  Empresa X  '
  };

  it('keeps only the owner, trims the name and accepts a past date on a single registro', () => {
    const normalized = normalizeBillingInput(registro, now);

    expect(normalized.split).toEqual({ mode: 'equal', parts: [{ kind: 'owner' }] });
    expect(normalized.direction).toBe('receivable');
    expect(normalized.settled).toBe(true);
    expect(normalized.counterpartLabel).toBe('Empresa X');
    expect(normalized.startDate).toBe('2026-08-05');
    expect(normalized.reminders).toBeUndefined();
  });

  it('asks for the name by direction, 1 to 120 characters', () => {
    expect(() => normalizeBillingInput({ ...registro, counterpartLabel: '   ' }, now)).toThrow('Informe de quem é o valor.');
    expect(() => normalizeBillingInput({ ...registro, direction: Direction.Payable, counterpartLabel: undefined }, now)).toThrow(
      'Informe para quem é o valor.'
    );
    expect(() => normalizeBillingInput({ ...registro, counterpartLabel: 'x'.repeat(121) }, now)).toThrow('Informe de quem é o valor.');
    expect(normalizeCounterpartLabel('x'.repeat(120), Direction.Payable)).toHaveLength(120);
  });

  it('refuses participants, a payee, a wallet key, a typed Pix and reminders', () => {
    const message = 'Registro não tem participantes nem avisos.';

    expect(() => normalizeBillingInput({ ...registro, split }, now)).toThrow(message);
    expect(() => normalizeBillingInput({ ...registro, direction: Direction.Payable, payeeUserId: 'ana' }, now)).toThrow(message);
    expect(() => normalizeBillingInput({ ...registro, paymentMethodId: 'pix-1' }, now)).toThrow(message);
    expect(() =>
      normalizeBillingInput({ ...registro, direction: Direction.Payable, pix: { keyType: PixKeyType.Email, key: 'loja@example.com' } }, now)
    ).toThrow(message);
    expect(() => normalizeBillingInput({ ...registro, reminders: [{ offsetDays: 0, enabled: true }] }, now)).toThrow(message);
  });

  it('starts a recorrente registro today or later, checked only when a clock is given', () => {
    const monthly: BillingInput = { ...registro, type: BillingType.Indefinite, frequency: BillingFrequency.Monthly };

    expect(() => normalizeBillingInput(monthly, now)).toThrow('Registro recorrente começa hoje ou depois.');
    expect(() => normalizeBillingInput({ ...monthly, type: BillingType.Until, endDate: '2026-12-05' }, now)).toThrow(
      'Registro recorrente começa hoje ou depois.'
    );
    expect(normalizeBillingInput({ ...monthly, startDate: '2026-09-15' }, now).startDate).toBe('2026-09-15');
    // Edits normalize without a clock, so an old recorrente registro stays editable.
    expect(normalizeBillingInput(monthly).settled).toBe(true);
  });

  it('still refuses a conta a receber without a contact when it is not a registro', () => {
    expect(() => normalizeBillingInput({ ...registro, settled: undefined, counterpartLabel: undefined })).toThrow(
      'Selecione ao menos um contato.'
    );
    expect(() =>
      normalizeBillingInput({ ...registro, settled: false, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] } })
    ).toThrow('Selecione ao menos um contato.');
  });
});
```

Em `billing-plan.test.ts`, ao final do arquivo:

```ts
describe('registro plan', () => {
  it('charges the whole total on every due date with nobody on the other side', () => {
    const plan = planBillingCharges({
      description: 'Salário',
      totalCents: 500_000,
      split: { mode: SplitMode.Equal, parts: [owner] },
      dueDates: ['2026-10-05', '2026-11-05'],
      numbered: false,
      settled: true
    });

    expect(plan.charges.map((charge) => [charge.userId, charge.amountCents, charge.dueDate])).toEqual([
      [null, 500_000, '2026-10-05'],
      [null, 500_000, '2026-11-05']
    ]);
  });
});
```

Em `billing-draft.test.ts`, ao final do arquivo:

```ts
describe('registro draft', () => {
  it('sends the name and the owner alone, without participants, payee, Pix or reminders', () => {
    const input = buildBillingInput({
      ...base,
      settled: true,
      counterpartLabel: ' Empresa X ',
      payee: 'p9',
      pix: 'pix-1',
      pixInline: { type: PixKeyType.Cpf, key: '529.982.247-25', label: '' }
    });

    expect(input).toMatchObject({
      direction: 'receivable',
      settled: true,
      counterpartLabel: 'Empresa X',
      split: { mode: 'equal', parts: [{ kind: 'owner' }] }
    });
    expect(input.reminders).toBeUndefined();
    expect(input.paymentMethodId).toBeUndefined();
    expect(input.payeeUserId).toBeUndefined();
    expect(input.pix).toBeUndefined();
  });

  it('checks the start of a recorrente registro only with a clock', () => {
    const monthly: BillingDraft = { ...base, settled: true, counterpartLabel: 'Empresa X', type: BillingType.Indefinite };

    expect(() => buildBillingInput(monthly, new Date('2026-09-15T12:00:00Z'))).toThrow('Registro recorrente começa hoje ou depois.');
    expect(buildBillingInput(monthly).startDate).toBe('2026-01-31');
  });
});
```

Em `charge-text.test.ts`, ao final do arquivo:

```ts
describe('registros', () => {
  const pix = { keyType: PixKeyType.Email, key: 'pay@example.com', label: 'Pix' };
  const received = charge({ direction: Direction.Receivable, ownedByViewer: true, pix, debtorUserId: null, settled: true, counterpartLabel: 'Empresa X' });
  const paid = charge({ direction: Direction.Payable, payer: ChargePayer.Owner, ownedByViewer: true, debtorUserId: null, confirmationRequired: false, settled: true });

  it('never reminds, shares, silences or takes a proof, and still settles and reopens by hand', () => {
    expect(canRemind(received)).toBe(false);
    expect(canRemind({ ...received, settled: false })).toBe(true);
    expect(canShare(received)).toBe(false);
    expect(canShare({ ...received, settled: false })).toBe(true);
    expect(canSilenceCharge(received)).toBe(false);
    expect(canSilenceCharge({ ...received, settled: false })).toBe(true);
    expect(canMarkPaid(received)).toBe(true);
    expect(canReopenCharge({ ...received, state: ChargeState.Paid })).toBe(true);
    expect(canUploadProof(paid)).toBe(false);
    expect(canUploadProof({ ...paid, settled: false })).toBe(true);
    expect(canMarkPaid(paid)).toBe(true);
  });
});
```

Em `feed.test.ts`, ao final do arquivo:

```ts
describe('registros in the feed', () => {
  const registro: ChargeSummary = { ...base, counterpartName: 'Empresa X', settled: true, counterpartLabel: 'Empresa X' };

  it('badges a registro beside its status and never offers a reminder', () => {
    expect(chargeBadges(registro, '2026-09-01')).toEqual([{ label: 'Registro', tone: 'neutral' }]);
    expect(chargeBadges({ ...registro, state: ChargeState.Paid }, '2026-09-10')).toEqual([
      { label: 'Pago', tone: 'success' },
      { label: 'Registro', tone: 'neutral' }
    ]);
    expect(chargeAction(registro, Direction.Receivable)).toBeNull();
    expect(chargeAction({ ...registro, settled: false }, Direction.Receivable)).toEqual({ kind: 'remind', label: 'Lembrar' });
  });
});
```

Em `billing-card.test.ts`, ao final do arquivo:

```ts
describe('billingBadges on a registro', () => {
  it('names the counterpart instead of the people or the payee and marks it as a registro', () => {
    expect(billingBadges({ ...base, settled: true, counterpartLabel: 'Empresa X', participantCount: 0 }).map((badge) => badge.label)).toEqual([
      'Única',
      'Registro',
      'Empresa X'
    ]);
    expect(
      billingBadges({ ...base, direction: Direction.Payable, settled: true, counterpartLabel: 'Clínica Sorriso' }).map((badge) => badge.label)
    ).toEqual(['Única', 'Registro', 'A pagar', 'Clínica Sorriso']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/common && npx vitest run src/domain/billing-category.test.ts src/domain/billing-calendar.test.ts src/domain/billing-plan.test.ts src/domain/billing-draft.test.ts src/domain/charge-text.test.ts src/domain/feed.test.ts src/domain/billing-card.test.ts`
Expected: FAIL — `BillingCategory.Income` e `normalizeCounterpartLabel` não existem, `normalizeBillingInput` ignora `settled`, `planBillingCharges` não gera cobrança só do dono, os gates e badges não conhecem registro.

- [ ] **Step 3: Contrato**

Em `billing.ts`, em `BillingInput`, depois de `pix?: BillingPixInput;`:

```ts
  /** Registro: the owner already received or paid it. Every charge settles on its due date and nobody is notified. */
  settled?: boolean;
  /** Registro only: who the money came from (a receber) or went to (a pagar), 1 to 120 characters. */
  counterpartLabel?: string;
```

Em `BillingPatch`, depois de `category?: BillingCategory;`:

```ts
  /** Never changes after creation: a value other than the stored one answers 409 SETTLED_LOCKED. */
  settled?: boolean;
  /** Registro only: renames the counterpart. On any other conta it answers 409 SETTLED_LOCKED. */
  counterpartLabel?: string;
```

Em `BillingSummary`, depois de `payeeName: string | null;`, e em `BillingDetail`, depois de `payee: BillingPayee | null;`:

```ts
  /** Registro: the owner alone, already settled. The API always sends it; absent on older payloads, read as false. */
  settled?: boolean;
  /** Registro only: the counterpart typed by the owner; null on every other conta. */
  counterpartLabel?: string | null;
```

Em `contracts.ts`, em `ChargeSummary`, depois de `silenced?: boolean;`:

```ts
  /** The charge belongs to a registro: settled on its due date, never reminded, shared or proven. The API always sends it. */
  settled?: boolean;
  /** Registro only: the counterpart typed by the owner, the same text `counterpartName` carries; null otherwise. */
  counterpartLabel?: string | null;
```

- [ ] **Step 4: Categoria**

Em `billing-category.ts`:
- no `enum`, antes de `Other = 'other'`: `Income = 'income',`
- em `BILLING_CATEGORIES`, antes da entrada de `Other`: `{ value: BillingCategory.Income, label: 'Salário e renda' },`
- em `BILLING_CATEGORY_COLORS`, antes de `other: '#64748B'`: `income: '#6E9A1F',`

Em `packages/web/src/components/ui/category-icon.tsx`, trocar o import do `lucide-react` e o mapa por:

```tsx
import { Car, GraduationCap, Handshake, HeartPulse, House, Plane, Repeat, ShoppingCart, Tag, Ticket, Utensils, Wallet, type LucideIcon } from "lucide-react";

export const CATEGORY_ICONS: Record<BillingCategory, LucideIcon> = {
  food: Utensils,
  transport: Car,
  groceries: ShoppingCart,
  subscription: Repeat,
  loan: Handshake,
  housing: House,
  travel: Plane,
  health: HeartPulse,
  education: GraduationCap,
  leisure: Ticket,
  income: Wallet,
  other: Tag,
};
```

Criar `packages/mobile/assets/images/categories/income.svg` (o `wallet` do lucide, no mesmo formato dos outros ícones da pasta):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>
```

Em `packages/mobile/src/components/ui/category-icon.tsx`, no `CATEGORY_ICONS`, antes de `other: …`:

```tsx
  income: require("../../../assets/images/categories/income.svg"),
```

- [ ] **Step 5: Regras em `normalizeBillingInput`**

Em `billing-calendar.ts`, logo depois de `import { Direction, SplitMode } from './contracts';`:

```ts
import { calendarDate } from './financial-form';
```

(`financial-form.ts` não importa nada, então não há ciclo.)

Antes de `export function normalizeBillingInput`:

```ts
/** The free-text counterpart of a registro: 1 to 120 characters once trimmed. */
export function normalizeCounterpartLabel(label: string | undefined, direction: Direction): string {
  const value = label?.normalize('NFC').trim() ?? '';

  if (value.length >= 1 && value.length <= 120) {
    return value;
  }

  if (direction === Direction.Payable) {
    throw new RangeError('Informe para quem é o valor.');
  }

  throw new RangeError('Informe de quem é o valor.');
}

/** `now` turns on the rule only a creation obeys: a recorrente registro starts today or later. */
```

Trocar a assinatura por:

```ts
export function normalizeBillingInput(input: BillingInput, now?: Date): NormalizedBillingInput {
```

Trocar a linha `const split = direction === Direction.Payable ? payableSplit(input) : receivableSplit(input);` por:

```ts
  const settled = input.settled === true;
  // Checked before the split, so a registro reads its own message instead of the direction's.
  const counterpartLabel = settled ? registroLabel(input, direction, now) : undefined;
  const split = splitOf(input, direction, settled);
```

Trocar o `return { … };` final de `normalizeBillingInput` por:

```ts
  return {
    type: input.type,
    frequency: recurring ? input.frequency : undefined,
    description,
    totalCents: input.totalCents,
    startDate: input.startDate,
    endDate: input.type === BillingType.Until ? input.endDate : undefined,
    // Only the month end is carried: 'fixed' stays implicit, like before the rule existed.
    dueRule: monthEnd ? BillingDueRule.EndOfMonth : undefined,
    timezone: input.timezone,
    paymentMethodId: direction === Direction.Receivable ? input.paymentMethodId || undefined : undefined,
    reminders: input.reminders ? validateReminders(input.reminders) : undefined,
    split,
    category: input.category,
    direction,
    payeeUserId: direction === Direction.Payable ? input.payeeUserId?.trim() || undefined : undefined,
    pix: direction === Direction.Payable && input.pix ? normalizeBillingPix(input.pix) : undefined,
    settled: settled ? true : undefined,
    counterpartLabel
  };
```

Trocar a função `receivableSplit` inteira por:

```ts
/** A conta a receber always names who pays: at least one contact beside the owner. */
function receivableSplit(input: BillingInput): BillingSplit {
  const split = input.split;

  if (!split || !split.parts.some((part) => part.kind === SplitPartKind.User)) {
    throw new RangeError('Selecione ao menos um contato.');
  }

  return split;
}

/** The allocation behind a billing: the owner alone on a registro or a conta a pagar, the contacts on a conta a receber. */
function splitOf(input: BillingInput, direction: Direction, settled: boolean): BillingSplit {
  if (settled) {
    return { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] };
  }

  if (direction === Direction.Payable) {
    return payableSplit(input);
  }

  return receivableSplit(input);
}

/**
 * A registro is the owner's alone: it names the counterpart in free text and refuses anyone to split with, pay
 * through or remind. With a clock (creation), a recorrente registro may not start before today.
 */
function registroLabel(input: BillingInput, direction: Direction, now: Date | undefined): string {
  const label = normalizeCounterpartLabel(input.counterpartLabel, direction);
  const participants = input.split?.parts.some((part) => part.kind === SplitPartKind.User) === true;

  if (participants || input.payeeUserId || input.paymentMethodId || input.pix || input.reminders) {
    throw new RangeError('Registro não tem participantes nem avisos.');
  }

  if (now && input.type !== BillingType.Once && input.startDate < calendarDate(now, input.timezone)) {
    throw new RangeError('Registro recorrente começa hoje ou depois.');
  }

  return label;
}
```

- [ ] **Step 6: Plano de cobranças**

Em `billing-plan.ts`, em `BillingPlanInput`, depois de `payeeUserId?: string | null;`:

```ts
  /** A registro: one charge per due date for the whole total, like a conta a pagar, with nobody on the other side. */
  settled?: boolean;
```

Trocar `if (input.payer === ChargePayer.Owner) {` por:

```ts
  if (input.payer === ChargePayer.Owner || input.settled === true) {
```

- [ ] **Step 7: Draft**

Em `billing-draft.ts`, em `BillingDraft`, depois de `silenced?: Record<string, boolean>;`:

```ts
  /** "Já recebi" / "Já paguei": the draft is a registro. Absent on drafts stored before registros existed. */
  settled?: boolean;
  /** Registro only: the name typed in "De quem" / "Para quem". */
  counterpartLabel?: string;
```

Trocar `buildBillingInput` inteira por:

```ts
/** Shared pure review boundary; raw text stays in each platform's local UI. `now` is passed only on creation. */
export function buildBillingInput(draft: BillingDraft, now?: Date): BillingInput {
  const schedule = {
    type: draft.type,
    frequency: draft.type === BillingType.Once ? undefined : draft.frequency,
    description: draft.description,
    totalCents: parseBRLCents(draft.amount),
    startDate: draft.start,
    endDate: endDateFor(draft),
    dueRule: dueRuleFor(draft),
    category: draft.category,
    timezone: draft.timezone
  };

  // A registro names who is on the other side and has nobody to split with, pay through or remind.
  if (draft.settled) {
    return normalizeBillingInput(
      { ...schedule, direction: draft.direction, settled: true, counterpartLabel: draft.counterpartLabel ?? '' },
      now
    );
  }

  const base = {
    ...schedule,
    reminders: draft.reminders.map((reminder) => ({
      enabled: reminder.enabled,
      offsetDays: integer(reminder.offsetDays, 'Informe dias inteiros, como -3, 0 ou 2.')
    }))
  };

  if (draft.direction === Direction.Payable) {
    // The key is kept as typed (masked); the field spec turns it into the canonical form before validation.
    const key = pixKeyField(draft.pixInline.type).unformat(draft.pixInline.key).trim();

    return normalizeBillingInput(
      {
        ...base,
        direction: Direction.Payable,
        payeeUserId: draft.payee || undefined,
        pix: key ? { keyType: draft.pixInline.type, key, label: draft.pixInline.label.trim() || undefined } : undefined
      },
      now
    );
  }

  if (!draft.selected.length) {
    throw new RangeError('Selecione ao menos um contato.');
  }

  const parties = [
    ...draft.selected.map((userId) => ({ kind: SplitPartKind.User, userId, ...silencedOf(draft, userId) }) satisfies SplitParty),
    ...(draft.owner ? [{ kind: SplitPartKind.Owner } satisfies SplitParty] : [])
  ];

  return normalizeBillingInput(
    {
      ...base,
      direction: Direction.Receivable,
      paymentMethodId: draft.pix || undefined,
      split: buildSplit(draft, parties)
    },
    now
  );
}
```

`EMPTY_BILLING_DRAFT` não muda (o teste dele compara o objeto exato).

- [ ] **Step 8: Gates, selo e badges**

Em `charge-text.ts`, trocar o primeiro `if` de `canUploadProof` por:

```ts
  // A registro has nothing to prove: it was settled by the owner.
  if (charge.settled === true || charge.direction !== Direction.Payable || charge.state !== ChargeState.Pending) {
    return false;
  }
```

Trocar `canRemind`, `canShare` e `canSilenceCharge` por:

```ts
/** Reminders and public links belong to the creditor of a conta a receber only; a conta a pagar and a registro have neither. */
export function canRemind(charge: ChargeDetail): boolean {
  return (
    charge.settled !== true &&
    charge.state === ChargeState.Pending &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner &&
    !!charge.pix &&
    charge.counterpartReachable !== false &&
    // A file under review is the debtor's move already made; nagging now would be noise.
    charge.proofState !== ProofState.Pending
  );
}
```

```ts
export function canShare(charge: ChargeDetail): boolean {
  return (
    charge.settled !== true &&
    charge.state === ChargeState.Pending &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner &&
    !!charge.pix
  );
}
```

```ts
/** Only the creditor of a conta a receber pauses the automatic notices of a pending charge; a registro has none to pause. */
export function canSilenceCharge(charge: ChargeDetail): boolean {
  return (
    charge.settled !== true &&
    charge.state === ChargeState.Pending &&
    charge.ownedByViewer !== false &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner
  );
}
```

Em `feed.ts`, antes de `export function chargeBadges`:

```ts
/** The "Registro" seal rides beside whatever else the card says. */
function registroBadges(charge: ChargeSummary): ChargeBadge[] {
  if (charge.settled !== true) {
    return [];
  }

  return [{ label: 'Registro', tone: BadgeTone.Neutral }];
}
```

Em `chargeBadges`:
- trocar `return [{ label: 'Cancelado', tone: BadgeTone.Neutral }];` por `return [{ label: 'Cancelado', tone: BadgeTone.Neutral }, ...registroBadges(charge)];`
- trocar o `return [ charge.proofState === ProofState.Accepted ? … ];` do ramo `Paid` por:

```ts
    return [
      charge.proofState === ProofState.Accepted ? { label: 'Validado', tone: BadgeTone.Success } : { label: 'Pago', tone: BadgeTone.Success },
      ...registroBadges(charge)
    ];
```

- antes do `return badges;` final: `badges.push(...registroBadges(charge));`

Em `chargeAction`, trocar:

```ts
    if (ownBill || charge.counterpartReachable === false) {
```

por:

```ts
    // A registro has nobody to remind either.
    if (ownBill || charge.counterpartReachable === false || charge.settled === true) {
```

Em `billing-card.ts`, em `billingBadges`, logo antes de `if (billing.direction === Direction.Payable) {`:

```ts
  // A registro names its counterpart instead of the people or the payee.
  if (billing.settled === true) {
    badges.push({ label: 'Registro', tone: BadgeTone.Neutral });

    if (billing.direction === Direction.Payable) {
      badges.push({ label: 'A pagar', tone: BadgeTone.Warning });
    }

    if (billing.counterpartLabel) {
      badges.push({ label: billing.counterpartLabel, tone: BadgeTone.Neutral });
    }

    return badges;
  }
```

- [ ] **Step 9: Rodar e ver passar**

Run: `cd packages/common && npx vitest run src/domain/billing-category.test.ts src/domain/billing-calendar.test.ts src/domain/billing-plan.test.ts src/domain/billing-draft.test.ts src/domain/charge-text.test.ts src/domain/feed.test.ts src/domain/billing-card.test.ts`
Expected: PASS.

- [ ] **Step 10: Verificar os pacotes**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test`
Expected: tipos e Biome limpos, todas as suítes passando.

Run: `pnpm --filter @receivy/web check-types && cd packages/mobile && npx tsc --noEmit -p tsconfig.json`
Expected: sem erros (os mapas de ícone já têm `income`; nenhuma fixture muda porque os campos novos são opcionais).

Run: `cd packages/api && npx tsc -p tsconfig.json --noEmit`
Expected: sem erros (a API ainda não usa os campos novos).

- [ ] **Step 11: Parar para o usuário commitar**

---

### Task 2: Persistência, quitação na criação, `PATCH` e leitura na API

**Files:**
- Modify: `packages/api/src/billings/schemas/billing.ts:15-46` (`BillingSchema`)
- Modify: `packages/api/src/billings/utils/body.ts:44-80` (`BillingBody`, `PatchBody`)
- Modify: `packages/api/src/billings/services/request.ts:5-26`
- Modify: `packages/api/src/billings/errors.ts` (classe nova ao final)
- Modify: `packages/api/src/api.ts:3-15,68-102`
- Modify: `packages/api/src/charges/services/materialize.ts:1-10,131-205` (`persistChargePlan`)
- Modify: `packages/api/src/charges/repositories/charge.ts:1-60,225-297` (import, `recipientOf`, `counterpartName`, `dto`, funções novas no namespace)
- Modify: `packages/api/src/timeline/repositories/timeline.ts:144-168`
- Modify: `packages/api/src/billings/repositories/billing.ts` (imports, `previewsFor`, `summary`, `dto`, `rewriteMonthCharges`, `assertPatchAllowed`, `billingInputFrom`, `SELECT`, `Row`, `create`, `patch`, `materializeNextOccurrence`)
- Create: `packages/api/test/billings/registros.spec.ts`

**Interfaces:**
- Consumes: `BillingInput.settled`/`counterpartLabel`, `BillingPatch.settled`/`counterpartLabel`, `normalizeBillingInput(input, now?)`, `normalizeCounterpartLabel`, `BillingPlanInput.settled`, `BillingSummary`/`BillingDetail`/`ChargeSummary` `.settled` e `.counterpartLabel`, `BillingCategory.Income` (Task 1).
- Produces:
  - `BillingSchema.counterpart_label?: String.Max<120>`, `BillingSchema.settled?: boolean`; `BillingRepository.Row.counterpart_label?: string`, `BillingRepository.Row.settled?: boolean` (e os dois em `BillingRepository.SELECT`)
  - `BillingBody.settled?: boolean`, `BillingBody.counterpartLabel?: String.Max<200>`; os mesmos em `PatchBody`
  - `class SettledLockedError extends ConflictError` — code `SETTLED_LOCKED`, mensagem "Não dá para mudar um registro depois de criado.", no 409 de `api.ts`
  - `ChargeRepository.SettledBilling = { settled: boolean; counterpartLabel: string | null }`
  - `ChargeRepository.settledBilling(db: DbClient, row: Pick<ChargeRepository.Row, 'billing_id'>): Promise<ChargeRepository.SettledBilling>`
  - `ChargeRepository.markRegistered(db: DbClient, row: ChargeRepository.Row, timezone: string, now: string): Promise<ChargeRepository.Row>` — `state = paid`, `paid_at = zonedInstant(due_date, '00:00', timezone)`, evento `charge.paid { via: 'registered' }` com o dono como ator
  - `persistChargePlan` quita toda cobrança de registro com vencimento até hoje (fuso da conta), aceita cobrança sem `userId` em registro e nunca copia Pix para registro
  - `ChargeDetail.counterpartName`, `ChargeDetail.recipient.name` e `TimelineItem.charge.counterpartName` devolvem o nome livre do registro; `sharingState` de registro é `closed`
  - `BillingRepository.create` grava `settled`/`counterpart_label` e usa `normalizeBillingInput(raw, now)`; `BillingRepository.patch` aceita `counterpartLabel` e lança `SettledLockedError` nos casos da spec e da ambiguidade 2

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/api/test/billings/registros.spec.ts`:

```ts
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import {
  BillingCategory,
  BillingFrequency,
  type BillingInput,
  BillingType,
  calendarDate,
  ChargeState,
  Direction,
  PixKeyType,
  SharingState,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { SettledLockedError } from '../../src/billings/errors';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'f7777777-7777-4777-8777-777777777777';
const OTHER = 'f8888888-8888-4888-8888-888888888888';
const TZ = 'America/Sao_Paulo';
const date = (value: string) => new Date(`${value}T12:00:00Z`);

/** Start of the civil day in São Paulo (UTC−3): where a registro's charge is paid. */
const dayStart = (day: string) => Date.parse(`${day}T03:00:00.000Z`);

let anaId: string;
let pixId: string;

/** A registro a receber: the owner alone, the counterpart typed by hand, due in February. */
function registro(key: string, overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Once,
    description: key,
    category: BillingCategory.Income,
    totalCents: 500_000,
    startDate: '2026-02-20',
    timezone: TZ,
    settled: true,
    counterpartLabel: 'Empresa X',
    ...overrides
  };
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_user_id: true, due_date: true, state: true, paid_at: true, pix_key_snapshot: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return records;
}

async function paidVia(chargeId: string) {
  return (await EventRepository.list(db, chargeId, 'charge.paid')).map((event) => event.payload['via']);
}

describe('registros on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'registros-owner@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'registros-other@example.com', name: 'Outra' });

    anaId = (await ContactRepository.save(db, OWNER, { name: 'Ana', email: 'registros-ana@example.com' })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER]));

  it('refuses a registro without a name, with participants, a payee, Pix or reminders, and a recorrente in the past', async () => {
    const now = date('2026-03-05');
    const refuse = (key: string, input: BillingInput, message: string) =>
      rejects(() => BillingRepository.create(db, OWNER, key, input, now), { name: 'RangeError', message });
    const crowded = 'Registro não tem participantes nem avisos.';

    await refuse('registro-no-name', registro('Sem nome', { counterpartLabel: '  ' }), 'Informe de quem é o valor.');
    await refuse('registro-no-name-payable', registro('Sem nome', { direction: Direction.Payable, counterpartLabel: undefined }), 'Informe para quem é o valor.');
    await refuse(
      'registro-participant',
      registro('Com Ana', { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } }),
      crowded
    );
    await refuse('registro-payee', registro('Para Ana', { direction: Direction.Payable, payeeUserId: anaId }), crowded);
    await refuse('registro-wallet', registro('Com chave', { paymentMethodId: pixId }), crowded);
    await refuse(
      'registro-pix',
      registro('Com Pix', { direction: Direction.Payable, pix: { keyType: PixKeyType.Email, key: 'loja@example.com' } }),
      crowded
    );
    await refuse('registro-reminders', registro('Com lembrete', { reminders: [{ offsetDays: 0, enabled: true }] }), crowded);
    await refuse(
      'registro-monthly-past',
      registro('Salário atrasado', { type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-03-01' }),
      'Registro recorrente começa hoje ou depois.'
    );
    await refuse(
      'registro-until-past',
      registro('Parcelas antigas', { type: BillingType.Until, frequency: BillingFrequency.Monthly, startDate: '2026-02-01', endDate: '2026-06-01' }),
      'Registro recorrente começa hoje ou depois.'
    );
    await refuse(
      'receivable-owner-only',
      { type: BillingType.Once, totalCents: 1_000, startDate: '2026-03-10', timezone: TZ, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] } },
      'Selecione ao menos um contato.'
    );

    equal(await db.billings.count({ where: { owner_id: OWNER } }), 0, 'nothing was written');
  });

  it('pays a registro due by today at creation, on its due date, with nobody on the other side', async () => {
    const once = await BillingRepository.create(db, OWNER, 'registro-past', registro('Venda do sofá', { counterpartLabel: '  Empresa X  ' }), date('2026-03-05'));

    equal(once.settled, true);
    equal(once.counterpartLabel, 'Empresa X');
    deepEqual(
      once.allocations.map((allocation) => allocation.kind),
      ['owner']
    );

    const [row] = await chargeRows(once.id);

    ok(row);
    equal(row.state, ChargeState.Paid);
    equal(row.debtor_user_id ?? null, null);
    equal(row.pix_key_snapshot ?? null, null, 'the default wallet key never reaches a registro');
    equal(Date.parse(String(row.paid_at)), dayStart('2026-02-20'));
    deepEqual(await paidVia(row.id), ['registered']);

    const detail = await ChargeRepository.get(db, OWNER, row.id);

    equal(detail.direction, Direction.Receivable);
    equal(detail.counterpartName, 'Empresa X');
    equal(detail.recipient.name, 'Empresa X');
    equal(detail.settled, true);
    equal(detail.counterpartLabel, 'Empresa X');
    equal(detail.sharingState, SharingState.Closed);
    equal(detail.pix, null);

    const rent = await BillingRepository.create(
      db,
      OWNER,
      'registro-past-payable',
      registro('Aluguel de fevereiro', { direction: Direction.Payable, counterpartLabel: 'Imobiliária', startDate: '2026-02-10', category: BillingCategory.Housing }),
      date('2026-03-05')
    );
    const own = await ChargeRepository.get(db, OWNER, rent.charges[0]!.id);

    equal(own.state, ChargeState.Paid);
    equal(own.direction, Direction.Payable);
    equal(own.counterpartName, 'Imobiliária');

    const bonus = await BillingRepository.create(db, OWNER, 'registro-future', registro('Bônus', { startDate: '2026-03-20' }), date('2026-03-05'));

    equal(bonus.charges[0]!.state, ChargeState.Pending, 'a registro due later waits for its day');
    deepEqual(await paidVia(bonus.charges[0]!.id), []);
  });

  it('renames a registro and refuses to turn a conta into a registro or back', async () => {
    const once = await BillingRepository.create(db, OWNER, 'registro-rename', registro('Freela'), date('2026-03-05'));
    const renamed = await BillingRepository.patch(db, OWNER, once.id, { counterpartLabel: '  Empresa Y ' }, date('2026-03-06'));

    equal(renamed.counterpartLabel, 'Empresa Y');
    equal(renamed.charges[0]!.counterpartName, 'Empresa Y');
    equal((await BillingRepository.patch(db, OWNER, once.id, { settled: true }, date('2026-03-06'))).settled, true, 'the stored value is accepted');

    await rejects(() => BillingRepository.patch(db, OWNER, once.id, { settled: false }, date('2026-03-06')), SettledLockedError);
    await rejects(
      () => BillingRepository.patch(db, OWNER, once.id, { reminders: [{ offsetDays: 0, enabled: true }] }, date('2026-03-06')),
      SettledLockedError
    );
    await rejects(() => BillingRepository.patch(db, OWNER, once.id, { counterpartLabel: ' ' }, date('2026-03-06')), {
      name: 'RangeError',
      message: 'Informe de quem é o valor.'
    });

    const dinner = await BillingRepository.create(
      db,
      OWNER,
      'registro-common',
      {
        type: BillingType.Once,
        description: 'Jantar',
        totalCents: 2_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-05')
    );

    equal(dinner.settled, false);
    equal(dinner.counterpartLabel, null);
    await rejects(() => BillingRepository.patch(db, OWNER, dinner.id, { counterpartLabel: 'Empresa X' }, date('2026-03-06')), SettledLockedError);
    await rejects(() => BillingRepository.patch(db, OWNER, dinner.id, { settled: true }, date('2026-03-06')), SettledLockedError);
  });

  it('lists a registro by its counterpart and counts it in the month it is due', async () => {
    const now = new Date();
    const today = calendarDate(now, TZ);
    const salary = await BillingRepository.create(db, OTHER, 'registro-timeline-salary', registro('Salário', { startDate: today }), now);

    await BillingRepository.create(
      db,
      OTHER,
      'registro-timeline-rent',
      registro('Aluguel', { direction: Direction.Payable, counterpartLabel: 'Imobiliária', startDate: today, totalCents: 120_000 }),
      now
    );

    const listed = (await BillingRepository.list(db, OTHER)).billings.find((billing) => billing.id === salary.id);

    equal(listed?.settled, true);
    equal(listed?.counterpartLabel, 'Empresa X');
    equal(listed?.participantCount, 0);

    const page = await TimelineRepository.get(db, OTHER, {});

    equal(page.summary.receivedTotal.amountCents, 500_000);
    equal(page.summary.paidTotal.amountCents, 120_000);
    equal(page.summary.receivable.amountCents, 0, 'nothing is left open');

    const item = page.items.find((entry) => entry.charge.billingId === salary.id);

    equal(item?.direction, Direction.Receivable);
    equal(item?.charge.counterpartName, 'Empresa X');
    equal(item?.charge.settled, true);
    equal(item?.charge.counterpartLabel, 'Empresa X');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api check-types:test`
Expected: FAIL — `settled`/`counterpartLabel` não existem nos DTOs lidos pela API nem em `BillingRepository.Row`, e `SettledLockedError` não existe em `billings/errors`.

Run: `pnpm --filter @receivy/api test:integration`
Expected: FAIL nos quatro testes de `registros on native PostgreSQL` (depois do Step 3 a coluna existe, mas nada ainda grava ou quita).

- [ ] **Step 3: Colunas, corpo, hash e erro**

Em `billings/schemas/billing.ts`, em `BillingSchema`, depois de `pix_label?: String.Max<120>;`:

```ts
  /** Registro only: who the money came from or went to, typed by the owner. */
  counterpart_label?: String.Max<120>;
  /** True only on a registro: every charge settles on its due date and nobody is notified. Null reads as false. */
  settled?: boolean;
```

As colunas aceitam nulo; no banco local o usuário roda a migração do topo do plano. Não rodar na tarefa.

Em `billings/utils/body.ts`, em `BillingBody`, depois de `category?: BillingCategory;`:

```ts
  /** Registro: already received or paid; the owner alone, no participants, Pix or reminders. */
  settled?: boolean;
  /** Registro only; trimmed to 1–120 characters by the domain, which answers the pt-BR message. */
  counterpartLabel?: String.Max<200>;
```

Em `PatchBody`, depois de `category?: BillingCategory;`:

```ts
  settled?: boolean;
  counterpartLabel?: String.Max<200>;
```

Em `billings/services/request.ts`, no objeto do `JSON.stringify`, trocar a última linha `pix: input.pix ?? null` por:

```ts
      pix: input.pix ?? null,
      // Only a registro adds its fields, so replays of older requests keep their fingerprint.
      ...(input.settled ? { settled: true, counterpartLabel: input.counterpartLabel } : {})
```

Em `billings/errors.ts`, ao final:

```ts
export class SettledLockedError extends ConflictError {
  constructor(message = 'Não dá para mudar um registro depois de criado.') {
    super(message, 'SETTLED_LOCKED');
  }
}
```

Em `api.ts`:
- no import de `./billings/errors`, depois de `ReceivableHasNoPayeeError`: `SettledLockedError`
- na lista `409`, depois de `BillingInactiveError,`: `SettledLockedError,`

- [ ] **Step 4: Nome livre, DTO e quitação na cobrança**

Em `charges/repositories/charge.ts`, trocar o import de `@receivy/common` por:

```ts
import {
  type BillingType,
  type ChargeDetail,
  ChargePayer,
  type ChargeProof,
  ChargeState,
  Direction,
  type PixKeyType,
  ProofKind,
  type ProofMime,
  ProofState,
  SharingState,
  type UserAvatar,
  UserStatus,
  zonedInstant
} from '@receivy/common';
```

Trocar `recipientOf` por:

```ts
/** The person on the other side of the money, read live; a registro names its counterpart, a bill that is the owner's alone names the owner. */
async function recipientOf(db: DbClient, row: ChargeRepository.Row): Promise<ChargeDetail['recipient']> {
  const person = await ContactRepository.counterpartOf(db, row.debtor_user_id);

  if (person) {
    return { userId: row.debtor_user_id!, name: person.name, email: person.email, avatar: person.avatar };
  }

  const { counterpartLabel } = await ChargeRepository.settledBilling(db, row);

  if (counterpartLabel) {
    return { userId: null, name: counterpartLabel, email: null, avatar: null };
  }

  const owner = await ContactRepository.counterpartOf(db, row.creditor_id);

  return { userId: null, name: owner?.name ?? 'Conta excluída', email: null, avatar: owner?.avatar ?? null };
}
```

No namespace, logo depois de `owns`:

```ts
  /** Whether the billing behind a charge is a registro, and the counterpart it names. */
  export type SettledBilling = { settled: boolean; counterpartLabel: string | null };

  export async function settledBilling(db: DbClient, row: Pick<Row, 'billing_id'>): Promise<SettledBilling> {
    const billing = await db.billings.findOne({ select: { settled: true, counterpart_label: true }, where: { id: row.billing_id } });

    return { settled: billing?.settled === true, counterpartLabel: billing?.counterpart_label ?? null };
  }
```

Em `counterpartName`, trocar:

```ts
    // A conta a pagar without a payee is the owner's alone.
    if (!row.debtor_user_id) {
      return 'Você';
    }
```

por:

```ts
    // Nobody on the other side: a registro names its counterpart; a conta a pagar without a payee is the owner's alone.
    if (!row.debtor_user_id) {
      return (await settledBilling(db, row)).counterpartLabel ?? 'Você';
    }
```

Em `dto`, logo depois de `const hasPix = …;`:

```ts
    const record = await settledBilling(db, row);
```

No objeto devolvido, depois de `silenced: owns(row, userId) && row.silenced === true,`:

```ts
      settled: record.settled,
      counterpartLabel: record.counterpartLabel,
```

E trocar a primeira condição de `sharingState` (`row.state !== ChargeState.Pending || payer === ChargePayer.Owner`) por:

```ts
        row.state !== ChargeState.Pending || payer === ChargePayer.Owner || record.settled
```

(um registro nunca publica link.)

Depois de `silence` (antes de `pay`):

```ts
  /**
   * A registro's charge settles on its own due date: paid at the start of that day in the billing timezone, recorded as
   * `charge.paid { via: 'registered' }` by the owner. The caller has already checked it is pending.
   */
  export async function markRegistered(db: DbClient, row: Row, timezone: string, now: string): Promise<Row> {
    await db.charges.updateOne({
      where: { id: row.id },
      data: { state: ChargeState.Paid, paid_at: zonedInstant(row.due_date, '00:00', timezone), updated_at: now }
    });

    const updated = await db.charges.findOne({ select: SELECT, where: { id: row.id } });

    if (!updated) {
      throw new HttpNotFoundError();
    }

    await activity(db, { actorId: row.creditor_id, row: updated, type: 'charge.paid', now, payload: { via: 'registered' } });

    return updated;
  }
```

Em `timeline/repositories/timeline.ts`, no laço `for (const row of page)`, antes de `items.push({`:

```ts
      const record = await ChargeRepository.settledBilling(db, row);
```

E trocar a última linha do objeto `charge` (`silenced: ChargeRepository.owns(row, userId) && row.silenced === true`) por:

```ts
          silenced: ChargeRepository.owns(row, userId) && row.silenced === true,
          settled: record.settled,
          counterpartLabel: record.counterpartLabel
```

- [ ] **Step 5: `persistChargePlan` quita o registro e não copia Pix**

Em `charges/services/materialize.ts`, trocar o import de `@receivy/common` por:

```ts
import {
  type BillingPlan,
  type BillingType,
  calendarDate,
  ChargePayer,
  ChargeState,
  type PaymentMethod,
  SplitPartKind,
  UserStatus
} from '@receivy/common';
```

Antes de `recordCreation`:

```ts
/** How the billing behind new charges settles: a registro pays each charge due by today, in its own timezone. */
async function settlementOf(db: DbClient, billingId: string, now: string): Promise<{ settled: boolean; timezone: string; today: string }> {
  const row = await db.billings.findOne({ select: { settled: true, timezone: true }, where: { id: billingId } });

  if (!row) {
    throw new HttpNotFoundError();
  }

  return { settled: row.settled === true, timezone: row.timezone, today: calendarDate(new Date(now), row.timezone) };
}
```

Trocar o corpo de `persistChargePlan` (do `const rows` ao `return`) por:

```ts
  const rows: ChargeRepository.Row[] = [];
  const noticeChargeIds: string[] = [];

  // Creation, the monthly sweep, edits and invites all land here, after the allocations are saved.
  const silenced = await silencedDebtors(db, billing.id);
  const settlement = await settlementOf(db, billing.id, now);

  for (const item of plan.charges) {
    // A conta a pagar without a payee and a registro have no one on the other side.
    const recipient = item.userId ? context.recipients.get(item.userId) : undefined;

    if (item.userId && !recipient) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    if (!item.userId && context.payer !== ChargePayer.Owner && !settlement.settled) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    const inserted = await db.charges.insertOne({
      select: ChargeRepository.SELECT,
      data: {
        id: crypto.randomUUID(),
        creditor: { id: ownerId },
        ...(recipient ? { debtor_user: { id: recipient.userId } } : {}),
        payer: context.payer,
        billing: { id: billing.id },
        billing_type: billing.type,
        description: item.description,
        amount_cents: item.amountCents,
        currency: item.currency,
        due_date: item.dueDate,
        ...(item.installment !== null && item.installmentCount !== null
          ? { installment: item.installment, installment_count: item.installmentCount }
          : {}),
        // A registro is never paid through a link, so the wallet key stays out of it.
        ...(context.pix && !settlement.settled
          ? { pix_key_type_snapshot: context.pix.keyType, pix_key_snapshot: context.pix.key, pix_label_snapshot: context.pix.label }
          : {}),
        state: ChargeState.Pending,
        ...(recipient && silenced.has(recipient.userId) ? { silenced: true } : {}),
        created_at: now,
        updated_at: now
      }
    });

    await recordCreation(db, ownerId, inserted, now);

    // A registro is paid on its due date: whatever is already due settles in the same transaction.
    const due = settlement.settled && item.dueDate <= settlement.today;
    const row = due ? await ChargeRepository.markRegistered(db, inserted, settlement.timezone, now) : inserted;

    rows.push(row);
    noticeChargeIds.push(row.id);
  }

  return { rows, noticeChargeIds };
```

- [ ] **Step 6: Conta registro no repositório de contas**

Em `billings/repositories/billing.ts`:
- no import de `@receivy/common`, depois de `normalizeBillingInput,`: `normalizeCounterpartLabel,`
- no import de `../errors`, depois de `ReceivableHasNoPayeeError`: `SettledLockedError`

Em `previewsFor`, trocar o bloco de `projected` por:

```ts
  // A conta a pagar and a registro are owed in full; a conta a receber only projects what contacts owe.
  const projected =
    direction === Direction.Payable || row.settled === true
      ? row.total_cents
      : resolveBillingSplit(row.total_cents, (await BillingRepository.splitFor(db, row.id)).split)
          .filter((allocation) => allocation.kind === SplitPartKind.User)
          .reduce((sum, allocation) => sum + allocation.amountCents, 0);
```

Em `summary`, depois de `payeeName: payee?.name ?? null,`, e em `dto`, depois de `payee: await payeeOf(db, row),`:

```ts
    settled: row.settled === true,
    counterpartLabel: row.counterpart_label ?? null,
```

(no `dto` a indentação é de seis espaços, como os vizinhos.)

Em `rewriteMonthCharges`, no `planBillingCharges({…})`, trocar `payeeUserId: row.payee_user_id ?? null` por:

```ts
    payeeUserId: row.payee_user_id ?? null,
    settled: row.settled === true
```

Em `assertPatchAllowed`, logo depois do `if (row.state === BillingState.Ended) {…}`:

```ts
  const settled = row.settled === true;

  // A registro stays a registro, and only a registro has a free-text counterpart.
  if (patch.settled !== undefined && patch.settled !== settled) {
    throw new SettledLockedError();
  }

  if (patch.counterpartLabel !== undefined && !settled) {
    throw new SettledLockedError();
  }

  // What creation refused stays out: nobody to split with, pay through or remind.
  const crowded =
    patch.split !== undefined ||
    patch.paymentMethodId !== undefined ||
    patch.pix !== undefined ||
    patch.payeeUserId !== undefined ||
    patch.reminders !== undefined;

  if (settled && crowded) {
    throw new SettledLockedError();
  }
```

Em `billingInputFrom`, trocar a última linha do objeto (`pix: pix ? { keyType: pix.keyType, key: pix.key, label: pix.label } : undefined`) por:

```ts
    pix: pix ? { keyType: pix.keyType, key: pix.key, label: pix.label } : undefined,
    settled: row.settled === true,
    counterpartLabel: row.counterpart_label
```

Assim o `normalizeBillingInput` do reagendamento (sem `now`) reconhece o split só do dono de um registro.

Em `SELECT`, depois de `pix_label: true,`:

```ts
    counterpart_label: true,
    settled: true,
```

Em `Row`, depois de `pix_label?: string;`:

```ts
    /** Registro only: the counterpart typed by the owner. */
    counterpart_label?: string;
    /** True only on a registro; null reads as false. */
    settled?: boolean;
```

Em `create`:
- trocar `const input = normalizeBillingInput(raw);` por `const input = normalizeBillingInput(raw, now);`
- no `data` do `insertOne`, depois de `pix_label: input.pix?.label ?? sqlNull,`:

```ts
          ...(input.settled ? { settled: true, counterpart_label: input.counterpartLabel } : {}),
```

- no `planBillingCharges({…})`, trocar `payeeUserId: input.payeeUserId ?? null` por:

```ts
          payeeUserId: input.payeeUserId ?? null,
          settled: input.settled === true
```

Em `patch`, logo depois de `const description = …;`:

```ts
      const counterpartLabel =
        patch.counterpartLabel === undefined ? undefined : normalizeCounterpartLabel(patch.counterpartLabel, direction(row));
```

E no `data` do `tx.billings.updateOne`, depois de `pix_label: pix?.label ?? sqlNull,`:

```ts
          ...(counterpartLabel === undefined ? {} : { counterpart_label: counterpartLabel }),
```

Em `materializeNextOccurrence`, no `planBillingCharges({…})`, trocar `payeeUserId: row.payee_user_id ?? null` por:

```ts
            payeeUserId: row.payee_user_id ?? null,
            settled: row.settled === true
```

`InviteRepository.joinSplit` não muda: registro não tem convite na UI, e a cobrança criada por ali passa pelo mesmo `persistChargePlan`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: lint e tipos limpos; os quatro testes novos passam e nenhum teste existente quebra.

Run: `cd packages/api && npx vitest run src/import-cycles.test.ts`
Expected: PASS (`materialize.ts` e `charge.ts` só ganharam imports de `@receivy/common`).

Até a Task 3, criar um registro com `NoticeContext` ainda passa por `announceCharges`, que grava `notice.skipped { reason: 'no_recipient' }` num registro a receber devido hoje. Nada é enviado; a Task 3 fecha o gate.

- [ ] **Step 8: Parar para o usuário commitar**

---

### Task 3: Cron de quitação e gate `settled` nas notificações

**Files:**
- Modify: `packages/api/src/charges/errors.ts` (classe nova ao final)
- Modify: `packages/api/src/api.ts:17,68-102`
- Modify: `packages/api/src/billings/repositories/billing.ts` (helper privado antes do namespace, `settleRegistered` depois de `materializeDueBillings`)
- Modify: `packages/api/src/billings/crons/materialize.ts:10-14,46-61`
- Modify: `packages/api/src/notifications/services/send.ts:77-86,216-225,244-263,289-317`
- Modify: `packages/api/src/notifications/repositories/notification.ts:3,111-117`
- Test: `packages/api/test/billings/registros.spec.ts`, `packages/api/test/notifications/notifications.spec.ts`

**Interfaces:**
- Consumes: `BillingRepository.Row.settled`, `BillingSchema.settled`, `ChargeRepository.markRegistered`, `persistChargePlan` quitando na criação (Task 2); `BillingInput.settled`/`counterpartLabel` (Task 1).
- Produces:
  - `BillingRepository.settleRegistered(db: DbClient, now?: Date): Promise<number>` — quantas cobranças quitou
  - helper privado `settleDueCharge(db: DbClient, billing: { owner_id: string; timezone: string }, chargeId: string, now: string): Promise<boolean>`
  - `BillingCron` loga `{ materialized, settled }`
  - `class SettledNoRemindersError extends ConflictError` — code `SETTLED_NO_REMINDERS`, mensagem "Registros não têm avisos.", no 409 de `api.ts`
  - evento `notice.skipped { template, offsetDays?, reason: 'settled' }` em `sendChargeNotice` para cobrança de registro, em qualquer canal; `announceCharges`, `planReminders` e `followUpCharge` pulam sem evento; `NotificationRepository.manualReminder` lança `SettledNoRemindersError`

- [ ] **Step 1: Escrever os testes que falham**

Em `test/billings/registros.spec.ts`, logo depois de `const dayStart = …;`:

```ts
/** 05:00 UTC is when the daily cron runs: 02:00 in São Paulo, so the day has already turned there. */
const cronAt = (day: string) => new Date(`${day}T05:00:00Z`);
```

E, antes do `});` que fecha o `describe`:

```ts
  it('settles each due charge of a registro once a day, never one somebody reopened', async () => {
    const commission = await BillingRepository.create(db, OWNER, 'registro-cron-once', registro('Comissão', { startDate: '2026-04-20' }), date('2026-03-05'));
    const [pending] = await chargeRows(commission.id);

    ok(pending);
    equal(pending.state, ChargeState.Pending);

    await BillingRepository.settleRegistered(db, cronAt('2026-04-19'));
    equal((await chargeRows(commission.id))[0]?.state, ChargeState.Pending, 'not due yet');

    ok((await BillingRepository.settleRegistered(db, cronAt('2026-04-20'))) >= 1);

    const [paid] = await chargeRows(commission.id);

    equal(paid?.state, ChargeState.Paid);
    equal(Date.parse(String(paid?.paid_at)), dayStart('2026-04-20'));
    deepEqual(await paidVia(pending.id), ['registered']);

    await BillingRepository.settleRegistered(db, cronAt('2026-04-20'));
    deepEqual(await paidVia(pending.id), ['registered'], 'a second run changes nothing');

    await ChargeRepository.reopen(db, OWNER, pending.id);
    await BillingRepository.settleRegistered(db, cronAt('2026-04-21'));

    equal((await chargeRows(commission.id))[0]?.state, ChargeState.Pending, 'whoever reopened decided the money did not come in');
    deepEqual(await paidVia(pending.id), ['registered']);
  });

  it('pays the occurrence the sweep creates in the same pass and projects the whole total', async () => {
    const salary = await BillingRepository.create(
      db,
      OWNER,
      'registro-cron-salary',
      registro('Salário', { type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-05-10' }),
      date('2026-05-05')
    );

    deepEqual(
      (await chargeRows(salary.id)).map((row) => [row.due_date, row.state]),
      [['2026-05-10', ChargeState.Pending]]
    );
    equal(salary.previews[0]?.amount.amountCents, 500_000, 'a registro projects the whole total');

    ok((await BillingRepository.materializeDueBillings(db, undefined, cronAt('2026-06-10'))) >= 1);
    // June is born paid inside the sweep; May waits for the settlement step of the same run.
    deepEqual(
      (await chargeRows(salary.id)).map((row) => [row.due_date, row.state]),
      [
        ['2026-05-10', ChargeState.Pending],
        ['2026-06-10', ChargeState.Paid]
      ]
    );

    await BillingRepository.settleRegistered(db, cronAt('2026-06-10'));

    const rows = await chargeRows(salary.id);

    deepEqual(
      rows.map((row) => [row.due_date, row.state]),
      [
        ['2026-05-10', ChargeState.Paid],
        ['2026-06-10', ChargeState.Paid]
      ]
    );
    equal(Date.parse(String(rows[0]?.paid_at)), dayStart('2026-05-10'));
    equal(Date.parse(String(rows[1]?.paid_at)), dayStart('2026-06-10'));
  });
```

Em `test/notifications/notifications.spec.ts`:
- trocar `import { ChargeInReviewError } from '../../src/charges/errors';` por `import { ChargeInReviewError, SettledNoRemindersError } from '../../src/charges/errors';`
- depois da função `payableCharge`:

```ts
/** A registro due on DUE_DATE, created before it: still pending, with nobody on the other side. */
async function registroCharge(direction: Direction = Direction.Receivable) {
  count++;

  const billing = await BillingRepository.create(
    db,
    OWNER,
    `notify-registro-${count}`,
    {
      type: BillingType.Once,
      direction,
      description: 'Salário',
      totalCents: 500_000,
      startDate: DUE_DATE,
      timezone: TZ,
      settled: true,
      counterpartLabel: 'Empresa X'
    },
    new Date(clock)
  );

  return billing.charges[0]!.id;
}
```

- depois do teste `'drops the e-mail follow-up of a charge silenced after its push'`:

```ts
  it('never notifies about a registro and refuses its manual reminder', async () => {
    clock = start;
    sent.reset();

    const received = await registroCharge();
    const paid = await registroCharge(Direction.Payable);
    const control = await charge();

    deepEqual(await send(received, NoticeTemplate.Reminder, 0), { channels: [] });
    deepEqual(await send(paid, NoticeTemplate.Reminder, -1), { channels: [] });
    deepEqual(await sendChargeNotice(db, context, received, NoticeTemplate.Manual, clock, { channel: 'both' }), { channels: [] });
    equal(sent.pushes.length + sent.emails.length, 0);

    const skipped = [
      ...(await EventRepository.list(db, received, 'notice.skipped')),
      ...(await EventRepository.list(db, paid, 'notice.skipped'))
    ].map((event) => event.payload);

    equal(skipped.length, 3);
    ok(skipped.every((payload) => payload['reason'] === 'settled'));
    ok(skipped.some((payload) => payload['offsetDays'] === -1));

    const recorded = await db.events.count({ where: { eventable_id: received, type: 'notice.skipped' } });

    await announceCharges(db, context, [received, paid], Date.parse(`${DUE_DATE}T11:00:00Z`));
    deepEqual(
      await followUpCharge(db, context, { chargeId: received, template: NoticeTemplate.Reminder, stage: 'followup', offsetDays: 0 }, clock),
      { channels: [] }
    );

    equal(
      await db.events.count({ where: { eventable_id: received, type: 'notice.skipped' } }),
      recorded,
      'the initial notice and the follow-up skip a registro without an event'
    );
    equal(sent.pushes.length + sent.emails.length, 0);

    notify.events.clear();
    await planReminders(db, notify, instantAt(DUE_DATE, REMINDER_HOUR, TZ).getTime() - 3600_000);

    equal(notify.events.has(notifyIdentifier(received)), false);
    equal(notify.events.has(notifyIdentifier(paid)), false);
    ok(notify.events.has(notifyIdentifier(control.id)), 'the charge beside them is still planned');

    await rejects(() => NotificationRepository.manualReminder(db, OWNER, received, context, () => clock), SettledNoRemindersError);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/api check-types:test`
Expected: FAIL — `BillingRepository.settleRegistered` e `SettledNoRemindersError` não existem.

Run: `pnpm --filter @receivy/api test:integration`
Expected: FAIL — `BillingRepository.settleRegistered is not a function` nos dois testes novos de registro; no de notificação, os avisos saem com `reason: 'no_recipient'` (registro a receber) e `'no_channel'` (registro a pagar) em vez de `'settled'`, e `planReminders` agenda os dois registros.

- [ ] **Step 3: Erro**

Em `charges/errors.ts`, depois de `ChargeInReviewError`:

```ts
export class SettledNoRemindersError extends ConflictError {
  constructor(message = 'Registros não têm avisos.') {
    super(message, 'SETTLED_NO_REMINDERS');
  }
}
```

Em `api.ts`:
- trocar o import de `./charges/errors` por `import type { ChargeClosedError, ChargeInReviewError, ChargeNotPaidError, SettledNoRemindersError, SilenceUnavailableError } from './charges/errors';`
- na lista `409`, depois de `ChargeInReviewError,`: `SettledNoRemindersError,`

- [ ] **Step 4: `settleRegistered` e o cron**

Em `billings/repositories/billing.ts`, antes de `const idleOccurrence = …`:

```ts
/** Settles one pending charge of a registro unless somebody reopened it; false when there was nothing to do. */
async function settleDueCharge(db: DbClient, billing: { owner_id: string; timezone: string }, chargeId: string, now: string): Promise<boolean> {
  // Whoever reopened it decided the money did not come in: only "Marcar como pago" settles it again.
  const reopened = await EventRepository.list(db, chargeId, 'charge.reopened', 1);

  if (reopened.length) {
    return false;
  }

  return db.transaction(async (tx) => {
    await lockOwner(tx, billing.owner_id);

    const row = await tx.charges.findOne({ select: ChargeRepository.SELECT, where: { id: chargeId }, lock: true });

    if (!row || row.state !== ChargeState.Pending) {
      return false;
    }

    await ChargeRepository.markRegistered(tx, row, billing.timezone, now);

    return true;
  });
}
```

No namespace, logo depois de `materializeDueBillings`:

```ts
  /**
   * The daily settlement of registros: every pending charge of a settled billing due by today, in its timezone, is
   * paid on its due date. Runs after `materializeDueBillings`; idempotent. Returns how many charges it settled.
   */
  export async function settleRegistered(db: DbClient, now = new Date()): Promise<number> {
    const { records } = await db.billings.findMany({
      select: { id: true, owner_id: true, timezone: true },
      where: { settled: true },
      order: { id: Order.Asc }
    });
    const instant = now.toISOString();

    let settled = 0;

    for (const billing of records) {
      const { records: due } = await db.charges.findMany({
        select: { id: true },
        where: { billing_id: billing.id, state: ChargeState.Pending, due_date: { lte: calendarDate(now, billing.timezone) } },
        order: { due_date: Order.Asc }
      });

      for (const charge of due) {
        try {
          if (await settleDueCharge(db, billing, charge.id, instant)) {
            settled++;
          }
        } catch (error) {
          // One broken charge must not stop the others; tomorrow's run tries again.
          console.error('Registro settlement failed', { chargeId: charge.id, error: error instanceof Error ? error.message : 'unknown' });
        }
      }
    }

    return settled;
  }
```

Em `billings/crons/materialize.ts`, trocar o comentário da classe por:

```ts
/**
 * Daily at 05:00 UTC, past midnight in every Brazilian timezone: every active assinatura gets the
 * occurrences that came due, and their initial notices go out; then every registro pays what came due.
 * Creation and patches materialize inline, so this only covers "the day turned". Idempotent: a second
 * run finds nothing to do.
 */
```

E, no `handler`, trocar as duas últimas instruções por:

```ts
  const materialized = await BillingRepository.materializeDueBillings(db, notice, now);
  // After the sweep: the occurrence it just created is already paid, and this pays what came due since yesterday.
  const settled = await BillingRepository.settleRegistered(db, now);

  // Counts only; never owner or recipient data.
  console.info('Billing cron', { materialized, settled });
```

- [ ] **Step 5: Gate nas notificações**

Em `notifications/services/send.ts`, em `sendChargeNotice`, logo depois do bloco `if (charge.silenced && options.channel !== 'both') {…}`:

```ts
  const billing = await db.billings.findOne({ select: { settled: true }, where: { id: charge.billing_id } });

  // A registro was already received or paid: nobody hears about it, not even through the manual reminder.
  if (billing?.settled) {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { template, ...(options.offsetDays === undefined ? {} : { offsetDays: options.offsetDays }), reason: 'settled' }
    });
    return { channels: [] };
  }
```

Em `followUpCharge`, trocar o `findOne` por:

```ts
  const charge = await db.charges.findOne({
    select: { state: true, proof_state: true, silenced: true, billing_id: true },
    where: { id: event.chargeId }
  });
```

E, logo depois do `if (charge.silenced) {…}`:

```ts
  const billing = await db.billings.findOne({ select: { settled: true }, where: { id: charge.billing_id } });

  if (billing?.settled) {
    return { channels: [] };
  }
```

Em `announceCharges`, trocar `select: { timezone: true, reminders: true }` do `db.billings.findOne` por `select: { timezone: true, reminders: true, settled: true }` e, logo depois do `if (!billing) { continue; }`:

```ts
    // A registro has nobody to greet.
    if (billing.settled) {
      continue;
    }
```

Em `planReminders`:
- trocar `const billings = new Map<string, { timezone: string; reminders?: string }>();` por `const billings = new Map<string, { timezone: string; reminders?: string; settled?: boolean }>();`
- trocar `select: { timezone: true, reminders: true }` do `db.billings.findOne` por `select: { timezone: true, reminders: true, settled: true }`
- logo depois do bloco `if (!billing) { … billings.set(charge.billing_id, row); }`:

```ts
    if (billing.settled) {
      continue;
    }
```

Em `notifications/repositories/notification.ts`:
- trocar `import { ChargeClosedError, ChargeInReviewError } from '../../charges/errors';` por `import { ChargeClosedError, ChargeInReviewError, SettledNoRemindersError } from '../../charges/errors';`
- em `manualReminder`, logo depois do `if (row.state !== ChargeState.Pending) {…}`:

```ts
      const billing = await tx.billings.findOne({ select: { settled: true }, where: { id: row.billing_id } });

      // A registro has nobody to remind: the owner settled it on purpose.
      if (billing?.settled) {
        throw new SettledNoRemindersError();
      }
```

Nenhum repositório passa a importar serviço de notificação.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @receivy/api lint && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api test:integration`
Expected: limpos; os testes novos de `registros.spec.ts` e `notifications.spec.ts` passam, e os de `crons.spec.ts` e notificação existentes continuam passando.

Run: `cd packages/api && npx vitest run src/import-cycles.test.ts`
Expected: PASS.

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 4: OpenAPI (BFF e cliente mobile sem mudança)

**Files:**
- Modify: `docs/api-oas.yml` (gerado)

**Interfaces:**
- Consumes: `BillingBody`/`PatchBody` com `settled` e `counterpartLabel`, DTOs com os campos novos, `BillingCategory.Income` (Tasks 1–3).
- Produces: contrato com os campos novos e `income` nos enums de categoria; nenhum caminho novo. `packages/web/src/lib/financial-proxy.ts` já permite `POST`/`PATCH` em `billings` e `POST` em `charges/{id}/reminders`, e `packages/mobile/src/financial/client.ts` serializa o `BillingInput`/`BillingPatch` inteiro em `createBilling`/`patchBilling`: nenhum dos dois muda.

Não há código de produção nesta tarefa, então não há ciclo de teste que falha; a verificação é o check de contrato.

- [ ] **Step 1: Regenerar**

Run: `pnpm --filter @receivy/api openapi:generate`
Expected: `docs/api-oas.yml` ganha `settled` e `counterpartLabel` nos corpos de `POST /billings` e `PATCH /billings/{id}`, em `BillingSummary`, `BillingDetail`, `ChargeDetail` e no item da timeline, e `income` em cada enum de categoria (inclusive a query `category` de `GET /billings`).

- [ ] **Step 2: Conferir que nenhuma rota nasceu**

Run: `git diff docs/api-oas.yml | grep -E '^\+  /'`
Expected: nenhuma linha (as chaves de `paths` ficam no segundo nível de indentação).

Run: `pnpm --filter @receivy/api openapi:check`
Expected: "OpenAPI matches reflected routes and schemas."

- [ ] **Step 3: Contrato do BFF e do cliente**

Run: `pnpm --filter @receivy/web test -- src/lib`
Expected: PASS (`openapi-contract.test.ts` não acha operação nova sem rota no BFF).

Run: `cd packages/mobile && pnpm test -- src/financial/client.test.ts`
Expected: PASS.

- [ ] **Step 4: Parar para o usuário commitar**

---

### Task 5: Web — formulário, detalhe da conta e detalhe da cobrança

**Files:**
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx:75-78,177-202,249-251,395-418,441,456-458,598-600,618-619,668-669,812-813,904-911,939-940,958-959`
- Modify: `packages/web/src/components/screens/billing-detail-screen.tsx:185-189,411,492,497,556,570,631,648-649,733,853`
- Modify: `packages/web/src/components/screens/charge-detail-screen.tsx:327,361-364,402,429-441`
- Test: `packages/web/src/components/forms/billing-form-screen.test.tsx`, `packages/web/src/components/screens/billing-detail-screen.test.tsx`, `packages/web/src/components/screens/charge-detail-screen.test.tsx`

**Interfaces:**
- Consumes: `BillingDraft.settled`/`counterpartLabel`, `buildBillingInput(draft, now?)`, `BillingPatch.counterpartLabel`, `BillingDetail.settled`/`counterpartLabel`, `ChargeSummary.settled`, `canRemind`/`canShare`/`canSilenceCharge`/`canUploadProof` com registro (Task 1); `ChargeDetail.recipient.name` com o nome livre e `sharingState: closed` (Task 2).
- Produces: `input role="switch"` com nome "Já recebi" (receber) / "Já paguei" (pagar); campo com rótulo "De quem" / "Para quem" e placeholder "Ex.: Empresa X"; texto "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento."; `min` = hoje no vencimento de recorrente registro; no detalhe da conta, chip "Registro" e linha "De {nome}" / "Para {nome}"; no detalhe da cobrança, `StatusTag` "Registro" e `ActionTile` "Marcar como pago" no lugar do `ProofCard`.

- [ ] **Step 1: Escrever os testes que falham**

Em `billing-form-screen.test.tsx`, depois do teste `'offers Não notificar only on a conta a receber'`:

```tsx
it("records a registro with the name typed in De quem and nobody to split with or pay through", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("switch", { name: "Já recebi" }));

  expect(screen.getByText("Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.")).toBeInTheDocument();
  expect(screen.queryByText("Participantes")).not.toBeInTheDocument();
  expect(screen.queryByText("Divisão da Conta")).not.toBeInTheDocument();
  expect(screen.queryByText("Receber via Pix")).not.toBeInTheDocument();
  expect(screen.getByLabelText("De quem")).toHaveAttribute("placeholder", "Ex.: Empresa X");

  await user.type(screen.getByLabelText("De quem"), "Empresa X");
  await user.type(screen.getByLabelText("Valor total"), "5000,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");
  const body = JSON.parse(String(post?.init.body));

  expect(body).toMatchObject({
    direction: "receivable",
    settled: true,
    counterpartLabel: "Empresa X",
    totalCents: 500_000,
    split: { mode: "equal", parts: [{ kind: "owner" }] },
  });
  expect(body.reminders).toBeUndefined();
  expect(body.paymentMethodId).toBeUndefined();
});

it("names a registro a pagar Para quem and keeps a recorrente from starting before today", async () => {
  api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("switch", { name: "Já recebi" }));
  await user.click(screen.getByRole("radio", { name: "Vou pagar" }));

  expect(screen.getByRole("switch", { name: "Já paguei" })).toBeChecked();
  expect(screen.getByLabelText("Para quem")).toBeInTheDocument();
  expect(screen.queryByText("Para quem (opcional)")).not.toBeInTheDocument();
  expect(screen.queryByText("Chave Pix (opcional)")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Vencimento")).not.toHaveAttribute("min");

  await user.click(screen.getByRole("radio", { name: "Recorrente" }));

  expect(screen.getByLabelText("Vencimento")).toHaveAttribute("min", today());
});
```

Depois do teste `'keeps the form open for a conta a pagar even without a key'`:

```tsx
it("opens the form of a registro a receber even without a key", async () => {
  withoutPixKeys();
  const { user } = renderForm();

  expect(await screen.findByText("Cadastre uma chave Pix")).toBeInTheDocument();

  await user.click(screen.getByRole("switch", { name: "Já recebi" }));

  expect(screen.queryByText("Cadastre uma chave Pix")).not.toBeInTheDocument();
  expect(screen.getByLabelText("De quem")).toBeInTheDocument();
});
```

Ao final do arquivo (depois de `onceBilling` existir):

```tsx
it("keeps the registro switch locked on edit and patches only the new name", async () => {
  const registroBilling: BillingDetail = {
    ...onceBilling,
    id: "b4",
    settled: true,
    counterpartLabel: "Empresa X",
    paymentMethodId: undefined,
    reminders: [],
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] },
  };
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(registroBilling) : undefined));
  const { user } = renderForm(registroBilling);

  const toggle = await screen.findByRole("switch", { name: "Já recebi" });

  expect(toggle).toBeChecked();
  expect(toggle).toBeDisabled();
  expect(screen.getByText("Não dá para mudar depois de criada.")).toBeInTheDocument();
  expect(screen.getByLabelText("De quem")).toHaveValue("Empresa X");

  await user.clear(screen.getByLabelText("De quem"));
  await user.type(screen.getByLabelText("De quem"), "Empresa Y");
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");
  expect(patch?.path).toBe("/api/financial/billings/b4");
  expect(JSON.parse(String(patch?.init.body))).toEqual({ counterpartLabel: "Empresa Y", category: "other" });
});
```

Em `billing-detail-screen.test.tsx`, ao final:

```tsx
it("heads a registro with its counterpart and hides the invite and the payment links", async () => {
  const salary = charge({
    id: "c8",
    name: "Empresa X",
    recipient: { userId: null, name: "Empresa X", email: null },
    debtorUserId: null,
    pix: null,
    sharingState: SharingState.Closed,
    settled: true,
    counterpartLabel: "Empresa X",
  });

  await open(billing({ settled: true, counterpartLabel: "Empresa X", paymentMethodId: undefined, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] }, charges: [salary] }));

  expect(screen.getByText("De Empresa X")).toBeInTheDocument();
  expect(screen.getByText("Registro")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cobranças" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Participantes" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Marcar Empresa X como pago" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de Empresa X" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).not.toBeInTheDocument();
});

it("heads a registro a pagar with Para and names its rows after the counterpart", async () => {
  const rent = charge({
    id: "c9",
    name: "Imobiliária",
    direction: Direction.Payable,
    payer: ChargePayer.Owner,
    ownedByViewer: true,
    recipient: { userId: null, name: "Imobiliária", email: null },
    debtorUserId: null,
    pix: null,
    settled: true,
    counterpartLabel: "Imobiliária",
  });

  await open(billing({ direction: Direction.Payable, settled: true, counterpartLabel: "Imobiliária", paymentMethodId: undefined, charges: [rent] }));

  expect(screen.getByText("Para Imobiliária")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Abrir cobrança de Imobiliária" })).toBeInTheDocument();
});
```

Em `charge-detail-screen.test.tsx`, antes do `});` que fecha o `describe`:

```tsx
  it("badges a registro and hides Lembrar, the link, the proof and Não notificar", async () => {
    serve(
      charge({
        direction: Direction.Receivable,
        ownedByViewer: true,
        counterpartName: "Empresa X",
        recipient: { userId: null, name: "Empresa X", email: null },
        debtorUserId: null,
        sharingState: SharingState.Closed,
        settled: true,
        counterpartLabel: "Empresa X",
      }),
    );

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Registro")).toBeInTheDocument();
    expect(screen.getByText("Empresa X")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).not.toBeInTheDocument();
    expect(screen.queryByText("Comprovante")).not.toBeInTheDocument();
  });
```

(o fixture mantém a chave Pix do `charge()` de propósito: sem o gate de registro, "Lembrar", "Compartilhar" e "Não notificar esta cobrança" apareceriam.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: FAIL — não existe `switch` "Já recebi", nem "De Empresa X"/"Para Imobiliária", nem o selo "Registro"; o `ProofCard` ainda mostra "Comprovante".

- [ ] **Step 3: Formulário**

Em `billing-form-screen.tsx`, depois da constante `DIRECTIONS`:

```tsx
/** "Já recebi" / "Já paguei" and the name field of a registro, by direction. */
const SETTLED_LABELS: Record<Direction, { toggle: string; field: string }> = {
  receivable: { toggle: "Já recebi", field: "De quem" },
  payable: { toggle: "Já paguei", field: "Para quem" },
};
const SETTLED_HELP = "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.";
const SETTLED_LOCKED = "Não dá para mudar depois de criada.";
```

Em `draftFromBilling`, depois de `silenced: silencedFromBilling(billing),`:

```tsx
    settled: billing.settled === true,
    counterpartLabel: billing.counterpartLabel ?? "",
```

Trocar:

```tsx
  const payable = draft.direction === "payable";
  // A conta a pagar is paid by the owner: it needs no wallet key, so the gate never applies to it.
  const gate = gated && !payable;
```

por:

```tsx
  const payable = draft.direction === "payable";
  // A registro has nobody to split with or pay through: participants, payee, split and Pix leave the form.
  const settled = draft.settled === true;
  // A conta a pagar is paid by the owner and a registro is already settled: neither needs a wallet key.
  const gate = gated && !payable && !settled;
```

Em `patchBody`, antes de `const editable =`:

```tsx
    // A registro only renames its counterpart (and, while recorrente, moves its schedule and amount).
    if (input.settled) {
      const named = { counterpartLabel: input.counterpartLabel, category: input.category };

      if (billing && billing.type !== "indefinite") {
        return named;
      }

      return { description: input.description, totalCents: input.totalCents, startDate: input.startDate, dueRule: input.dueRule ?? BillingDueRule.Fixed, ...named };
    }

```

Em `submit`, trocar `const next: Attempt = { input: buildBillingInput(draft), key: crypto.randomUUID(), uncertain: false };` por:

```tsx
      // Only a creation checks that a recorrente registro starts today or later.
      const next: Attempt = { input: buildBillingInput(draft, billing ? undefined : new Date()), key: crypto.randomUUID(), uncertain: false };
```

Logo depois de `const monthEnd = monthEnds && draft.dueRule === "end_of_month";`:

```tsx
  // A recorrente registro starts today or later; a single one may be in the past.
  const minimumDate = settled && draft.type !== "once" ? today : undefined;
```

Logo depois do `</fieldset>` que fecha "Direção" (antes de `{/* Without a key there is nothing to send: … */}`):

```tsx
      {/* Registro: already received or paid. On edit it only shows on a registro, locked. */}
      {(!editing || settled) && (
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface p-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-ink">{SETTLED_LABELS[draft.direction].toggle}</span>
              {editing && <span className="text-[11px] text-muted">{SETTLED_LOCKED}</span>}
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={SETTLED_LABELS[draft.direction].toggle}
              className="h-5 w-5 accent-primary"
              disabled={locked || editing}
              checked={settled}
              onChange={event => update({ settled: event.target.checked })}
            />
          </label>
          {settled && <p className="m-0 text-[11px] text-muted">{SETTLED_HELP}</p>}
        </div>
      )}
```

Trocar:

```tsx
      {/* Para quem (conta a pagar) */}
      {payable && (
```

por:

```tsx
      {/* De quem / Para quem (registro) */}
      {settled && (
        <div className="flex flex-col gap-1">
          <SectionLabel htmlFor="billing-counterpart">{SETTLED_LABELS[draft.direction].field}</SectionLabel>
          <input
            id="billing-counterpart"
            maxLength={120}
            placeholder="Ex.: Empresa X"
            disabled={locked}
            value={draft.counterpartLabel ?? ""}
            onChange={event => update({ counterpartLabel: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>
      )}

      {/* Para quem (conta a pagar) */}
      {payable && !settled && (
```

Trocar `{/* Participantes */}` + `{!payable && (` por:

```tsx
      {/* Participantes */}
      {!payable && !settled && (
```

Trocar `{/* Divisão */}` + `{!payable && (` por:

```tsx
      {/* Divisão */}
      {!payable && !settled && (
```

Trocar `{/* Chave Pix (conta a pagar): typed inline, it belongs to whoever receives */}` + `{payable && (` por:

```tsx
      {/* Chave Pix (conta a pagar): typed inline, it belongs to whoever receives */}
      {payable && !settled && (
```

Trocar `{/* Pix */}` + `{!payable && (` por:

```tsx
      {/* Pix */}
      {!payable && !settled && (
```

No `<input id="billing-start" …>`, depois de `type="date"`:

```tsx
                min={minimumDate}
```

A web não tem campo de lembretes nem "Não notificar" fora do bloco de participantes: esconder os blocos acima já cobre "esconde Pix, lembretes e Não notificar".

- [ ] **Step 4: Detalhe da conta**

Em `billing-detail-screen.tsx`, antes de `type BillingDetailScreenProps = {`:

```tsx
/** "De Empresa X" on a registro a receber, "Para Empresa X" on one a pagar. */
function counterpartHeadline(billing: BillingDetail): string {
  const name = billing.counterpartLabel ?? "";

  if (billing.direction === "payable") {
    return `Para ${name}`;
  }

  return `De ${name}`;
}
```

Depois de `const payable = billing.direction === "payable";`:

```tsx
  // A registro: the owner alone, already settled, with the counterpart typed as free text.
  const settled = billing.settled === true;
```

No hero, depois de `{payable && <span className="rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-semibold text-warning">A pagar</span>}`:

```tsx
                {settled && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted">Registro</span>}
```

Depois do `<h2 …>{billing.description}</h2>` do hero:

```tsx
            {settled && <p className="m-0 text-sm font-semibold text-ink">{counterpartHeadline(billing)}</p>}
```

Trocar `{billing.state === "active" && !payable && (` (tile "Convidar") por `{billing.state === "active" && !payable && !settled && (`.

Trocar `{invite && billing.state === "active" && !payable && (` por `{invite && billing.state === "active" && !payable && !settled && (`.

Trocar `{payable ? "Cobranças" : "Participantes"}` por `{payable || settled ? "Cobranças" : "Participantes"}`.

Trocar:

```tsx
              const name = payable ? (billing.payee?.name ?? "Só comigo") : charge.recipient.name;
              const avatar = payable ? (billing.payee?.avatar ?? null) : charge.recipient.avatar;
```

por:

```tsx
              // A registro's rows carry its counterpart; a conta a pagar names the payee.
              const name = payable && !settled ? (billing.payee?.name ?? "Só comigo") : charge.recipient.name;
              const avatar = payable && !settled ? (billing.payee?.avatar ?? null) : charge.recipient.avatar;
```

Na linha pendente, trocar `{!payable && (` que envolve o botão `aria-label={`Compartilhar link de ${name}`}` por `{!payable && !settled && (`.

Trocar `{pending.length > 0 && !ended && !payable && (` por `{pending.length > 0 && !ended && !payable && !settled && (`.

A ação "Não notificar {nome}" já some sozinha: `participantOf` não acha allocation `User` num registro.

- [ ] **Step 5: Detalhe da cobrança**

Em `charge-detail-screen.tsx`:
- trocar `const creditor = receivable && !ownBill;` por:

```tsx
  // The creditor of a conta a receber with contacts: a registro publishes no link.
  const creditor = receivable && !ownBill && !charge.settled;
```

- trocar o bloco dos selos do hero por:

```tsx
              <div className="flex items-center gap-1.5">
                {charge.settled && <StatusTag label="Registro" tone="neutral" compact />}
                {charge.silenced && <StatusTag label="Sem avisos" tone="neutral" compact />}
                <StatusTag label={state.label} tone={state.tone} compact />
              </div>
```

- nas ações rápidas, logo depois de `{reopenable && <ActionTile label="Reabrir" … />}`:

```tsx
                {charge.settled && markable && <ActionTile label="Marcar como pago" icon={Check} tone="primary" disabled={busy} onClick={() => setConfirmPaid("pay")} />}
```

- trocar `<ProofCard` … `/>` por:

```tsx
          {/* A registro has no proof: "Marcar como pago" moved to the quick actions. */}
          {!charge.settled && (
            <ProofCard
              charge={charge}
              busy={busy}
              sending={sending}
              picked={picked}
              onView={() => router.push(`/charges/${id}/proof`)}
              onPick={setPicked}
              onSend={markable ? sendPicked : undefined}
              onAccept={() => setConfirmPaid(acceptProof ? "review" : "pay")}
              onDeclare={canDeclarePayment(charge) ? () => setConfirmDeclare(true) : undefined}
              onWithdraw={() => void withdraw()}
              onReject={() => setRejecting(true)}
            />
          )}
```

"Lembrar", "Compartilhar", "Trocar e compartilhar link" e "Não notificar esta cobrança" somem pelos gates da Task 1; o rodapé de comprovante não aparece porque `canMarkPaid` é verdadeiro para quem é dono do registro.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @receivy/web test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: PASS.

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: PASS em todas as suítes (feed e lista de contas ganham o selo "Registro" e o nome livre pelos helpers do common, sem mudança de componente).

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 6: Mobile — formulário, detalhe da conta e detalhe da cobrança

**Files:**
- Modify: `packages/mobile/src/components/forms/billing-form-screen.tsx:114-117,224-249,383-385,533-553,603,617-620,754-767,791-794,833-834,969-970,1094-1119,1135-1136,1156-1157`
- Modify: `packages/mobile/src/components/screens/billing-detail-screen.tsx:208-222,466,520,525-527,583,597,679,697-698,782-791,903`
- Modify: `packages/mobile/src/components/screens/charge-detail-screen.tsx:370,382,413-416,458,515-526`
- Test: `packages/mobile/src/components/forms/billing-form-screen.test.tsx`, `packages/mobile/src/components/screens/billing-detail-screen.test.tsx`, `packages/mobile/src/components/screens/charge-detail-screen.test.tsx`

**Interfaces:**
- Consumes: os mesmos da Task 5 (Tasks 1 e 2). O `financialClient` não muda (Task 4).
- Produces: `Switch` com `accessibilityLabel` "Já recebi" / "Já paguei"; `TextInput` com `accessibilityLabel` "De quem" / "Para quem" e placeholder "Ex.: Empresa X"; `minimumDate` nos dois `DateTimePicker` de recorrente registro; mesmos textos, selos e "De {nome}"/"Para {nome}" da Task 5.

- [ ] **Step 1: Escrever os testes que falham**

Em `billing-form-screen.test.tsx`, depois do teste `'seeds Não notificar from the allocations and sends the new value on edit'`:

```tsx
  it("records a registro with the name typed in De quem and nobody to split with or pay through", async () => {
    const { client } = await quickForm();

    await fireEvent(screen.getByLabelText("Já recebi"), "valueChange", true);

    expect(screen.getByText("Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.")).toBeOnTheScreen();
    expect(screen.queryByText("Participantes")).toBeNull();
    expect(screen.queryByText("Divisão da Conta")).toBeNull();
    expect(screen.queryByText("Receber via Pix")).toBeNull();
    expect(screen.getByLabelText("De quem")).toHaveProp("placeholder", "Ex.: Empresa X");

    await fireEvent.changeText(screen.getByLabelText("De quem"), "Empresa X");
    await fireEvent.changeText(screen.getByLabelText("Valor"), "500000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Salário");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    const input = client.createBilling.mock.calls[0][0];

    expect(input).toMatchObject({
      direction: "receivable",
      settled: true,
      counterpartLabel: "Empresa X",
      totalCents: 500_000,
      split: { mode: "equal", parts: [{ kind: "owner" }] },
    });
    expect(input.reminders).toBeUndefined();
    expect(input.paymentMethodId).toBeUndefined();
  });

  it("keeps a recorrente registro from starting before today", async () => {
    const { client } = await quickForm();

    await fireEvent(screen.getByLabelText("Já recebi"), "valueChange", true);
    await fireEvent.changeText(screen.getByLabelText("De quem"), "Empresa X");
    await fireEvent.press(screen.getByRole("button", { name: "Recorrente" }));
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), yesterday());
    await fireEvent.changeText(screen.getByLabelText("Valor"), "500000");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByText("Registro recorrente começa hoje ou depois.")).toBeOnTheScreen();
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("keeps the registro switch locked on edit and patches only the new name", async () => {
    const registroBilling: BillingDetail = {
      ...onceBilling,
      id: "b4",
      settled: true,
      counterpartLabel: "Empresa X",
      paymentMethodId: undefined,
      reminders: [],
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] },
    };
    const patchBilling = jest.fn().mockResolvedValue(registroBilling);

    await render(<BillingFormScreen client={financialApi({ patchBilling }) as never} contacts={contactsApi()} billing={registroBilling} onSaved={jest.fn()} onBack={jest.fn()} />);

    const toggle = await screen.findByLabelText("Já recebi");

    expect(toggle).toHaveProp("value", true);
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Não dá para mudar depois de criada.")).toBeOnTheScreen();
    expect(screen.getByLabelText("De quem")).toHaveProp("value", "Empresa X");

    await fireEvent.changeText(screen.getByLabelText("De quem"), "Empresa Y");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling.mock.calls[0][1]).toEqual({ counterpartLabel: "Empresa Y", category: "food" });
  });
```

Em `billing-detail-screen.test.tsx`, antes do `});` que fecha o `describe`:

```tsx
  it("heads a registro with its counterpart and hides the invite and the payment links", async () => {
    const salary = charge({
      id: "c8",
      name: "Empresa X",
      recipient: { userId: null, name: "Empresa X", email: null },
      debtorUserId: null,
      pix: null,
      sharingState: SharingState.Closed,
      settled: true,
      counterpartLabel: "Empresa X",
    });
    const detail = billing({ settled: true, counterpartLabel: "Empresa X", paymentMethodId: undefined, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] }, charges: [salary] });

    await open(makeClient(detail));

    expect(screen.getByText("De Empresa X")).toBeOnTheScreen();
    expect(screen.getByText("Registro")).toBeOnTheScreen();
    expect(screen.getByText("Cobranças")).toBeOnTheScreen();
    expect(screen.queryByText("Participantes")).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar Empresa X como pago" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de Empresa X" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).toBeNull();
  });

  it("heads a registro a pagar with Para and names its rows after the counterpart", async () => {
    const rent = charge({
      id: "c9",
      name: "Imobiliária",
      direction: Direction.Payable,
      payer: ChargePayer.Owner,
      ownedByViewer: true,
      recipient: { userId: null, name: "Imobiliária", email: null },
      debtorUserId: null,
      pix: null,
      settled: true,
      counterpartLabel: "Imobiliária",
    });

    await open(makeClient(billing({ direction: Direction.Payable, settled: true, counterpartLabel: "Imobiliária", paymentMethodId: undefined, charges: [rent] })));

    expect(screen.getByText("Para Imobiliária")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Abrir cobrança de Imobiliária" })).toBeOnTheScreen();
  });
```

Em `charge-detail-screen.test.tsx`, antes do `});` que fecha o `describe`:

```tsx
  it("badges a registro and hides Lembrar, the link, the proof and Não notificar", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(
        charge({
          direction: Direction.Receivable,
          ownedByViewer: true,
          counterpartName: "Empresa X",
          recipient: { userId: null, name: "Empresa X", email: null },
          debtorUserId: null,
          sharingState: SharingState.Closed,
          settled: true,
          counterpartLabel: "Empresa X",
        }),
      ),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      silenceCharge: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Registro")).toBeOnTheScreen();
    expect(screen.getByText("Empresa X")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Lembrar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).toBeNull();
    expect(screen.queryByRole("header", { name: "Comprovante" })).toBeNull();
  });
```

(`startProofUpload` liga o `ProofCard`, e a chave Pix do fixture liga "Lembrar"/"Compartilhar": sem os gates de registro, o teste falha.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/mobile && pnpm test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: FAIL — não existem "Já recebi", "De Empresa X", "Para Imobiliária" nem o selo "Registro"; o `ProofCard` ainda aparece.

- [ ] **Step 3: Formulário**

Em `forms/billing-form-screen.tsx`, depois da constante `DIRECTIONS`:

```tsx
/** "Já recebi" / "Já paguei" and the name field of a registro, by direction. */
const SETTLED_LABELS: Record<Direction, { toggle: string; field: string }> = {
  receivable: { toggle: "Já recebi", field: "De quem" },
  payable: { toggle: "Já paguei", field: "Para quem" },
};
const SETTLED_HELP = "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.";
const SETTLED_LOCKED = "Não dá para mudar depois de criada.";
```

Em `draftFromBilling`, depois de `silenced: silencedFromBilling(billing),`:

```tsx
    settled: billing.settled === true,
    counterpartLabel: billing.counterpartLabel ?? "",
```

Trocar:

```tsx
  const payable = draft.direction === "payable";
  // A conta a pagar is paid elsewhere, so the wallet gate only holds a conta a receber.
  const blocked = gated && !payable;
```

por:

```tsx
  const payable = draft.direction === "payable";
  // A registro has nobody to split with or pay through: participants, payee, split and Pix leave the form.
  const settled = draft.settled === true;
  // A conta a pagar is paid elsewhere and a registro is already settled, so the wallet gate only holds a conta a receber.
  const blocked = gated && !payable && !settled;
```

Em `patchBody`, antes de `const editable = {`:

```tsx
    // A registro only renames its counterpart (and, while recorrente, moves its schedule and amount).
    if (input.settled) {
      const named = { counterpartLabel: input.counterpartLabel, category: input.category };

      if (billing && billing.type !== "indefinite") {
        return named;
      }

      return { description: input.description, totalCents: input.totalCents, startDate: input.startDate, dueRule: input.dueRule ?? BillingDueRule.Fixed, ...named };
    }

```

Em `submit`, trocar `const next: Attempt = { input: buildBillingInput(draftToBuild(draft)), key: Crypto.randomUUID(), uncertain: false };` por:

```tsx
      // Only a creation checks that a recorrente registro starts today or later.
      const next: Attempt = { input: buildBillingInput(draftToBuild(draft), billing ? undefined : new Date()), key: Crypto.randomUUID(), uncertain: false };
```

Logo depois de `const monthEnd = monthEnds && draft.dueRule === "end_of_month";`:

```tsx
  // A recorrente registro starts today or later; a single one may be in the past.
  const minimumDate = settled && draft.type !== "once" ? dateFromCalendar(today, today) : undefined;
```

Logo depois da `View` "Direção" (antes de `{frozen && <Text …>{FROZEN_NOTE}</Text>}`):

```tsx
        {/* Registro: already received or paid. On edit it only shows on a registro, locked. */}
        {(!editing || settled) && (
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface p-3">
              <View className="flex-1">
                <Text className="text-xs font-semibold text-ink">{SETTLED_LABELS[draft.direction].toggle}</Text>
                {editing && <Text className="text-[11px] text-muted">{SETTLED_LOCKED}</Text>}
              </View>
              <Switch
                accessibilityLabel={SETTLED_LABELS[draft.direction].toggle}
                disabled={locked || editing}
                value={settled}
                onValueChange={(value) => update({ settled: value })}
                trackColor={{ true: colors.primary }}
              />
            </View>
            {settled && <Text className="text-[11px] text-muted">{SETTLED_HELP}</Text>}
          </View>
        )}
```

Trocar:

```tsx
        {/* Para quem: the single contact a conta a pagar is owed to */}
        {payable && (
```

por:

```tsx
        {/* De quem / Para quem: the counterpart of a registro, typed by hand */}
        {settled && (
          <View className="gap-1">
            <SectionLabel>{SETTLED_LABELS[draft.direction].field}</SectionLabel>
            <TextInput
              accessibilityLabel={SETTLED_LABELS[draft.direction].field}
              editable={!locked}
              maxLength={120}
              placeholder="Ex.: Empresa X"
              placeholderTextColor={colors.muted}
              value={draft.counterpartLabel ?? ""}
              onChangeText={(value) => update({ counterpartLabel: value })}
              className="h-11 rounded-[14px] border border-outline bg-surface px-3.5 py-0 font-sans text-[15px] tracking-normal text-ink"
            />
          </View>
        )}

        {/* Para quem: the single contact a conta a pagar is owed to */}
        {payable && !settled && (
```

Trocar `{/* Participantes */}` + `{!payable && (` por:

```tsx
        {/* Participantes */}
        {!payable && !settled && (
```

Trocar `{/* Divisão */}` + `{!payable && (` por:

```tsx
        {/* Divisão */}
        {!payable && !settled && (
```

Trocar `{/* Chave Pix inline: where the owner pays a conta a pagar */}` + `{payable && (` por:

```tsx
        {/* Chave Pix inline: where the owner pays a conta a pagar */}
        {payable && !settled && (
```

Trocar `{/* Pix */}` + `{!payable && (` por:

```tsx
        {/* Pix */}
        {!payable && !settled && (
```

Nos dois `<DateTimePicker`, depois de `mode="date"`:

```tsx
              minimumDate={minimumDate}
```

- [ ] **Step 4: Detalhe da conta**

Em `screens/billing-detail-screen.tsx`, antes de `function Tag(`:

```tsx
/** "De Empresa X" on a registro a receber, "Para Empresa X" on one a pagar. */
function counterpartHeadline(billing: BillingDetail): string {
  const name = billing.counterpartLabel ?? "";

  if (billing.direction === "payable") {
    return `Para ${name}`;
  }

  return `De ${name}`;
}
```

Depois de `const payable = billing.direction === "payable";`:

```tsx
  // A registro: the owner alone, already settled, with the counterpart typed as free text.
  const settled = billing.settled === true;
```

No hero, depois de `{payable && <Text className="rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-semibold text-danger">A pagar</Text>}`:

```tsx
              {settled && <Text className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted">Registro</Text>}
```

Depois do `<Text accessibilityRole="header" …>{billing.description}</Text>` do hero:

```tsx
          {settled && <Text className="text-sm font-semibold text-ink">{counterpartHeadline(billing)}</Text>}
```

Trocar `{!payable && billing.state === "active" && (` (tile "Convidar") por `{!payable && !settled && billing.state === "active" && (`.

Trocar `{!payable && invite && billing.state === "active" && (` por `{!payable && !settled && invite && billing.state === "active" && (`.

Trocar `{payable ? "Cobranças" : "Participantes"}` por `{payable || settled ? "Cobranças" : "Participantes"}`.

Trocar:

```tsx
            const name = payable ? (billing.payee?.name ?? "Só comigo") : charge.recipient.name;
            const avatar = payable ? (billing.payee?.avatar ?? null) : charge.recipient.avatar;
```

por:

```tsx
            // A registro's rows carry its counterpart; a conta a pagar names the payee.
            const name = payable && !settled ? (billing.payee?.name ?? "Só comigo") : charge.recipient.name;
            const avatar = payable && !settled ? (billing.payee?.avatar ?? null) : charge.recipient.avatar;
```

Na linha "Aguardando pagamento", trocar o `Pressable` de `accessibilityLabel={`Compartilhar link de ${name}`}` por:

```tsx
                      {!settled && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Compartilhar link de ${name}`}
                          accessibilityState={{ disabled: busy }}
                          disabled={busy}
                          onPress={() => void shareCharge(charge)}
                          className={`h-8 w-8 items-center justify-center rounded-lg bg-primary ${busy ? "opacity-50" : ""}`}
                        >
                          <Image source={ICONS.share} tintColor={colors.onPrimary} style={{ width: 14, height: 14 }} />
                        </Pressable>
                      )}
```

(`collecting` continua como está: ele também decide "Marcar pago", que segue as regras atuais num registro.)

Trocar `{pending.length > 0 && collecting && (` por `{pending.length > 0 && collecting && !settled && (`.

- [ ] **Step 5: Detalhe da cobrança**

Em `screens/charge-detail-screen.tsx`:
- trocar `const sharer = receivable && pending && charge.payer !== "owner";` por:

```tsx
  // Who could publish a link once a key exists: the creditor of a conta a receber with contacts, never a registro.
  const sharer = receivable && pending && charge.payer !== "owner" && !charge.settled;
```

- trocar `const proofTile = proofsEnabled && (!receivable || (charge.payer === "owner" && viewable));` por:

```tsx
  const proofTile = proofsEnabled && !charge.settled && (!receivable || (charge.payer === "owner" && viewable));
```

- trocar o bloco dos selos do hero por:

```tsx
            <View className="flex-row items-center gap-1.5">
              {charge.settled && <StatusTag label="Registro" tone={ChargeTone.Neutral} compact />}
              {charge.silenced && <StatusTag label="Sem avisos" tone={ChargeTone.Neutral} compact />}
              <StatusTag label={state.label} tone={state.tone} compact />
            </View>
```

- nas ações rápidas, logo depois de `{reopenable && <ActionTile label="Reabrir" … />}`:

```tsx
              {charge.settled && settleable && <ActionTile label="Marcar como pago" icon={ICONS.check} tone="primary" disabled={busy} onPress={() => confirmPaid(false)} />}
```

- trocar `{proofsEnabled && (` que envolve o `<ProofCard` por:

```tsx
        {/* A registro has no proof: "Marcar como pago" moved to the quick actions. */}
        {proofsEnabled && !charge.settled && (
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd packages/mobile && pnpm test -- src/components/forms/billing-form-screen.test.tsx src/components/screens/billing-detail-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx`
Expected: PASS.

Run: `cd packages/mobile && npx tsc --noEmit -p tsconfig.json && pnpm lint && pnpm test`
Expected: PASS em todas as suítes (feed e lista de contas ganham o selo e o nome livre pelos helpers do common).

- [ ] **Step 7: Parar para o usuário commitar**

---

### Task 7: Documentação, roteiro de QA e seed

**Files:**
- Modify: `docs/notifications.md` (seção nova antes de `## Local`)
- Modify: `docs/api-errors.md` (seção nova ao final)
- Modify: `docs/manual-qa-script.md` (seção `## 21. Registros` antes de `## Divergências`)
- Modify: `packages/api/scripts/seed-local.mjs:398-424,428,536-562,586-589,704-707`

**Interfaces:**
- Consumes: tudo das Tasks 1–6 (sem código novo de produção).
- Produces: contas de seed `salario` (receber, recorrente mensal, `settled`, "Empresa X", categoria `income`) e `dentista` (pagar, avulsa no mês passado, `settled`, "Clínica Sorriso"); helpers `paidAtOf(billing, charge, createdAtCharge, dueDate)` e `paidVia(billing, proof)` no seed.

- [ ] **Step 1: `docs/notifications.md`**

Antes de `## Local`:

```md
## Registros

A registro is a conta the owner already received or paid (`billings.settled`), with the counterpart typed as free text
(`billings.counterpart_label`). Nobody is on the other side, so nobody is ever notified, the owner included.

- `sendChargeNotice` records `notice.skipped { template, offsetDays?, reason: 'settled' }` and sends nothing for a charge
  of a registro, on every channel, right after the `silenced` gate.
- `announceCharges` and `planReminders` skip those charges before scheduling anything, and `followUpCharge` sends no
  e-mail. None of the three records an event.
- `POST /charges/{id}/reminders` answers 409 `SETTLED_NO_REMINDERS` ("Registros não têm avisos.").
- Settling is not a notice: each charge of a registro is paid on its due date (`charge.paid { via: 'registered' }`,
  `paid_at` at the start of that day in the billing timezone). `persistChargePlan` pays what is already due in the
  transaction that creates it (creation, the monthly sweep, edits); `BillingCron` calls
  `BillingRepository.settleRegistered` right after `materializeDueBillings` for what came due since. A charge with a
  `charge.reopened` event stays pending until "Marcar como pago".
```

- [ ] **Step 2: `docs/api-errors.md`**

Ao final do arquivo:

```md
## Registro errors

| Code | Status | When |
|---|---|---|
| `SETTLED_LOCKED` | 409 | `PATCH /billings/{id}` sends `settled` different from the stored value, `counterpartLabel` on a conta that is not a registro, or `split`, `paymentMethodId`, `pix`, `payeeUserId` or `reminders` on a registro |
| `SETTLED_NO_REMINDERS` | 409 | `POST /charges/{id}/reminders` on a charge of a registro |
```

- [ ] **Step 3: `docs/manual-qa-script.md`**

Antes de `## Divergências`:

```md
## 21. Registros

Como Ana:

- [ ] Nova conta, "Vou receber", ligar "Já recebi". Esperado: somem Participantes, Divisão da Conta e "Receber via Pix"; aparecem "De quem" (placeholder "Ex.: Empresa X") e "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento."
- [ ] Salário recorrente: "Recorrente", mensal, vencimento hoje, categoria "Salário e renda", "De quem" = "Empresa X". Criar. Esperado: a cobrança de hoje nasce paga; o feed mostra "Salário · Empresa X" com o selo "Registro"; "Recebido" do mês soma o valor; nada chega no Mailpit.
- [ ] Recorrente com data anterior a hoje: no web o calendário não deixa escolher (data mínima hoje); no mobile, digitar a data de ontem e criar. Esperado: "Registro recorrente começa hoje ou depois."
- [ ] Avulso no passado: "Vou pagar", "Já paguei", "Para quem" = "Imobiliária", "À vista", vencimento no mês passado. Criar. Esperado: nasce paga, com `charge.paid { via: 'registered' }` e `paid_at` no início do dia do vencimento; "Pago" do mês passado soma o valor.
- [ ] Lista de contas: o salário mostra os selos "Registro" e "Empresa X" no lugar de "N pessoas"; o avulso mostra "Registro", "A pagar" e "Imobiliária".
- [ ] Detalhe da conta do salário: chip "Registro", linha "De Empresa X", seção "Cobranças", sem "Convidar" e sem compartilhar link.
- [ ] Detalhe da cobrança do salário: selo "Registro" junto ao status; sem "Lembrar", "Compartilhar", comprovante e "Não notificar"; "Reabrir" disponível.
- [ ] Reabrir a cobrança. Esperado: fica pendente e o cron do dia seguinte não a quita de novo (nenhum `charge.paid` novo); "Marcar como pago" quita de novo.
- [ ] Lembrar bloqueado: `curl -X POST <api>/charges/<id>/reminders` com o token da Ana, na cobrança reaberta. Esperado: 409 `SETTLED_NO_REMINDERS`.
- [ ] Editar o salário: "Já recebi" aparece travado com "Não dá para mudar depois de criada."; trocar "De quem" para "Empresa Y" e salvar. Esperado: feed e detalhes mostram "Empresa Y".
- [ ] `curl -X PATCH <api>/billings/<id> -H 'content-type: application/json' -d '{"settled":false}'` com o token da Ana. Esperado: 409 `SETTLED_LOCKED`.
- [ ] Mobile: os mesmos passos no formulário (chave nativa), no detalhe da conta e na cobrança.
```

- [ ] **Step 4: Seed**

Em `packages/api/scripts/seed-local.mjs`:

1. Em `BILLINGS`, antes da conta `pizza`:

```js
  {
    key: 'salario',
    description: 'Salário',
    category: 'income',
    type: 'indefinite',
    frequency: 'monthly',
    startDate: monthDay(-3, 5),
    totalCents: 850000,
    // A registro: no participants and no Pix; every occurrence is paid on its due date.
    settled: true,
    counterpartLabel: 'Empresa X',
    outcome: ({ dueDate }) => (dueDate <= today ? 'paid' : 'pending')
  },
  {
    key: 'dentista',
    description: 'Consulta no dentista',
    category: 'health',
    direction: 'payable',
    type: 'once',
    startDate: monthDay(-1, 18),
    totalCents: 35000,
    settled: true,
    counterpartLabel: 'Clínica Sorriso',
    outcome: () => 'paid'
  },
```

2. Antes de `function dueDatesOf(billing) {`:

```js
/** A registro is paid at the start of its due day; anything else some time before it, or when its proof was accepted. */
function paidAtOf(billing, charge, createdAtCharge, dueDate) {
  if (billing.settled) {
    return instant(dueDate, 0);
  }

  return charge.proof_reviewed_at ?? later(createdAtCharge, instant(earlier(addDays(dueDate, -1), today), 18));
}

function paidVia(billing, proof) {
  if (billing.settled) {
    return 'registered';
  }

  return proof ? 'proof' : 'manual';
}
```

3. No `rows.billings.push({…})`, depois de `pix_label: payable ? (billing.typedPix?.label ?? null) : null,`:

```js
      counterpart_label: billing.counterpartLabel ?? null,
      settled: billing.settled ? true : null,
```

4. Trocar o bloco de `debtors` por:

```js
    // A conta a pagar and a registro are one charge per date for the whole total; a conta a receber, one per person with a share.
    const debtors =
      payable || billing.settled
        ? [{ person: billing.payee ?? null, amountCents: billing.totalCents }]
        : allocations.filter((part) => part.person && part.amountCents > 0);
```

5. Trocar o bloco `if (state === 'paid') {…}` por:

```js
        if (state === 'paid') {
          charge.paid_at = paidAtOf(billing, charge, createdAtCharge, dueDate);
          event('charge.paid', 'charge', chargeId, creditorId, { via: paidVia(billing, proof) }, charge.paid_at);
        }
```

O registro a receber fica com `payer: 'person'`, sem devedor e sem snapshot de Pix (a conta não tem `pix`), como a API grava.

- [ ] **Step 5: Verificar**

Run: `cd packages/api && npx biome check scripts/seed-local.mjs && node --env-file=local.env scripts/seed-local.mjs seed-check@example.test --dry-run`
Expected: Biome limpo; o dry-run conclui sem erro (requer as colunas `counterpart_label` e `settled` no banco local, criadas pelo usuário com a migração do topo do plano).

Run: `pnpm --filter @receivy/api openapi:check`
Expected: "OpenAPI matches reflected routes and schemas."

- [ ] **Step 6: Parar para o usuário commitar**

---

## Self-review

- **Cobertura da spec:**
  - Seção 1 (dados e contrato): colunas e migração como nota (topo, Task 2); `BillingInput`, `normalizeBillingInput` com as cinco regras e mensagens, split só do dono, avulsa no passado, recorrente a partir de hoje, receber sem contato recusado (Task 1); `settled`/`counterpartLabel` em `BillingSummary`, `BillingDetail`, `ChargeSummary` (Task 1, preenchidos na Task 2); `BillingCategory.Income` com rótulo, cor e ícone (Task 1); `BillingDraft` e `buildBillingInput` (Task 1); `canRemind` (Task 1).
  - Seção 2 (API): `POST /billings` com `settled`, sem devedor, quitação na transação com `via: 'registered'` e `paid_at` no início do dia, futuras pendentes (Task 2); `PATCH` com `counterpartLabel` e `SETTLED_LOCKED` nos dois casos da spec (Task 2); edições que criam cobranças seguem a quitação via `persistChargePlan` (Task 2); `GET /billings`, `GET /billings/{id}`, `GET /charges/{id}`, timeline (Task 2); `counterpartName` com o nome livre (Task 2); `pay`/`reopen` sem mudança (nenhuma tarefa os altera); lembrete manual com `SETTLED_NO_REMINDERS` (Task 3); cron `settleRegistered` depois de `materializeDueBillings`, pulando reaberta, idempotente (Task 3); erros nas classes e arquivos da spec (Tasks 2 e 3).
  - Seção 3 (notificações): gate em `sendChargeNotice` depois de `silenced`, em qualquer canal; `announceCharges`, `planReminders`, `followUpCharge` sem evento; `manualReminder`; nenhum repositório importa serviço de notificação (Task 3).
  - Seção 4 (interface): chave, campo com placeholder, Pix/lembretes/"Não notificar" escondidos, data mínima na recorrente, texto de apoio, edição travada com nome editável, categoria na lista (Tasks 5 e 6; `CategorySelect` lista `BILLING_CATEGORIES`); nome livre onde aparece a contraparte e selo "Registro" (API na Task 2, helpers na Task 1, detalhes nas Tasks 5 e 6); "Lembrar", link público, comprovante e "Não notificar" escondidos na cobrança; "De/Para {nome}" e convite escondido no detalhe da conta (Tasks 5 e 6).
  - Seção 5 (testes): todos os casos de API listados estão em `registros.spec.ts` (Tasks 2 e 3) e `notifications.spec.ts` (Task 3); common (Task 1); web e mobile (Tasks 5 e 6).
  - Seção 6: OpenAPI sem rota nova, BFF e cliente mobile sem mudança (Task 4); `notifications.md`, `api-errors.md`, QA `## 21. Registros`, seed (Task 7).
- **Placeholders:** nenhum TBD, nenhum "igual à Task N"; todo passo de código traz o código, com nomes, fixtures e helpers tirados dos arquivos atuais (`api()`, `renderForm`, `withoutPixKeys`, `onceBilling`, `open`, `billing`, `charge`, `serve`, `quickForm`, `financialApi`, `contactsApi`, `yesterday`, `makeClient`, `notifications`, `fakeNotice`, `send`, `start`, `DUE_DATE`).
- **Nomes conferidos entre tarefas:** `settled`, `counterpartLabel`, `counterpart_label`; `normalizeBillingInput(input, now?)`, `normalizeCounterpartLabel`, `buildBillingInput(draft, now?)`, `BillingPlanInput.settled`; `SettledLockedError`/`SETTLED_LOCKED`, `SettledNoRemindersError`/`SETTLED_NO_REMINDERS`; `ChargeRepository.SettledBilling`, `ChargeRepository.settledBilling`, `ChargeRepository.markRegistered`; `settlementOf` (materialize), `settleDueCharge` e `BillingRepository.settleRegistered` (billing); `reason: 'settled'`, `via: 'registered'`; `SETTLED_LABELS`, `SETTLED_HELP`, `SETTLED_LOCKED`, `minimumDate`, `counterpartHeadline` (web e mobile); `paidAtOf`, `paidVia` (seed); `BillingCategory.Income`/`'income'`, cor `#6E9A1F`.
- **Ambiguidades e lacunas** (decididas nas Notas de leitura): relógio só na criação para a regra da recorrente; `PATCH` de registro recusa também os campos que a criação recusa; cron sem filtro de estado da conta; gates extras (`canShare`, `canSilenceCharge`, `canUploadProof`) e "Marcar como pago" como `ActionTile`; selo em feed, lista e detalhes; chave só em registro na edição; hash com os campos só em registro; cor e ícone da categoria; `String.Max<200>` no corpo. Lacunas: convite e link público não bloqueados na API; "Cancelar" continua numa cobrança de registro.
