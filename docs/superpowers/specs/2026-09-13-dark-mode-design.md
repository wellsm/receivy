# Dark mode

Decisões de 2026-09-13. Web (Next 16 + Tailwind v4) e mobile (Expo + Uniwind) só têm tema claro: os tokens
de `@theme` (`canvas`, `surface`, `primary`, `ink`, `muted`, `outline`…) têm um valor só, e há ~190 classes de
paleta fixa no web, ~200 no mobile (`text-white`, `bg-red-50`, `text-amber-900`…) e 50 hex em props no mobile
(tints, header, abas, spinner, placeholder). Prévia aprovada da paleta:
https://claude.ai/code/artifact/ce4d5ed1-287a-457d-8ab6-1288aff1c339

## Escopo

- Tema segue o sistema por padrão; no Perfil dá para fixar **Sistema / Claro / Escuro**.
- A preferência fica no aparelho: `localStorage` no web, `expo-secure-store` no mobile (já instalado).
- Tokens semânticos trocam de valor por tema; componentes usam token, nunca cor fixa.
- Fora do escopo: preferência sincronizada por conta no servidor, dark mode nos e-mails, tema por tela.

## Paleta

Tokens da marca (mesmo nome, dois valores):

| Token | Claro | Escuro |
|---|---|---|
| canvas | `#FAF8FF` | `#0D1320` |
| surface | `#FFFFFF` | `#151C2B` |
| surface-muted | `#F2F3FF` | `#1C2536` |
| primary | `#0B513D` | `#5BD3A2` |
| primary-strong | `#003828` | `#A6EFCF` |
| primary-soft | `#B0F0D6` | `#133B2E` |
| accent | `#4EDEA3` | `#4EDEA3` |
| ink | `#131B2E` | `#E5E9F2` |
| muted | `#566070` | `#98A2B3` |
| outline | `#BFC9C3` | `#2C374A` |

Tokens novos:

| Token | Claro | Escuro | Substitui |
|---|---|---|---|
| on-primary | `#FFFFFF` | `#052B1E` | `text-white` sobre primário |
| danger | `#B91C1C` | `#F4A6A3` | `text-red-700` |
| danger-soft | `#FEF2F2` | `#3B1A1D` | `bg-red-50`, `red-100` |
| danger-solid | `#DC2626` | `#C23B3B` | `bg-red-600` (texto branco nos dois temas) |
| warning | `#78350F` | `#F2C274` | `text-amber-700/800/900` |
| warning-soft | `#FFFBEB` | `#33260E` | `bg-amber-50/100` |
| info | `#1E40AF` | `#9FBEF7` | `text-blue-800/900` |
| info-soft | `#EFF6FF` | `#16233F` | `bg-blue-50` |
| success | `#065F46` | `#86D9B1` | `text-emerald-800`, verde `#006C49` |
| success-soft | `#ECFDF5` | `#10332A` | `bg-emerald-50` |
| scrim | `rgba(0,0,0,.4)` | `rgba(0,0,0,.6)` | `bg-black/40`, `/60` |

- Bordas `*-200` viram o token com opacidade (`border-danger/30`, `border-warning/30`…).
- `bg-white` vira `bg-surface`; `text-white` fora de fundo primário usa o token do fundo onde está
  (`on-primary` sobre primário; branco literal só sobre `danger-solid`).
- Exceção: `web/src/components/app/brand-marks.tsx` mantém as cores oficiais do Google.
- Contraste conferido (WCAG 2.1): os 12 pares principais passam AA (≥ 4,5:1) nos dois temas; o mais
  apertado é branco sobre `danger-solid` (4,83:1 claro, 5,27:1 escuro).

## Domínio (`@receivy/common`)

- `design/theme.ts`:
  - `export const enum ThemePreference { System = 'system', Light = 'light', Dark = 'dark' }`.
  - `export const enum ResolvedTheme { Light = 'light', Dark = 'dark' }`.
  - `THEME_PREFERENCE_OPTIONS`: `[{ value, label }]` com `Sistema`, `Claro`, `Escuro`, nessa ordem.
  - `resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme`.
  - `parseThemePreference(raw: string | null | undefined): ThemePreference` — valor desconhecido ou ausente → `System`.
- `design/tokens.ts`: `designTokens.color` ganha os tokens novos (valores claros) e `designTokens.colorDark`
  com a paleta escura completa (mesmas chaves).

## Web

### Tokens (`src/app/globals.css`)

- `@theme` ganha os tokens novos com o valor claro.
- `:root[data-theme="dark"]` redefine todas as variáveis `--color-*` com o valor escuro e `color-scheme: dark`.
- `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` repete os valores escuros para o
  instante antes do script e para navegador sem JS.
- `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));` para ajustes raros.
- `globals.css` continua só com `@import`, `@theme`, variáveis de tema e resets de elemento.

### Sem flash (`src/app/layout.tsx`)

- `<html lang="pt-BR" suppressHydrationWarning>`.
- `<script>` inline no `<head>` (primeiro filho): lê `localStorage['receivy-theme']`, resolve com
  `matchMedia('(prefers-color-scheme: dark)')`, grava `document.documentElement.dataset.theme` e
  `style.colorScheme`. Envolvido em `try/catch` (storage bloqueado cai no sistema).
- `export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FAF8FF' },
  { media: '(prefers-color-scheme: dark)', color: '#0D1320' }] }` (Next 16 gera as duas `<meta name="theme-color">`).

### Preferência (`src/lib/theme.ts`)

- `THEME_STORAGE_KEY = 'receivy-theme'`.
- `readThemePreference(): ThemePreference`, `saveThemePreference(preference)`, `applyTheme(preference)`.
- `useThemePreference(): [ThemePreference, (preference: ThemePreference) => void]`: aplica e salva; com
  `System`, escuta `matchMedia` e reaplica quando o sistema muda; remove o listener ao sair.

### Perfil

- `components/screens/profile-screen.tsx`: nova seção **Aparência** (`h2` no padrão `SECTION_TITLE`) com
  `role="radiogroup"` e três botões `role="radio"` (pílulas no mesmo estilo dos filtros de Contas).

### Varredura

- Todo `src/components/**` e `src/app/**` troca classe de paleta fixa e hex por token (tabela acima).
- Teste de guarda `src/theme-tokens.test.ts`: varre `src/**/*.tsx` (exceto testes e `brand-marks.tsx`) e falha
  com `\b(bg|text|border|ring|fill|stroke|divide|placeholder|from|to|via)-(white|black|red|amber|blue|green|emerald|gray|slate|zinc|neutral|yellow|orange|sky|rose)(-\d{2,3})?\b`
  ou hex `#[0-9a-fA-F]{3,8}` em `className`.

## Mobile

### Tokens (`src/global.css`)

- O `@theme` vira `@layer theme { :root { @variant light { … } @variant dark { … } } }` com todos os
  tokens (marca + novos), mesmos nomes do web. As duas variantes definem o mesmo conjunto de variáveis.

### Preferência (`src/theme/preference.ts`)

- `THEME_STORAGE_KEY = 'receivy.theme'`.
- `readThemePreference(): ThemePreference` com `SecureStore.getItem` (síncrono) + `parseThemePreference`.
- `applyThemePreference(preference)`: `Uniwind.setTheme(preference)` e
  `Appearance.setColorScheme(preference === System ? null : preference)` (alertas, date picker e teclado
  seguem o tema do app).
- `saveThemePreference(preference)`: `SecureStore.setItem` + `applyThemePreference`.
- `useThemePreference()`: estado inicial de `readThemePreference()`, setter salva e aplica.
- `src/app/_layout.tsx`: `applyThemePreference(readThemePreference())` no escopo do módulo, antes do primeiro render.

### Cores fora de `className` (`src/theme/colors.ts`)

- `useThemeColors()`: `useCSSVariable` do Uniwind para `canvas`, `surface`, `primary`, `primary-strong`,
  `on-primary`, `ink`, `muted`, `outline`, `danger`, `warning`, `info`, `success`; re-renderiza na troca de tema.
- `ACTIVE_TINT` e `MUTED_TINT` saem; cada uso passa a `useThemeColors()`.
- `src/navigation/header.ts`: `HEADER` vira `useHeaderOptions()` (fundo `canvas`, tint e título `primary-strong`).
- `src/app/(protected)/(tabs)/_layout.tsx`: `NativeTabs` (`tintColor`/`iconColor`) e `Tabs`
  (`tabBarActiveTintColor`, `tabBarInactiveTintColor`, `tabBarStyle` com `surface`/`outline`) via hook.
- `StatusBar`: `style` `light` no tema resolvido escuro, `dark` no claro.
- Os 50 hex em props (tints de `expo-image`, `ActivityIndicator`, `placeholderTextColor`, `trackColor`,
  `accentColor`, sombras) passam a vir de `useThemeColors()`.

### Perfil

- `components/screens/profile-screen.tsx`: seção **Aparência** com três chips `accessibilityRole="radio"`
  (`accessibilityState={{ checked }}`), mesmo estilo dos chips de Contas.

### `app.json`

- `userInterfaceStyle: "automatic"` (iOS e Android). O splash já tem variante escura (`splash-icon-dark.png`
  sobre `#0B513D`, decisão de marca) e fica como está.
- Exige prebuild/rebuild nativo; fica para o usuário.

### Varredura e testes

- Todo `src/**/*.tsx` troca classe de paleta fixa e hex por token/hook.
- Teste de guarda `src/theme-tokens.test.ts`: mesma regra do web, também para hex em `.tsx` fora de testes.
- Mock do `uniwind` no setup do jest: `useCSSVariable` devolve os valores claros; `Uniwind.setTheme` é `jest.fn()`.

## Testes

- common: `design/theme.test.ts` (`resolveTheme`, `parseThemePreference`, ordem das opções); `tokens.test.ts`
  (claro e escuro com as mesmas chaves).
- web: `lib/theme.test.ts` (lê, salva, aplica no `<html>`, reaplica na mudança do sistema com `System`);
  `profile-screen.test.tsx` (escolher Escuro carimba `data-theme="dark"` e grava `receivy-theme`); guarda.
- mobile: `theme/preference.test.ts` (lê valor inválido como `System`, salva e chama `Uniwind.setTheme` e
  `Appearance.setColorScheme`); `profile-screen.test.tsx` (escolher Escuro chama `setTheme` e grava); guarda.

## Tarefas

1. common: `design/theme.ts` + paleta escura e tokens de status em `design/tokens.ts`.
2. web: tokens em `globals.css`, script e `theme-color` no `layout.tsx`, `lib/theme.ts`.
3. web: seção Aparência no Perfil.
4. web: varredura de componentes + guarda; captura de Feed, Contas, detalhe e Perfil nos dois temas
   (`next dev` em `http://localhost:3000`).
5. mobile: `global.css` com variantes, `theme/preference.ts`, `_layout` raiz, `useThemeColors`, header,
   abas, StatusBar, mock do jest.
6. mobile: seção Aparência no Perfil.
7. mobile: varredura de componentes + guarda.
8. `app.json`, seção no `docs/manual-qa-script.md`, nota em `ai-rules`, verificação final.

## Verificação

- Cada pacote: `check-types`, `lint`, `test`.
- Web: capturas nos dois temas.
- Mobile no aparelho (após rebuild): StatusBar, header, abas (iOS NativeTabs, Android Tabs), alertas, date
  picker, splash, teclado — listados no roteiro de QA.
