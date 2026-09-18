# Meios de pagamento (web + mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela "Chaves Pix" vira "Meios de pagamento" com Pix e InfinitePay; a página pública mostra "Pagar" pelo link da InfinitePay com o comprovante como fallback; o detalhe da cobrança copia o link ou pede um novo; o retorno do pagador fecha a cobrança.

**Architecture:** Web e mobile mantêm a mesma árvore de componentes e os mesmos nomes de arquivo. Os rótulos de meio de pagamento saem do common (`paymentMethodText`), cada plataforma mantém só o mapa de ícones. Formulário único com chips de provider; a página pública é server component e fala com a API direto (o retorno da InfinitePay é lido dos query params e repassado a `provider-return` antes de renderizar).

**Tech Stack:** Next 16 (app router, server components, BFF em `app/api`), Tailwind; Expo Router, Uniwind, expo-image, expo-clipboard; vitest + Testing Library (web), jest + RNTL (mobile).

**Spec:** `docs/superpowers/specs/2026-09-18-meios-de-pagamento-infinitepay-design.md` (§4 Interface). **Pré-requisito:** `docs/superpowers/plans/2026-09-18-meios-de-pagamento-api.md` executado (contratos `PaymentProvider`, `PaymentMethod { provider, kind, value }`, `ChargeDetail.payment/paymentLink/receiptUrl`, rotas `POST /charges/{id}/payment-link` e `POST /public/charges/{token}/provider-return`).

## Global Constraints

- Estilo (CLAUDE.md): chaves em todo `if/else/for`; linha em branco quando muda o tipo de statement; `return` cedo. Web e mobile: eslint `curly` + `padding-line-between-statements`. Classes Tailwind/Uniwind ficam no componente; nunca em `globals.css`.
- Web: arquivos formatados como prettier a ~200 colunas; **nunca** rodar `prettier --write`. Nada de i18n: strings pt-BR direto no componente. Mobile: `accessibilityLabel` num `Pressable` esconde os textos internos para o Maestro (memória `rn-accessibility-label-hides-children`); inputs iOS usam `text-[16px] py-0 h-full` (memória `rn-ios-textinput-line-height`).
- Mobile: depois de criar/renomear rotas sem `expo start`, regenerar `.expo/types/router.d.ts` (memória `rn-rntl-async-fireevent-typed-routes`): `cd packages/mobile && EXPO_ROUTER_APP_ROOT=$PWD/src/app node -e "require('<pnpm path>/@expo/router-server/build/typed-routes').regenerateDeclarations('$PWD/.expo/types', {}); setTimeout(()=>{}, 2500)"` (o caminho do pnpm: `ls node_modules/.pnpm | grep router-server`). Em testes RNTL, `await fireEvent...`.
- Nunca comitar, nunca deploy. Cada task termina em `check-types` + testes do pacote; o dono comita.
- Não adicionar dependência (ícone InfinitePay = `Infinity` do lucide no web; no mobile, um SVG novo em `assets/images/auth/infinity.svg`, desenhado inline neste plano).
- Rotas antigas do web (`/settings/pix`, `/settings/pix/new`) viram `redirect()` permanente para as novas; no mobile só trocam.
- `SharingState.PixRequired` e a string `pix_required` não mudam (fora de escopo).
- Timeline: os clientes não renderizam eventos por tipo (o "timeline" da API é o extrato de cobranças), então não há rótulos de evento a adicionar; o item da spec §3 sobre rótulos cai.

---

## Mapa de arquivos

**common**
- Create `src/domain/payment-method-text.ts`, `payment-method-text.test.ts` — `PIX_KIND_LABELS`, `paymentMethodText`.
- Modify `src/index.ts`.

**web (`packages/web/src`)**
- Rename `components/screens/pix-settings-screen.tsx` → `payment-methods-screen.tsx` (+ `.test.tsx`); `components/forms/pix-key-form-screen.tsx` → `payment-method-form-screen.tsx` (+ `.test.tsx`).
- Create `components/ui/provider-icon.tsx`.
- Rename `app/(protected)/settings/pix/page.tsx` → `settings/payment-methods/page.tsx`; `settings/pix/new/page.tsx` → `settings/payment-methods/new/page.tsx`; Create redirects nos caminhos antigos.
- Create `app/dev/infinitepay/[orderNsu]/page.tsx` (checkout de mentira, só fora de produção).
- Modify `app/pay/[token]/page.tsx`, `components/app/first-share-pix.tsx`, `components/forms/billing-form-screen.tsx`, `components/screens/charge-detail-screen.tsx`, `components/screens/profile-screen.tsx`, `lib/financial-proxy.ts`, `a11y.test.tsx` e os testes que carregam fixtures de `PaymentMethod`/`ChargeDetail`.

**mobile (`packages/mobile/src`)**
- Rename `components/screens/pix-settings-screen.tsx` → `payment-methods-screen.tsx` (+ test); `components/forms/pix-key-form-screen.tsx` → `payment-method-form-screen.tsx` (+ test).
- Rename `app/(protected)/settings/pix.tsx` → `settings/payment-methods.tsx`; `settings/pix/new.tsx` → `settings/payment-methods/new.tsx`.
- Create `assets/images/auth/infinity.svg`.
- Modify `app/(protected)/_layout.tsx`, `app/(protected)/(tabs)/settings.tsx`, `app/(protected)/billings/new.tsx`, `financial/client.ts`, `components/app/first-share-pix.tsx`, `components/forms/billing-form-screen.tsx`, `components/screens/charge-detail-screen.tsx`, `components/screens/profile-screen.tsx`, testes com fixtures.

---

### Task 1: Rótulos no common

**Files:**
- Create: `packages/common/src/domain/payment-method-text.ts`, `payment-method-text.test.ts`
- Modify: `packages/common/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  PIX_KIND_LABELS: Record<PixKeyType, string>   // cpf: 'CPF', cnpj: 'CNPJ', phone: 'Celular', email: 'E-mail', random: 'Chave aleatória'
  paymentMethodText(method: { provider: PaymentProvider; kind: PixKeyType | null; value: string }): { title: string; value: string }
  // Pix → { title: PIX_KIND_LABELS[kind], value: pixKeyField(kind).format(value) }; InfinitePay → { title: 'InfinitePay', value: `$${value}` }
  ```

- [ ] **Step 1: Teste**

```ts
import { describe, expect, it } from 'vitest';
import { PaymentProvider, PixKeyType } from './contracts';
import { paymentMethodText } from './payment-method-text';

describe('paymentMethodText', () => {
  it('names a Pix key by its kind and masks the value', () => {
    expect(paymentMethodText({ provider: PaymentProvider.Pix, kind: PixKeyType.Cpf, value: '52998224725' })).toEqual({ title: 'CPF', value: '529.982.247-25' });
  });

  it('shows an InfiniteTag with its dollar sign', () => {
    expect(paymentMethodText({ provider: PaymentProvider.InfinitePay, kind: null, value: 'minha.loja' })).toEqual({ title: 'InfinitePay', value: '$minha.loja' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/common exec vitest run src/domain/payment-method-text.test.ts --pool=forks`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
import { pixKeyField } from './contact-format';
import { PaymentProvider, PixKeyType } from './contracts';

export const PIX_KIND_LABELS: Record<PixKeyType, string> = {
  [PixKeyType.Cpf]: 'CPF',
  [PixKeyType.Cnpj]: 'CNPJ',
  [PixKeyType.Phone]: 'Celular',
  [PixKeyType.Email]: 'E-mail',
  [PixKeyType.Random]: 'Chave aleatória'
};

export type PaymentMethodText = { title: string; value: string };

/** How a method reads on a list, a picker or a dialog: its kind as the title, its value as people know it. */
export function paymentMethodText(method: { provider: PaymentProvider; kind: PixKeyType | null; value: string }): PaymentMethodText {
  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return { title: 'InfinitePay', value: `$${method.value}` };
  }

  return { title: PIX_KIND_LABELS[method.kind], value: pixKeyField(method.kind).format(method.value) };
}
```

`index.ts`: `export * from './domain/payment-method-text';` (entre `notifications` e `pix-key`).

- [ ] **Step 4: Verificar**

Run: `pnpm --filter @receivy/common check-types && pnpm --filter @receivy/common test`
Expected: OK.

---

### Task 2: Web — ícone do provider, tela "Meios de pagamento" e rotas

**Files:**
- Create: `packages/web/src/components/ui/provider-icon.tsx`
- Rename + Modify: `packages/web/src/components/screens/pix-settings-screen.tsx` → `payment-methods-screen.tsx`; `pix-settings-screen.test.tsx` → `payment-methods-screen.test.tsx`
- Rename + Modify: `packages/web/src/app/(protected)/settings/pix/page.tsx` → `settings/payment-methods/page.tsx`
- Create: `packages/web/src/app/(protected)/settings/pix/page.tsx` (redirect)
- Modify: `packages/web/src/components/screens/profile-screen.tsx:439`

**Interfaces:**
- Consumes: Task 1.
- Produces: `PaymentMethodsScreen({ returnTo?, required? })`; `ProviderIcon({ method, size?, className? })` (Pix → `PixTypeIcon` do kind; InfinitePay → lucide `Infinity`).

- [ ] **Step 1: `provider-icon.tsx`**

```tsx
import { PaymentProvider, type PixKeyType } from "@receivy/common";
import { Infinity as InfinityIcon } from "lucide-react";
import { PixTypeIcon } from "@/components/ui/pix-type-icon";

type ProviderIconProps = { method: { provider: PaymentProvider; kind: PixKeyType | null }; size?: number; className?: string };

/** The icon of a payment method: the Pix key kind, or the InfinitePay mark. */
export function ProviderIcon({ method, size = 18, className }: ProviderIconProps) {
  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return <InfinityIcon size={size} aria-hidden="true" className={className} />;
  }

  return <PixTypeIcon type={method.kind} size={size} className={className} />;
}
```

- [ ] **Step 2: Teste da tela (renomear e ajustar)**

`git mv` dos dois arquivos de tela e teste. No teste:
- Fixtures: `main = { id: "pix-1", label: "Nubank", provider: "pix", kind: "cpf", value: "52998224725", isDefault: true, archivedAt: null, contactId: null, createdAt: "2026-09-01T00:00:00Z" }`, `other = { ..., provider: "pix", kind: "email", value: "ana@example.com", ... }`, e novo `tag = { id: "ip-1", label: "Loja", provider: "infinitepay", kind: null, value: "minha.loja", isDefault: false, archivedAt: null, contactId: null, createdAt: "2026-09-02T00:00:00Z" }`.
- Import `PaymentMethodsScreen` de `@/components/screens/payment-methods-screen`.
- Textos: `"Excluir chave Pix?"` → `"Excluir meio de pagamento?"`; `"Nenhuma chave ainda"` → `"Nenhum meio de pagamento"`; `"Você precisa de uma chave Pix para criar cobranças."` → `"Você precisa de um meio de pagamento para criar cobranças."`; link `"Cadastrar nova chave"` → `"Cadastrar novo meio"`; href esperado `/settings/payment-methods/new?...`; botão `"Copiar chave"` → `"Copiar valor"`.
- Novo teste:

```tsx
it("lists an InfinitePay method with its tag", async () => {
  serve([main, tag]);
  render(<PaymentMethodsScreen />);

  expect(await screen.findByText("InfinitePay")).toBeInTheDocument();
  expect(screen.getByText("$minha.loja")).toBeInTheDocument();
});
```

(`serve` é o helper que o teste já usa para mockar `browserFetch`; se tiver outro nome, usar o existente.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web exec vitest run src/components/screens/payment-methods-screen.test.tsx --pool=forks`
Expected: FAIL.

- [ ] **Step 4: Tela**

Em `payment-methods-screen.tsx` (renomeado): 
- Imports: `import { paymentMethodText, type PaymentMethod, type PaymentMethodsPage } from "@receivy/common";` e `import { ProviderIcon } from "@/components/ui/provider-icon";` (remover `pixKeyField`, `PIX_TYPE_LABELS`, `PixTypeIcon`).
- `type PaymentMethodsScreenProps`; `export function PaymentMethodsScreen`.
- Constantes: `LIST_ERROR = "Não foi possível carregar seus meios de pagamento."`, `UPDATE_ERROR = "Não foi possível atualizar seus meios de pagamento."`, `COPY_ERROR = "Não foi possível copiar o valor."`, `SAFETY_NOTE = "Seus dados de recebimento ficam protegidos e nunca são compartilhados sem sua autorização."`.
- `formHref`: `/settings/payment-methods/new`.
- Aviso `required`: "Você precisa de um meio de pagamento para criar cobranças."
- Título da lista: `MEIOS ATIVOS ({items.length})`. Vazio: `"Nenhum meio de pagamento"` / `"Cadastre uma chave Pix ou sua InfiniteTag para receber pelos links de cobrança."` / link `"Cadastrar novo meio"`.
- No card, calcular `const text = paymentMethodText(method);` e usar: ícone `<ProviderIcon method={method} size={20} />`, título `{text.title}`, `title={`Remover ${text.title} ${text.value}`}`, valor `{text.value}`, `<CopyButton value={method.provider === "infinitepay" ? `$${method.value}` : method.value} ariaLabel="Copiar valor" .../>`.
- Notices: `"Meio principal atualizado."` / `"Meio de pagamento excluído."`.
- Rodapé: `aria-label="Cadastrar novo meio"`, texto `Cadastrar Novo Meio`.
- Dialog: `title="Excluir meio de pagamento?"`, detail `{text.title}` / `{text.value}` (calcular `paymentMethodText(removing)`), `explanation="O meio sai dos próximos links de cobrança. As cobranças já criadas não mudam."`.

- [ ] **Step 5: Rotas e perfil**

`app/(protected)/settings/payment-methods/page.tsx` (conteúdo do antigo, com `PaymentMethodsScreen`, `title="Meios de pagamento"`). `app/(protected)/settings/pix/page.tsx` vira:

```tsx
import { redirect } from "next/navigation";

export default function LegacyPixSettingsPage() {
  redirect("/settings/payment-methods");
}
```

`profile-screen.tsx:439`: `label="Gerenciar meios de pagamento" title="Meios de pagamento" subtitle="Pix e InfinitePay para receber pagamentos" href="/settings/payment-methods"`; ajustar `profile-screen.test.tsx` se afirmar o texto antigo. `a11y.test.tsx`: import e fixture (`provider/kind/value`).

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @receivy/web exec vitest run src/components/screens/payment-methods-screen.test.tsx src/components/screens/profile-screen.test.tsx --pool=forks`
Expected: PASS. (`check-types` do web ainda falha nos arquivos das próximas tasks.)

---

### Task 3: Web — formulário com chips Pix / InfinitePay

**Files:**
- Rename + Modify: `packages/web/src/components/forms/pix-key-form-screen.tsx` → `payment-method-form-screen.tsx`; `.test.tsx` idem
- Rename + Modify: `packages/web/src/app/(protected)/settings/pix/new/page.tsx` → `settings/payment-methods/new/page.tsx`; Create redirect no caminho antigo
- Modify: `packages/web/src/components/app/first-share-pix.tsx`

**Interfaces:**
- Produces: `PaymentMethodFormScreen({ returnTo?, required? })`. Corpo enviado: Pix `{ provider: "pix", kind, value }`; InfinitePay `{ provider: "infinitepay", value }`. Erro 422 `INFINITEPAY_CHECKOUT_DISABLED` → mensagem + botão "Abrir configurações da InfinitePay" (`fields.redirectUrl`).

- [ ] **Step 1: Teste**

Renomear o teste; trocar imports/textos (`"Salvar chave Pix"` → `"Salvar meio de pagamento"`, corpo esperado `{ provider: "pix", kind: "email", value: ... }`, rota final `/settings/payment-methods`). Adicionar:

```tsx
it("saves an InfiniteTag without the dollar sign", async () => {
  const user = userEvent.setup();

  serve(); // lista vazia + /api/auth/me, como os outros testes
  render(<PaymentMethodFormScreen />);

  await user.click(screen.getByRole("radio", { name: "InfinitePay" }));
  await user.type(screen.getByLabelText("InfiniteTag"), "$Minha.Loja");
  await user.click(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

  await waitFor(() => expect(lastBody()).toEqual({ provider: "infinitepay", value: "$Minha.Loja" }));
});

it("points at the InfinitePay switch when the checkout is off", async () => {
  const user = userEvent.setup();

  serve({ save: Response.json({ type: "error", message: "Ative o checkout externo no app da InfinitePay e tente de novo.", context: { code: "INFINITEPAY_CHECKOUT_DISABLED", fields: { redirectUrl: "https://app.infinitepay.io/x" } } }, { status: 422 }) });
  render(<PaymentMethodFormScreen />);

  await user.click(screen.getByRole("radio", { name: "InfinitePay" }));
  await user.type(screen.getByLabelText("InfiniteTag"), "loja");
  await user.click(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Ative o checkout externo");
  expect(screen.getByRole("link", { name: "Abrir configurações da InfinitePay" })).toHaveAttribute("href", "https://app.infinitepay.io/x");
});
```

(`serve`/`lastBody` são os helpers do teste existente; adaptar aos nomes reais. A normalização do `$` é da API; o cliente manda o que foi digitado.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @receivy/web exec vitest run src/components/forms/payment-method-form-screen.test.tsx --pool=forks`
Expected: FAIL.

- [ ] **Step 3: Formulário**

Em `payment-method-form-screen.tsx`:
- Estado novo: `const [provider, setProvider] = useState<PaymentProvider>(PaymentProvider.Pix);` e `const [handle, setHandle] = useState("");`. Import `PaymentProvider, apiErrorCode` de `@receivy/common` (se `apiErrorCode` existir; senão ler `context.code` do JSON).
- Erro estruturado: `const [error, setError] = useState<{ message: string; redirectUrl?: string }>({ message: "" });`.
- `submit`: corpo `provider === PaymentProvider.InfinitePay ? { provider, value: handle } : { provider, kind: type, value: spec.unformat(value) }`. Se `!response.ok`: ler `const payload = await response.clone().json().catch(() => null)`; se `payload?.context?.code === "INFINITEPAY_CHECKOUT_DISABLED"` → `setError({ message: payload.message, redirectUrl: payload.context.fields?.redirectUrl })` e retornar; senão `throw new Error(await responseMessage(response, SAVE_ERROR))`.
- Depois de salvar: `router.push("/settings/payment-methods")`.
- JSX, acima de `<PixKeyFields>`:

```tsx
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="text-xs font-semibold text-muted">Tipo de meio</legend>
        <div role="radiogroup" aria-label="Tipo de meio" className="flex gap-2">
          {[
            { value: PaymentProvider.Pix, label: "Pix" },
            { value: PaymentProvider.InfinitePay, label: "InfinitePay" },
          ].map(option => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={provider === option.value}
              onClick={() => {
                setProvider(option.value);
                setError({ message: "" });
              }}
              className={`min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold ${provider === option.value ? "border-primary bg-primary-soft/40 text-primary-strong" : "border-outline/40 bg-surface text-ink"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {provider === PaymentProvider.Pix ? (
        <PixKeyFields type={type} value={value} required onPickType={pick} onChange={change} />
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="infinitepay-handle" className="text-xs font-semibold text-muted">
            InfiniteTag
          </label>
          <div className="flex min-h-12 items-center rounded-xl border border-outline/50 bg-surface px-3">
            <span aria-hidden="true" className="pr-1 text-sm font-bold text-muted">$</span>
            <input
              id="infinitepay-handle"
              value={handle}
              required
              maxLength={41}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onChange={event => {
                setError({ message: "" });
                setHandle(event.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
            />
          </div>
          <p className="m-0 text-xs leading-5 text-muted">É o nome de usuário do app InfinitePay. O checkout externo precisa estar ativo lá; a cobrança aceita Pix ou cartão em até 12x.</p>
        </div>
      )}
```

- Bloco "Definir como principal": texto "Definir como meio principal" / "Este meio será usado como padrão ao criar novas cobranças."; `id="method-default"`.
- Erro:

```tsx
      {error.message && (
        <p className="m-0 flex flex-col gap-2 rounded-xl bg-danger-soft p-4 text-sm text-danger" role="alert">
          {error.message}
          {error.redirectUrl && (
            <a href={error.redirectUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
              Abrir configurações da InfinitePay
            </a>
          )}
        </p>
      )}
```

- Botão: `aria-label="Salvar meio de pagamento"`, texto `"Salvar meio de pagamento"`. Aviso `required`: "Você precisa de um meio de pagamento para criar cobranças."

Rota nova `settings/payment-methods/new/page.tsx` com `title="Novo meio de pagamento"` e `back={safeReturn ?? "/settings/payment-methods"}`; `settings/pix/new/page.tsx` vira `redirect("/settings/payment-methods/new")`.

- [ ] **Step 4: `first-share-pix.tsx`**

Só campos: `body: JSON.stringify({ provider: "pix", kind: type, value: key })`; a `<option>` mostra `{paymentMethodText(item).title} · {paymentMethodText(item).value}`; filtrar `items` para `provider === "pix"`? Não: uma cobrança pode ser publicada com InfinitePay também; listar todos (`paymentMethodText` cobre os dois). Texto "Pix antes de compartilhar" → "Meio de pagamento antes de compartilhar"; "Publicar com este Pix" → "Publicar com este meio". Link novo abaixo do `<details>`: `<Link href="/settings/payment-methods/new" className="text-xs font-semibold text-primary">Outros meios (InfinitePay)</Link>`.

- [ ] **Step 5: Rodar**

Run: `pnpm --filter @receivy/web exec vitest run src/components/forms/payment-method-form-screen.test.tsx src/components/screens/charge-detail-screen.test.tsx --pool=forks`
Expected: form PASS; charge-detail pode falhar em tipo/fixture (Task 5 cobre).

---

### Task 4: Web — formulário de conta (picker) e proxy

**Files:**
- Modify: `packages/web/src/components/forms/billing-form-screen.tsx:60,71,218-219,688-690,1108-1175,761`
- Modify: `packages/web/src/lib/financial-proxy.ts:22`
- Modify: `packages/web/src/components/forms/billing-form-screen.test.tsx`, `contact-form-screen.test.tsx`, `contacts-screen.test.tsx`, `billing-detail-screen.test.tsx` (fixtures)

- [ ] **Step 1: Picker**

- `PIX_SETUP = \`/settings/payment-methods/new?returnTo=...&required=1\``.
- Import `paymentMethodText` de `@receivy/common` e `ProviderIcon` de `@/components/ui/provider-icon`; remover `PIX_TYPE_LABELS`/`PixTypeIcon` se não sobrar uso (o contato pagador usa `PixKeyFields`, que tem seu próprio import).
- `abbreviate(value)` continua.
- Linhas 1138-1145 (botão do picker): `<ProviderIcon method={selectedPix ?? { provider: PaymentProvider.Pix, kind: PixKeyType.Random }} />`; título `{selectedPix ? \`${paymentMethodText(selectedPix).title}: ${abbreviate(paymentMethodText(selectedPix).value)}\` : "Selecionar meio de pagamento"}`; subtítulo `"Meio padrão" / "Meio secundário" / "Nenhum meio cadastrado"`.
- Rótulo do campo (1112): `payable ? "Pagar via Pix" : "Receber por"`.
- Lista (1152-1175): `aria-label="Meio de pagamento"`; por item `const text = paymentMethodText(method);` → `<ProviderIcon method={method} />`, `{text.title}`, `{text.value}`.
- Botão 761 e 1115: "Cadastrar chave Pix" → "Cadastrar meio de pagamento"; `PIX_GATE_TITLE = "Cadastre um meio de pagamento"`, `PIX_GATE_NOTE = "Uma conta a receber gera um link de pagamento com o seu Pix ou sua InfinitePay. Cadastre um e volte para continuar de onde parou."`.

- [ ] **Step 2: Proxy**

`financial-proxy.ts` linha 22: `["POST", new RegExp(\`^charges/${ID}/(?:cancel|pay|reopen|public-link|public-link/rotate|payment-link)$\`)]`. O teste `openapi-contract.test.ts` confere contra `docs/api-oas.yml` regenerado no plano da API.

- [ ] **Step 3: Fixtures de teste**

Em cada teste listado: `pixKeyType: X, pixKey: Y` → `provider: "pix", kind: X, value: Y` (+ `contactId: null, createdAt` se o tipo exigir); asserts de texto `"Selecionar chave Pix"` → `"Selecionar meio de pagamento"`, `"Chave padrão"` → `"Meio padrão"`. `billing-detail-screen.test.tsx` usa `BillingDetail.pix` (`PixSnapshot`, inalterado) — só conferir.

- [ ] **Step 4: Rodar**

Run: `pnpm --filter @receivy/web exec vitest run src/components/forms src/lib --pool=forks`
Expected: PASS.

---

### Task 5: Web — detalhe da cobrança

**Files:**
- Modify: `packages/web/src/components/screens/charge-detail-screen.tsx:86,270-278,409`
- Modify: `packages/web/src/components/screens/charge-detail-screen.test.tsx`

**Interfaces:**
- Consumes: `ChargeDetail.payment`, `paymentLink`, `receiptUrl`; BFF `POST /api/financial/charges/{id}/payment-link`.

- [ ] **Step 1: Teste**

Fixture: `pix: { keyType, key, label }` → `payment: { provider: "pix", kind: PixKeyType.Email, value: "pix@example.com", label: "Principal" }, paymentLink: null, receiptUrl: null`; `pix: null` → `payment: null, paymentLink: null, receiptUrl: null`. Adicionar:

```tsx
it("copies the InfinitePay link for the payer", async () => {
  const user = userEvent.setup();
  const write = vi.fn().mockResolvedValue(undefined);

  Object.assign(navigator, { clipboard: { writeText: write } });
  serve(charge({ direction: Direction.Payable, payment: { provider: "infinitepay", kind: null, value: "loja", label: "InfinitePay" }, paymentLink: { url: "https://checkout/abc", state: "ready" } }));
  render(<ChargeDetailScreen id="charge-1" />);

  await user.click(await screen.findByRole("button", { name: "Copiar link de pagamento" }));

  expect(write).toHaveBeenCalledWith("https://checkout/abc");
  expect(await screen.findByRole("status")).toHaveTextContent("Link copiado.");
});

it("asks for a new link when the last one failed", async () => {
  const user = userEvent.setup();
  const calls = serve(charge({ direction: Direction.Receivable, ownedByViewer: true, payment: { provider: "infinitepay", kind: null, value: "loja", label: "InfinitePay" }, paymentLink: { url: null, state: "failed" } }));

  render(<ChargeDetailScreen id="charge-1" />);
  await user.click(await screen.findByRole("button", { name: "Gerar link de novo" }));

  await waitFor(() => expect(calls.some(([path, init]) => String(path).endsWith("/charges/charge-1/payment-link") && init?.method === "POST")).toBe(true));
});
```

(`serve` devolve/registra as chamadas de `browserFetch` no padrão do teste existente.)

- [ ] **Step 2: Tela**

- Linha 86: `charge.payment || charge.ownedByViewer ? null : "O meio de pagamento ainda não está disponível. Combine o pagamento com o credor."`.
- `copyPix(key)` → `copyValue(value: string, done: string)` que faz `setNotice(done)`; erro `"Não foi possível copiar."`.
- Nova função:

```tsx
  async function regenerateLink() {
    setBusy(true);
    setError("");

    try {
      const response = await browserFetch(`/api/financial/charges/${id}/payment-link`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível gerar o link."));
      }

      setDetail((await response.json()) as ChargeDetail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível gerar o link.");
    } finally {
      setBusy(false);
    }
  }
```

  (`setDetail` é o setter do estado que a tela já usa para o `ChargeDetail`; usar o nome real.)
- Linha 409 vira:

```tsx
                {!receivable && charge.payment?.provider === "pix" && <ActionTile label="Copiar Chave Pix" icon={Copy} hint="Copia a chave Pix do credor" disabled={busy} onClick={() => void copyValue(charge.payment!.value, "Chave Pix copiada.")} />}
                {charge.payment?.provider === "infinitepay" && charge.paymentLink?.state === "ready" && (
                  <ActionTile label="Copiar link de pagamento" icon={Link2} hint="Copia o link da InfinitePay" disabled={busy} onClick={() => void copyValue(charge.paymentLink!.url!, "Link copiado.")} />
                )}
                {charge.payment?.provider === "infinitepay" && charge.paymentLink?.state === "failed" && (
                  <ActionTile label="Gerar link de novo" icon={RefreshCw} hint="Pede um novo link à InfinitePay" disabled={busy} onClick={() => void regenerateLink()} />
                )}
                {charge.payment?.provider === "infinitepay" && charge.paymentLink?.state === "pending" && <ActionTile label="Gerando link" icon={Loader2} hint="O link da InfinitePay está sendo criado" disabled />}
```

  (`Link2`, `RefreshCw`, `Loader2` do lucide; adicionar ao import.)
- Abaixo do bloco de valor, quando `charge.state === "paid" && charge.receiptUrl`:

```tsx
          {charge.state === "paid" && charge.receiptUrl && (
            <a href={charge.receiptUrl} target="_blank" rel="noopener noreferrer" className="self-center text-sm font-semibold text-primary">
              Comprovante InfinitePay
            </a>
          )}
```

- Linha 551 (texto do lembrete): "com o link de pagamento e a chave Pix" → "com o link de pagamento".

- [ ] **Step 3: Rodar**

Run: `pnpm --filter @receivy/web exec vitest run src/components/screens/charge-detail-screen.test.tsx --pool=forks`
Expected: PASS.

---

### Task 6: Web — página pública e checkout de mentira

**Files:**
- Modify: `packages/web/src/app/pay/[token]/page.tsx`
- Create: `packages/web/src/app/dev/infinitepay/[orderNsu]/page.tsx`

- [ ] **Step 1: Página pública**

Assinatura: `PublicChargePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> })`. Depois de ler `token`:

```tsx
  const query = await searchParams;
  const returned = query.order_nsu && query.transaction_nsu && query.slug ? { orderNsu: query.order_nsu, transactionNsu: query.transaction_nsu, slug: query.slug, receiptUrl: query.receipt_url } : null;

  try {
    // Back from InfinitePay: the ids in the url close the charge (after payment_check) before the page renders.
    const response = returned
      ? await authApiFetch(`public/charges/${encodeURIComponent(token)}/provider-return`, { method: "POST", body: JSON.stringify(returned) })
      : await authApiFetch(`public/charges/${encodeURIComponent(token)}`, { method: "GET" });

    if (response.ok) {
      charge = await response.json();
    } else if (returned) {
      // A refused return (wrong ids, provider down) still shows the charge as it is.
      const fallback = await authApiFetch(`public/charges/${encodeURIComponent(token)}`, { method: "GET" });

      charge = fallback.ok ? await fallback.json() : null;
    }
  } catch {
    // ...
  }
```

Confirmar em `lib/auth/api.ts` que `authApiFetch` manda `content-type: application/json` num POST com body; se não, passar `headers`.

Substituir `const pix = ...` e o bloco `{pix && (...)}` por:

```tsx
  const payment = charge.state === "pending" ? charge.payment : null;
  const pix = payment?.provider === "pix" ? payment : null;
  const link = payment?.provider === "infinitepay" ? charge.paymentLink : null;
  const numbered = Boolean(pix || link);
```

```tsx
          {pix && ( /* bloco atual, com pix.value no lugar de pix.key */ )}

          {link && link.state === "ready" && link.url && (
            <section className="flex flex-col gap-2.5">
              <h2 className={SECTION_LABEL}>1 · PAGUE PELO LINK</h2>
              <div className="flex flex-col gap-3 rounded-2xl border border-outline/60 bg-surface-muted/50 p-4">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-bold text-on-primary transition hover:bg-primary-strong"
                >
                  Pagar
                </a>
                <p className="m-0 text-[12.5px] leading-normal text-muted">Pix ou cartão em até 12x, pela InfinitePay. A confirmação chega sozinha depois do pagamento.</p>
              </div>
            </section>
          )}

          {link && link.state !== "ready" && (
            <p className="m-0 rounded-2xl border border-outline/60 bg-surface-muted/50 p-3.5 text-[12.5px] leading-normal text-muted" role="status">
              Estamos gerando o link de pagamento. Tente de novo em instantes, ou envie o comprovante abaixo.
            </p>
          )}

          {charge.state === "paid" && (
            <section className="flex flex-col gap-2 rounded-2xl border border-success/40 bg-success-soft p-4">
              <h2 className="m-0 text-sm font-bold text-success">Pagamento confirmado</h2>
              {charge.receiptUrl && (
                <a href={charge.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold text-primary">
                  Ver comprovante da InfinitePay
                </a>
              )}
            </section>
          )}
```

Seção do comprovante: quando `link?.state === "ready"`, envolver em `<details className="flex flex-col gap-2.5"><summary className="cursor-pointer text-[12.5px] font-semibold text-muted">Pagou de outro jeito? Envie o comprovante</summary>...</details>` com o mesmo `<ProofPanel>`; senão, a seção como hoje com `{numbered ? "2 · ENVIE O COMPROVANTE" : "ENVIE O COMPROVANTE"}`. Quando `charge.state === "paid"`, a seção de comprovante some (`ProofPanel` já trata `state`, mas com "Pagamento confirmado" acima ela vira ruído: não renderizar).

`NoAccountNote`: "{creditor} confirma o pagamento depois de revisar o comprovante." → quando `link`, "O pagamento pelo link é confirmado automaticamente." (passar uma prop `automatic={Boolean(link)}`).

- [ ] **Step 2: Checkout de mentira**

`app/dev/infinitepay/[orderNsu]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** Where the fake link provider sends people locally: one button that "pays" and returns like InfinitePay would. */
export default async function FakeInfinitePayPage({ params, searchParams }: { params: Promise<{ orderNsu: string }>; searchParams: Promise<{ redirect?: string }> }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { orderNsu } = await params;
  const { redirect } = await searchParams;
  const back = redirect ? new URL(redirect) : null;

  if (back) {
    back.searchParams.set("order_nsu", orderNsu);
    back.searchParams.set("transaction_nsu", `fake-${Date.now()}`);
    back.searchParams.set("slug", `fake-${orderNsu.slice(0, 8)}`);
    back.searchParams.set("receipt_url", "https://example.invalid/recibo");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="m-0 text-xl font-bold text-ink">Checkout de mentira</h1>
      <p className="m-0 text-sm text-muted">Pedido {orderNsu}. Nada é cobrado: o botão volta para a cobrança como a InfinitePay voltaria.</p>
      {back ? (
        <a href={back.toString()} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 font-bold text-on-primary">
          Simular pagamento
        </a>
      ) : (
        <p className="m-0 text-sm text-danger">Sem redirect: abra este link a partir da cobrança.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verificar o web inteiro**

Run: `pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test`
Expected: OK. Conferir manualmente com `pnpm --filter @receivy/web dev` em `http://localhost:3000` (memória `next-dev-headless-localhost`): cadastrar `$qualquer` (transporte `fake`), criar conta a receber, abrir o link público, "Pagar" → "Simular pagamento" → página volta "Pagamento confirmado".

---

### Task 7: Mobile — cliente, ícone, tela "Meios de pagamento" e rotas

**Files:**
- Modify: `packages/mobile/src/financial/client.ts:61`
- Create: `packages/mobile/assets/images/auth/infinity.svg`
- Rename + Modify: `packages/mobile/src/components/screens/pix-settings-screen.tsx` → `payment-methods-screen.tsx` (+ test)
- Rename: `packages/mobile/src/app/(protected)/settings/pix.tsx` → `settings/payment-methods.tsx`
- Modify: `packages/mobile/src/app/(protected)/_layout.tsx:34-35`, `app/(protected)/(tabs)/settings.tsx:10`, `components/screens/profile-screen.tsx:340-343`

- [ ] **Step 1: Cliente e ícone**

`client.ts`, depois de `pay`: `ensurePaymentLink(id: string) { return request<ChargeDetail>(\`charges/${id}/payment-link\`, { method: "POST" }, "Não foi possível gerar o link."); },`.

`infinity.svg` (mesmo estilo dos outros: 24x24, stroke currentColor):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/></svg>
```

- [ ] **Step 2: Teste da tela**

`git mv` tela e teste. No teste: `method()` helper com `{ provider: "pix", kind: PixKeyType.Email, value: "ana@example.com", label, isDefault, archivedAt, contactId: null, createdAt }`; textos: `"Excluir chave Pix?"` → `"Excluir meio de pagamento?"`, `"Nenhuma chave ainda"` → `"Nenhum meio de pagamento"`, `"Carregando chaves Pix"` → `"Carregando meios de pagamento"`, `"Cadastrar nova chave"` → `"Cadastrar novo meio"`, `"Copiar chave"` → `"Copiar valor"`. Novo:

```tsx
it("lists an InfinitePay method with its tag", async () => {
  const api = client([method(), method({ id: "ip-1", provider: "infinitepay", kind: null, value: "minha.loja", label: "Loja", isDefault: false })]);

  render(<PaymentMethodsScreen client={api} />);

  expect(await screen.findByText("InfinitePay")).toBeTruthy();
  expect(screen.getByText("$minha.loja")).toBeTruthy();
});
```

- [ ] **Step 3: Tela**

`payment-methods-screen.tsx`: `PaymentMethodsScreen`, `PaymentMethodsClient`, `onNewMethod`; remover `LABELS` e usar `paymentMethodText`; `ICONS` vira:

```tsx
const ICONS: Record<PixKeyType, number> = { cpf: ..., cnpj: ..., phone: ..., email: mailMark, random: keyMark };
const infinityMark = require("../../../assets/images/auth/infinity.svg");

function iconOf(method: PaymentMethod): number {
  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return infinityMark;
  }

  return ICONS[method.kind];
}
```

Textos como no web (Task 2 Step 4). `CopyButton value={method.provider === PaymentProvider.InfinitePay ? \`$${method.value}\` : method.value} accessibilityLabel="Copiar valor"`. Docstring: "The payment method agenda ... Registering happens on `/settings/payment-methods/new`."

- [ ] **Step 4: Rotas**

`settings/payment-methods.tsx`: igual ao antigo com `PaymentMethodsScreen`, `onNewMethod`, `pathname: "/settings/payment-methods/new"`. `_layout.tsx`: `name="settings/payment-methods" options={{ title: "Meios de pagamento" }}` e `name="settings/payment-methods/new" options={{ title: "Novo meio de pagamento" }}`. `(tabs)/settings.tsx`: `onOpenPix={() => router.push("/settings/payment-methods")}` (renomear a prop para `onOpenPaymentMethods` em `profile-screen.tsx` e no teste). `profile-screen.tsx:340-343`: `label="Gerenciar meios de pagamento"`, `title="Meios de pagamento"`, subtítulo "Pix e InfinitePay para receber". Regenerar `router.d.ts` (Global Constraints).

- [ ] **Step 5: Rodar**

Run: `pnpm --filter @receivy/mobile test -- payment-methods-screen profile-screen`
Expected: PASS.

---

### Task 8: Mobile — formulário com chips e `first-share-pix`

**Files:**
- Rename + Modify: `packages/mobile/src/components/forms/pix-key-form-screen.tsx` → `payment-method-form-screen.tsx` (+ test)
- Rename + Modify: `packages/mobile/src/app/(protected)/settings/pix/new.tsx` → `settings/payment-methods/new.tsx`
- Modify: `packages/mobile/src/app/(protected)/billings/new.tsx:16`, `packages/mobile/src/components/app/first-share-pix.tsx`

- [ ] **Step 1: Teste**

Renomear; `savePaymentMethod` esperado com `{ provider: "pix", kind: "email", value: ... }`; botão `"Salvar meio de pagamento"`. Novo:

```tsx
it("saves an InfiniteTag", async () => {
  const api = client([]);

  render(<PaymentMethodFormScreen client={api} profile={profile} />);
  await fireEvent.press(screen.getByRole("radio", { name: "InfinitePay" }));
  await fireEvent.changeText(screen.getByLabelText("InfiniteTag"), "$Minha.Loja");
  await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

  await waitFor(() => expect(api.savePaymentMethod).toHaveBeenCalledWith({ provider: "infinitepay", value: "$Minha.Loja" }));
});

it("shows the InfinitePay switch when the checkout is off", async () => {
  const api = client([]);

  api.savePaymentMethod.mockRejectedValue(new FinancialRequestError("Ative o checkout externo no app da InfinitePay e tente de novo.", 422));
  render(<PaymentMethodFormScreen client={api} profile={profile} />);
  await fireEvent.press(screen.getByRole("radio", { name: "InfinitePay" }));
  await fireEvent.changeText(screen.getByLabelText("InfiniteTag"), "loja");
  await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Ative o checkout externo");
});
```

O `redirectUrl` não passa pelo `FinancialRequestError` (só mensagem e status): no mobile o erro mostra a mensagem e um botão fixo "Abrir InfinitePay" que faz `Linking.openURL("https://app.infinitepay.io/external-checkout")` quando `status === 422`. (Estender o client para carregar `context.fields` seria escopo novo; a URL do switch é estável.)

- [ ] **Step 2: Formulário**

Como no web (Task 3 Step 3), em RN: estado `provider`/`handle`; chips:

```tsx
        <View className="gap-2">
          <Text className="text-xs font-semibold text-muted">Tipo de meio</Text>
          <View accessibilityRole="radiogroup" className="flex-row gap-2">
            {[
              { value: PaymentProvider.Pix, label: "Pix" },
              { value: PaymentProvider.InfinitePay, label: "InfinitePay" },
            ].map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: provider === option.value }}
                onPress={() => {
                  setProvider(option.value);
                  setError("");
                }}
                className={`min-h-11 flex-1 items-center justify-center rounded-xl border px-3 ${provider === option.value ? "border-primary bg-primary-soft/40" : "border-outline/40 bg-surface"}`}
              >
                <Text className={`text-sm font-semibold ${provider === option.value ? "text-primary-strong" : "text-ink"}`}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {provider === PaymentProvider.Pix ? (
          <PixKeyFields type={type} value={value} onPickType={pick} onChangeKey={change} onClear={clear} />
        ) : (
          <View className="gap-1">
            <Text className="text-xs font-semibold text-muted">InfiniteTag</Text>
            <View className="h-12 flex-row items-center rounded-xl border border-outline/50 bg-surface px-3">
              <Text className="pr-1 text-sm font-bold text-muted">$</Text>
              <TextInput
                accessibilityLabel="InfiniteTag"
                value={handle}
                onChangeText={(next) => {
                  setError("");
                  setHandle(next);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={41}
                className="h-full flex-1 py-0 text-[16px] text-ink"
              />
            </View>
            <Text className="text-xs leading-5 text-muted">É o nome de usuário do app InfinitePay. O checkout externo precisa estar ativo lá; a cobrança aceita Pix ou cartão em até 12x.</Text>
          </View>
        )}
```

`save()`: InfinitePay → `if (!handle.trim()) { setError("Informe a InfiniteTag."); return; }` e `input = { provider: PaymentProvider.InfinitePay, value: handle }`; Pix → `{ provider: PaymentProvider.Pix, kind: type, value: pixKey }`. No `catch`, guardar `status` (`reason instanceof FinancialRequestError ? reason.status : 0`) em estado `errorStatus`; renderizar abaixo do alerta, quando `errorStatus === 422 && provider === InfinitePay`, um `Pressable` "Abrir InfinitePay" → `Linking.openURL("https://app.infinitepay.io/external-checkout")`. Botão: `accessibilityLabel="Salvar meio de pagamento"`, texto igual. Toggle: "Definir como meio principal". Aviso `required`: "Você precisa de um meio de pagamento para criar cobranças."

- [ ] **Step 3: Rotas e gate**

`settings/payment-methods/new.tsx` = antigo com `PaymentMethodFormScreen`. `billings/new.tsx:16`: `pathname: "/settings/payment-methods/new"`. Regenerar `router.d.ts`.

- [ ] **Step 4: `first-share-pix.tsx`**

`client.savePaymentMethod({ provider: PaymentProvider.Pix, kind: type, value: key })`; a linha de item: `{paymentMethodText(item).title} · {paymentMethodText(item).value}`; textos "Meio de pagamento antes de compartilhar" / "Publicar com este meio".

- [ ] **Step 5: Rodar**

Run: `pnpm --filter @receivy/mobile test -- payment-method-form-screen`
Expected: PASS.

---

### Task 9: Mobile — formulário de conta e detalhe da cobrança

**Files:**
- Modify: `packages/mobile/src/components/forms/billing-form-screen.tsx:67-73,98-100,143-150,882,962,1362-1408`
- Modify: `packages/mobile/src/components/screens/charge-detail-screen.tsx:44-45,94-98,277-294,469-476` (+ test)
- Modify: `packages/mobile/src/components/forms/billing-form-screen.test.tsx`, `contact-form-screen.test.tsx`, `billing-detail-screen.test.tsx`, `financial/draft-store.test.ts` (fixtures)

- [ ] **Step 1: Formulário de conta**

- `PIX_ICONS: Record<PixKeyType, number>` (tipo vem de `@receivy/common`; `PaymentMethod["pixKeyType"]` não existe mais) + `const infinityMark = require("../../../assets/images/auth/infinity.svg");` + `function iconOf(method: PaymentMethod)` igual à Task 7.
- Remover `PIX_TYPE_LABELS` local; usar `paymentMethodText`.
- 1362: `<Image source={selectedPix ? iconOf(selectedPix) : keyMark} .../>`; 1366: `${paymentMethodText(selectedPix).title}: ${abbreviate(paymentMethodText(selectedPix).value)}` / `"Selecionar meio de pagamento"`; 1369: "Meio padrão" / "Meio secundário" / "Nenhum meio cadastrado"; 1394-1408: `accessibilityLabel={\`${text.title} · ${abbreviate(text.value)}\`}`, ícone `iconOf(method)`, título `text.title`, valor `text.value`.
- `PIX_GATE_TITLE`/`PIX_GATE_NOTE`/`"Cadastrar chave Pix"` (962) como no web. `pixTitle = payable ? "Pagar via Pix" : "Receber por"`.

- [ ] **Step 2: Teste do detalhe**

Fixture: `pix: {...}` → `payment: { provider: "pix", kind: PixKeyType.Email, value: "pix@example.com", label: "Principal" }, paymentLink: null, receiptUrl: null`. Novos:

```tsx
it("copies the InfinitePay link for the payer", async () => {
  const api = client({ charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Payable, payment: { provider: "infinitepay", kind: null, value: "loja", label: "InfinitePay" }, paymentLink: { url: "https://checkout/abc", state: "ready" } })) });

  render(<ChargeDetailScreen id="charge-1" client={api} />);
  await fireEvent.press(await screen.findByLabelText("Copiar link de pagamento"));

  expect(Clipboard.setStringAsync).toHaveBeenCalledWith("https://checkout/abc");
});

it("asks for a new link when the last one failed", async () => {
  const ensure = jest.fn().mockResolvedValue(charge({ paymentLink: { url: "https://checkout/new", state: "ready" } }));
  const api = client({ charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, ownedByViewer: true, payment: { provider: "infinitepay", kind: null, value: "loja", label: "InfinitePay" }, paymentLink: { url: null, state: "failed" } })), ensurePaymentLink: ensure });

  render(<ChargeDetailScreen id="charge-1" client={api} />);
  await fireEvent.press(await screen.findByLabelText("Gerar link de novo"));

  await waitFor(() => expect(ensure).toHaveBeenCalledWith("charge-1"));
});
```

(`client`/`charge` são os helpers do teste existente; o mock de `expo-clipboard` já existe nele.)

- [ ] **Step 3: Detalhe**

- `Client`: adicionar `"ensurePaymentLink"` ao `Partial<Pick<...>>` da linha 45.
- 94-98: `charge.payment || charge.ownedByViewer` e a mensagem "O meio de pagamento ainda não está disponível. Combine o pagamento com o credor."
- `copyPix(key)` → `copyValue(value: string, done: string)` (mesmo corpo, `setNotice(done)`, erro "Não foi possível copiar.").
- Novo `regenerateLink()`: `setBusy(true)`; `try { setCharge(await client.ensurePaymentLink!(id)); } catch (reason) { setError(...) } finally { setBusy(false); }` (usar o setter real do estado da tela).
- 469-476 vira:

```tsx
              {!receivable && charge.payment?.provider === PaymentProvider.Pix && (
                <ActionTile label="Copiar Chave Pix" icon={ICONS.copy} hint={ownBill ? "Copia a chave Pix da conta" : "Copia a chave Pix do credor"} disabled={busy} onPress={() => void copyValue(charge.payment!.value, "Chave Pix copiada.")} />
              )}
              {charge.payment?.provider === PaymentProvider.InfinitePay && charge.paymentLink?.state === PaymentLinkState.Ready && (
                <ActionTile label="Copiar link de pagamento" icon={ICONS.share} hint="Copia o link da InfinitePay" disabled={busy} onPress={() => void copyValue(charge.paymentLink!.url!, "Link copiado.")} />
              )}
              {charge.payment?.provider === PaymentProvider.InfinitePay && charge.paymentLink?.state === PaymentLinkState.Failed && client.ensurePaymentLink && (
                <ActionTile label="Gerar link de novo" icon={ICONS.edit} hint="Pede um novo link à InfinitePay" disabled={busy} onPress={() => void regenerateLink()} />
              )}
```

  (`ICONS` é o mapa de SVGs que a tela já tem; `share`/`edit` existem em `assets/images/auth`.)
- Comprovante InfinitePay quando pago: `{charge.state === ChargeState.Paid && charge.receiptUrl ? <Pressable accessibilityRole="link" accessibilityLabel="Comprovante InfinitePay" onPress={() => void Linking.openURL(charge.receiptUrl!)} className="self-center"><Text className="text-sm font-semibold text-primary">Comprovante InfinitePay</Text></Pressable> : null}` abaixo do bloco de valor. Import `Linking` de `react-native`.
- 261: "com o link de pagamento e a chave Pix" → "com o link de pagamento".

- [ ] **Step 4: Fixtures dos outros testes**

`billing-form-screen.test.tsx`, `contact-form-screen.test.tsx`, `billing-detail-screen.test.tsx`, `draft-store.test.ts`: `pixKeyType/pixKey` → `provider: "pix", kind, value`; textos do picker ("Selecionar chave Pix" → "Selecionar meio de pagamento", "Chave padrão" → "Meio padrão").

- [ ] **Step 5: Verificar o mobile inteiro**

Run: `pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test`
Expected: OK.

---

### Task 10: Fechamento

**Files:**
- Modify: `docs/manual-qa-script.md`

- [ ] **Step 1: Roteiro de QA**

Adicionar a seção "Meios de pagamento / InfinitePay": (1) stage local (`PAYMENT_METHOD_LINK=fake`): cadastrar `$qualquer`, criar conta a receber com esse meio, abrir o detalhe (tile "Copiar link de pagamento"), abrir o link público como pagador → "Pagar" → "Simular pagamento" → "Pagamento confirmado" + push ao dono; (2) um handle real só pode ser exercitado com `PAYMENT_METHOD_LINK=live`: cadastrar handle sem checkout externo → 422 com botão de configuração; ativar, cadastrar de novo, criar cobrança de R$ 1,00, pagar de verdade pelo link, conferir webhook (`charge.paid { via: 'provider' }` nos eventos) e recibo; (3) cancelar uma cobrança InfinitePay e pagar pelo link antigo → cobrança segue cancelada, evento `charge.provider.ignored`, push ao dono.

- [ ] **Step 2: Verificação final dos três pacotes**

Run: `pnpm --filter @receivy/common lint && pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web test && pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile test`
Expected: tudo OK. Smoke Maestro (`packages/mobile/e2e/smoke`) se os fluxos tocarem a tela de chaves: atualizar seletores de "Chaves Pix" para "Meios de pagamento".

---

## Auto-revisão (feita ao escrever)

- **Spec §4**: configurações (Tasks 2, 3, 7, 8), erro 422 com link (3, 8), draft round-trip inalterado (rotas trocadas em 3, 8), seletor da conta (4, 9), detalhe do dono (5, 9), página pública com retorno (6), e-mail é da API. Rótulos de timeline: descartados (não existem nos clientes).
- **Nomes**: `PaymentMethodsScreen`, `PaymentMethodFormScreen`, `ProviderIcon`/`iconOf`, `paymentMethodText`, `ensurePaymentLink` (client mobile) e `POST /api/financial/charges/{id}/payment-link` (web) batem com as rotas do plano da API.
- **Fora**: `SharingState` rename, rótulos de evento, i18n.
