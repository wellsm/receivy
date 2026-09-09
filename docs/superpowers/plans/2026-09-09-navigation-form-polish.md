# Navegação nativa, formulário bancário e gate de Pix — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voltar automático pelo expo-router no mobile (header nativo com o título da tela anterior) e "← tela anterior" no web; valor digitado como em banco; "Título" + categoria; valores de rateio guardados por modo; fixo mostra o dono como resto; chave Pix obrigatória antes de criar cobrança; e-mail da conta pré-preenchido na chave Pix tipo e-mail.

**Architecture:** `common` guarda o rascunho com `values` por modo e os helpers de dígitos→centavos. Mobile passa a declarar `title` por rota e header nativo nas subtelas (`people`, `people/[id]`, `settings/pix`, `charges/*`), removendo botões "← …" manuais; web usa um mapa rota→rótulo para o link de voltar. O gate de Pix vive no formulário (empurra para a tela de chaves uma vez; ao voltar sem chave mostra o bloqueio com botão).

**Tech Stack:** common vitest; web Next 16 + vitest; mobile Expo SDK 56 + expo-router 56 (`Stack.Screen options`) + jest/RNTL; Maestro.

**Spec:** este plano (mudanças limitadas e descritas aqui; sem spec separada).

## Global Constraints

- Sem dependência nova. UI pt-BR. Código/commits em inglês. Early returns, sem one-liners densos em código novo. Cada task: lint + typecheck + testes do pacote antes do commit; trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_016BY3v9hkgmh7emjR6A5gG2`.
- `BillingDraft.values: { fixed: Record<string,string>; percentage: Record<string,string>; shares: Record<string,string> }`; `buildBillingInput` lê só `values[draft.mode]`; trocar de modo nunca apaga os outros.
- Valor: o campo guarda dígitos; `draft.amount` = centavos formatados `"1234,56"` (sem milhar); exibição `1.234,56`. Digitar "1","0","0" → `1,00`; apagar remove o último dígito; `+ R$ 10` soma 1000 centavos.
- Rótulos: campo de título `accessibilityLabel`/`aria-label` = `Título`, placeholder `Ex.: churrasco da firma`; seção `3. Título`; chips de categoria preenchem o título vazio com o rótulo da categoria.
- Split: `fixed` → linha por pessoa só com o campo (sem valor ao lado); linha do dono (quando participa) só leitura `Você fica com R$ x` (resto; negativo → erro `O rateio ultrapassa o total.`); `shares` → campo + valor calculado, sem texto "N cotas"; `percentage` → campo + valor calculado; `equal` → só valores.
- Gate de Pix: sem método de pagamento ativo → ao abrir "Nova cobrança" salva o rascunho e empurra a tela de chaves Pix com `returnTo` (uma vez por abertura); voltando sem chave, o formulário mostra o bloqueio `Cadastre uma chave Pix para criar cobranças.` com botão `Cadastrar chave` e `Criar cobrança` desabilitado. Tela de chaves com `required` mostra o aviso `Você precisa de uma chave Pix para criar cobranças.`.
- Chave Pix tipo `email`: ao selecionar, se o campo estiver vazio, preenche com o e-mail da conta (editável).
- Web voltar: `backLabelFor(path)` → `/settings` Perfil, `/charges/new` Nova cobrança, `/billings` Cobranças, `/` Feed, `/people` Contatos; link `← <rótulo>` visível em todas as larguras.
- Mobile: header nativo (`headerShown: true`, `headerBackTitleVisible: true`, `headerTintColor: '#003828'`, fundo `#faf8ff`, sem sombra) nas subtelas; telas de aba mantêm `headerShown: false` mas declaram `title` para o botão voltar do iOS.

---

### Task 1: Common — valores por modo e dígitos de valor

**Files:**
- Modify: `packages/common/src/domain/billing-draft.ts` (`BillingDraft.values`, `EMPTY_BILLING_DRAFT`, `buildSplit`), `packages/common/src/domain/billing-preview.ts` (usa `values[mode]`), `packages/common/src/domain/financial-form.ts` (`amountDigitsToInput(digits: string): string` → `"1234,56"`, `amountInputToDigits(input: string): string`, `formatAmountDigits(digits: string): string` → `"1.234,56"`, `addCentsToAmount(input: string, cents: number): string`)
- Test: `billing-draft.test.ts`, `billing-preview.test.ts`, `financial-form.test.ts` (criar se não existir)

- [ ] **Step 1 (RED):** testes: `values` por modo (`fixed` preenchido não afeta `percentage`), `buildBillingInput` com `mode: 'shares'` ignora `values.fixed`; `amountDigitsToInput('100') === '1,00'`, `amountDigitsToInput('') === '0,00'`, `amountDigitsToInput('123456') === '1234,56'`, `formatAmountDigits('123456') === '1.234,56'`, `amountInputToDigits('1.234,56') === '123456'`, `addCentsToAmount('1,00', 1000) === '11,00'`.
- [ ] **Step 2–4:** implementar; `pnpm --filter @receivy/common test lint check-types` (api/web/mobile ficam vermelhos até T2/T3).
- [ ] **Step 5: Commit** `feat(common): split values per mode and bank-style amount helpers`

---

### Task 2: Web — formulário, Pix, gate e voltar

**Files:**
- Modify: `packages/web/src/components/billing-form.tsx` (valor por dígitos + `formatAmountDigits` na exibição; `Título`; `values[mode]`; gate de Pix; bloqueio), `split-editor.tsx` (regras por modo), `pix-settings-screen.tsx` (prefill e-mail; aviso `required`), `people-screen.tsx` (sem mudanças de fluxo), `app/(protected)/people/page.tsx`, `people/[id]/page.tsx`, `settings/pix/page.tsx` (link `← backLabelFor(returnTo ?? '/settings')`; `required` param), `lib/billing-draft.ts` (tipo novo), `lib/navigation.ts` (novo: `backLabelFor`), `globals.css` (`.split-row--readonly`, `.pix-required-notice`)
- Test: `billing-form.test.tsx`, `pix-settings-screen.test.tsx`, `people-screen.test.tsx`, novo `lib/navigation.test.ts`, `a11y.test.tsx`

- [ ] **Step 1 (RED):** digitar `1`,`0`,`0` no `Valor` mostra `1,00` e envia `totalCents: 100`; `+ R$ 10` soma; `Título` presente e `Descrição` ausente; digitar valor fixo, trocar para porcentagem e voltar mantém o fixo; POST envia só o modo selecionado; fixo: linha do dono `Você fica com R$ 40,00` sem campo; cotas: sem texto "cotas"; sem chave Pix ativa → `saveDraft` + `router.push('/settings/pix?returnTo=%2Fcharges%2Fnew&required=1')` uma vez; ao remontar sem chave → bloqueio + botão `Cadastrar chave`; Pix page com `required=1` mostra o aviso; tipo e-mail preenche com o e-mail de `/api/auth/me`; `people` page com `returnTo=/charges/new` mostra `← Nova cobrança`, sem `returnTo` `← Perfil`; `settings/pix` idem.
- [ ] **Step 2–4:** implementar; `pnpm --filter @receivy/web test lint check-types build`.
- [ ] **Step 5: Commit** `feat(web): bank-style amount, per-mode split values, pix gate and contextual back links`

---

### Task 3: Mobile — header nativo, rotas, formulário, Pix, gate, Maestro

**Files:**
- Modify: `packages/mobile/src/app/_layout.tsx` (`Stack` com `Stack.Screen` por rota: `index` title Feed, `billings` Cobranças, `settings` Perfil — `headerShown: false`; `people` Contatos, `people/[id]` Contato, `settings/pix` Chaves Pix, `charges/new` Nova cobrança, `charges/[id]` Cobrança, `charges/created` Cobrança criada — `headerShown: true` com o estilo da constraint), `app/settings.tsx` (sem `section`; `onOpenPix` → `router.push('/settings/pix')`), novo `app/settings/pix.tsx` (`useLocalSearchParams<{ returnTo?, required? }>`; `onCreated` com `returnTo === 'new-billing'` → `patchDraft({ pix })` + `router.back()`), `app/people.tsx`, `app/people/[id].tsx`, `app/charges/new.tsx` (`onCreatePix` → `/settings/pix?returnTo=new-billing`; gate passa `required`), `app/charges/[id].tsx`, `app/charges/created.tsx`
- Modify components: `people-screen.tsx`, `pix-settings-screen.tsx`, `person-ledger-screen.tsx`, `charge-detail-screen.tsx`, `billing-form-screen.tsx` (remover botões "← …"/`Voltar`; `onBack` sai das props ou vira opcional sem UI; `clearDraft()` no evento `beforeRemove` via `useNavigation()` quando o form é desempilhado — não no side trip), `billing-created-screen.tsx` (mantém botão `Voltar às cobranças`), `split-editor.tsx`, `pix-settings-screen.tsx` (prefill e-mail via `profileStore.load()`; aviso `required`), `financial/draft-store.ts` (tipo), `e2e/smoke/03-contact-charge.yaml` e `04-tabs.yaml` (voltar pelo header: `tapOn: "Perfil"`/`"Nova cobrança"` no botão nativo; `tapOn: "Título"` no lugar de `Descrição`; valor digitado como `10000` → `100,00`; primeiro acesso a Nova cobrança cai na tela de chaves Pix quando a conta não tem chave — o 03 cria a chave antes, via Perfil → Minhas Chaves Pix)
- Test: `billing-form-screen.test.tsx`, `pix-settings-screen.test.tsx` (criar), `people-screen.test.tsx`, `settings` route tests se existirem

- [ ] **Step 1 (RED):** espelho da Task 2 em RNTL + `_layout` declara títulos (teste simples que renderiza o layout? opcional) + `beforeRemove` limpa o rascunho.
- [ ] **Step 2–4:** implementar; `pnpm --filter @receivy/mobile test lint check-types`; iniciar Metro brevemente se `check-types` reclamar de rotas tipadas (`/settings/pix` nova).
- [ ] **Step 5: Commit** `feat(mobile): native stack headers, bank-style amount, per-mode split values and pix gate`
- [ ] **Step 6 (controller):** Maestro 01–04 no simulador; ajustar seletores do header nativo.

## Self-review

- Constraints → T1 (values/dígitos), T2/T3 (UI, gate, Pix, voltar). `values` novo consumido por T2/T3 e pelos stores. `backLabelFor` só web. Mobile `onBack` removido das telas com header nativo; `BillingCreatedScreen` mantém ação explícita.
