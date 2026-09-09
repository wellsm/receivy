# Contatos e chaves Pix — telas de lista e cadastro — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lista de contatos com busca, badges de pendência e FAB; formulário de contato em tela própria (apelido; contato vinculado só edita o apelido); lista de chaves Pix com copiar/padrão/excluir; cadastro de chave em tela própria com tipos, máscaras, "Colar"/limpar e principal. Mobile + web + API.

**Architecture:** API ganha `people.nickname`, `Person.activeCharges`, `Person.displayName` e a regra "vinculado só altera apelido". `common` ganha máscaras (`formatPhoneBR`, `formatCpf`, `formatCnpj`, `pixKeyField(type)`), `initialsOf`, `contactBadge`. Web e mobile ganham telas próprias (`/people/new`, `/people/[id]/edit`, `/settings/pix/new`) e listas reescritas; as telas de lista deixam de ter formulário inline. Retornos (`returnTo`) do formulário de cobrança e do gate de Pix passam a apontar para as telas de cadastro.

**Tech Stack:** EZ4 0.52 (specs `node:test`), vitest (common/web), jest+RNTL, expo-router (header nativo já configurado; `Stack.Screen` `title` para as rotas novas), `expo-clipboard` (já instalado), `navigator.clipboard` no web.

**Spec:** este plano.

## Global Constraints

- Sem dependência nova. UI pt-BR; código/commits em inglês; early returns; sem one-liners densos em código novo. Cada task: lint + typecheck + testes (API também `test:integration`) antes do commit; trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_016BY3v9hkgmh7emjR6A5gG2`.
- API: `people.nickname?` (≤ 60, NFC/trim). `Person` ganha `nickname: string | null`, `displayName: string` (= `nickname || name`), `activeCharges: number` (charges `pending` onde `debtor_person_id` = pessoa). `PersonInput` ganha `nickname?`. Contato com `linked_user_id`: `PATCH /people/{id}` aceita só `nickname`; qualquer outro campo diferente do atual → `HttpConflictError('Contato vinculado a uma conta: só o apelido pode mudar.')`.
- Nome exibido em cards, carrossel, feed (`counterpartName` continua o snapshot da charge) e detalhe: `displayName`; formulário e detalhe mostram o nome completo.
- Lista de contatos: header `Meus Contatos` (mobile: header nativo; web: `← Perfil`/`← Nova cobrança` via `backLabelFor`), busca `Buscar por nome, telefone ou e-mail...` (300 ms, `search=`), seção `CONTATOS` + `N contato(s)`, card (`accessibilityLabel`/`aria-label` `Contato <displayName>`): iniciais (2 letras), `displayName`, badge `N ativa(s)` (âmbar) ou `Sem pendências` (verde), subtítulo telefone formatado senão e-mail, chevron → detalhe/histórico (`/people/[id]`). FAB `Novo contato` → `/people/new`. Vazio: `Nenhum contato ainda`. Paginação `Carregar mais`.
- Formulário de contato (`/people/new`, `/people/[id]/edit`): título `Novo contato` / `Editar contato`; aviso `Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.`; campos `Nome completo` (obrigatório), `Apelido` (opcional, `Como prefere chamar`), `WhatsApp / Celular` (opcional, máscara `(11) 98765-4321`, `keyboardType phone-pad`/`inputMode tel`, ajuda `Usado para lembretes.`), `E-mail` (opcional, `contato@email.com`, ajuda `Usado para enviar avisos.`); vinculado → só `Apelido` editável, os outros desabilitados com nota `Contato vinculado a uma conta: só o apelido pode mudar.`; rodapé fixo `Salvar contato`. Com `returnTo` (nova cobrança): após salvar `patchDraft({ selected })` e volta como hoje. Detalhe do contato ganha ação `Editar` → `/people/[id]/edit`.
- Lista de chaves: header `Minhas Chaves Pix`, seção `CHAVES ATIVAS (N)`, card: ícone por tipo, rótulo do tipo (`CPF`, `CNPJ`, `Celular`, `E-mail`, `Chave aleatória`), badge `Principal / Padrão` no `isDefault` (borda esquerda verde), banco/`label` quando houver, caixa com a chave formatada completa + `Copiar chave` (toast/status `Chave copiada`), `Tornar padrão` nas demais, menu `⋮` → `Excluir` (confirmação, `POST /payment-methods/{id}/archive`), aviso `Seus dados Pix ficam protegidos e nunca são compartilhados sem sua autorização.`, FAB/botão `Cadastrar nova chave` → `/settings/pix/new`. Vazio: `Nenhuma chave ainda`. Sem edição. `required=1` mostra `Você precisa de uma chave Pix para criar cobranças.`.
- Cadastro de chave (`/settings/pix/new`): título `Nova chave Pix`; grade `Tipo de chave` (radiogroup: `CPF`, `CNPJ`, `Celular`, `E-mail`, `Chave aleatória`); campo por tipo — rótulo/placeholder/máscara/teclado: CPF `000.000.000-00` numérico (máscara), CNPJ `00.000.000/0000-00`, Celular `(00) 00000-0000`, E-mail `seu.email@exemplo.com.br` (pré-preenchido com o e-mail da conta quando vazio; editável), Aleatória `89a456bc-1234-…` (texto); envia o valor sem máscara (dígitos) para CPF/CNPJ/celular (`+55` como hoje para telefone; confirmar o formato que a API aceita em `paymentMethods` e manter). Campo `Banco (opcional)` (`label`). Toggle `Definir como chave principal` (ligado quando não há chave; ao salvar com ele ligado chama `POST /payment-methods/{id}/default`). Botão do campo: **mobile** `Colar` (`expo-clipboard` `getStringAsync`) quando sem foco; com foco e valor → `X` (`accessibilityLabel="Limpar"`); **web** botão `Colar` (`navigator.clipboard.readText`, falha → foca o campo) que vira `Limpar` quando há valor. Rodapé fixo `Salvar chave Pix`. Com `returnTo` volta como hoje (`patchDraft({ pix })`).
- Máscaras no common: `formatPhoneBR`, `formatCpf`, `formatCnpj`, `onlyDigits`, `pixKeyField(type) → { label, placeholder, keyboard: 'numeric' | 'tel' | 'email' | 'text', format(value) }`, `initialsOf(name)`, `contactBadge(activeCharges) → { label, tone }`.
- Maestro `03`: contato criado via FAB `Novo contato` → `Salvar contato` → volta; chave via FAB `Cadastrar nova chave` → `Salvar chave Pix` → volta; `04`: `Gerenciar chaves Pix` → `assertVisible: ${EMAIL}` continua (chave listada).

---

### Task 1: API + common

**Files:**
- Modify: `packages/api/src/schemas/person.ts` (`nickname?: String.Max<60>`), `packages/api/src/people/repository.ts` (`SELECT`, `details()` com `activeCharges` via uma query agregada por página em `charges` `state = 'pending'` por `debtor_person_id`, `nickname`, `displayName`; `savePerson` com `nickname` e a regra do vinculado), `packages/api/src/people/endpoints.ts` (`nickname?` nos bodies), `packages/common/src/domain/people.ts` (`Person`, `PersonInput`, `normalizePerson` com `nickname`), `packages/common/src/domain/contact-format.ts` (novo: máscaras, `initialsOf`, `contactBadge`, `pixKeyField`), `packages/common/src/index.ts`, `docs/openapi.json`
- Test: `packages/api/test/auth-people/auth-people.spec.ts` (nickname salvo, `displayName`, `activeCharges` conta só `pending`, vinculado: PATCH só apelido → ok; nome diferente → 409), `packages/common/src/domain/contact-format.test.ts`, `people.test.ts`

- [ ] **Step 1 (RED)** → **Step 4** gates (`pnpm --filter @receivy/common test lint check-types`; api `lint check-types check-types:test test test:integration openapi:generate`).
- [ ] **Step 5: Commit** `feat(api): contact nickname, pending counts and linked-contact edit rule`

---

### Task 2: Web

**Files:**
- Rewrite: `packages/web/src/components/people-screen.tsx` (lista), `pix-settings-screen.tsx` (lista de chaves)
- Create: `packages/web/src/components/contact-form.tsx`, `pix-key-form.tsx`, `app/(protected)/people/new/page.tsx`, `app/(protected)/people/[id]/edit/page.tsx`, `app/(protected)/settings/pix/new/page.tsx` (todas com `returnTo`/`required` e `← backLabelFor`), testes
- Modify: `person-details.tsx` (ação `Editar`), `billing-form.tsx` (`Novo contato` → `/people/new?returnTo=…`; gate/`Cadastrar chave` → `/settings/pix/new?returnTo=…&required=1`), `contact-carousel.tsx`/`contact-picker.tsx` (`displayName`), `globals.css`, `a11y.test.tsx`, `lib/navigation.ts` (`/people/new` → `Contatos`? não: rótulo de volta da tela de cadastro = `Contatos` ou `Nova cobrança` conforme `returnTo`)

- [ ] **Step 1 (RED)** → gates `pnpm --filter @receivy/web test lint check-types build`.
- [ ] **Step 5: Commit** `feat(web): contact and pix key screens with dedicated forms`

---

### Task 3: Mobile

**Files:**
- Rewrite: `packages/mobile/src/components/people-screen.tsx`, `pix-settings-screen.tsx`
- Create: `components/contact-form-screen.tsx`, `pix-key-form-screen.tsx`, `app/people/new.tsx`, `app/people/[id]/edit.tsx`, `app/settings/pix/new.tsx`; `_layout.tsx` ganha `title`s (`Novo contato`, `Editar contato`, `Nova chave Pix`) com header nativo
- Modify: `app/people.tsx`, `app/charges/new.tsx` (rotas de retorno), `person-ledger-screen.tsx` (ação `Editar`), `billing-form-screen.tsx` (gate → `/settings/pix/new`), `contact-carousel.tsx`/`contact-picker-sheet.tsx` (`displayName`), SVGs de ícones que faltarem (`copy`, `star`, `more`, `phone`, `id-card`, `building`), Maestro `03`/`04`, testes

- [ ] **Step 1 (RED)** → gates `pnpm --filter @receivy/mobile test lint check-types` (Metro breve se rotas tipadas reclamarem).
- [ ] **Step 5: Commit** `feat(mobile): contact and pix key screens with dedicated forms`
- [ ] **Step 6 (controller):** Maestro 01–04.

## Self-review
Constraints → T1 (dados/máscaras), T2/T3 (telas). `displayName` produzido por T1 consumido por T2/T3. Rotas de retorno atualizadas nos dois apps. Sem placeholders: campos, rótulos, rotas e regras definidos.
