# Receivy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a runnable Node 24/pnpm monorepo with shared Receivy contracts and design tokens, an EZ4 health API, a responsive Next BFF shell, an Expo SDK 56 mobile shell, local Postgres, Docker packaging, and CI quality gates.

**Architecture:** This is increment 1 of the approved MVP design. `packages/common` owns platform-neutral TypeScript contracts and tokens; `packages/api` exposes EZ4 resources; `packages/web` is the browser-facing Next BFF; and `packages/mobile` is the Expo Router client. This increment deliberately stops at health connectivity and application shells so auth and financial domain behavior can arrive as independently reviewable increments.

**Tech Stack:** Node.js 24, pnpm 11.5.3, Turborepo 2.9, TypeScript strict mode, EZ4 0.52.0, Postgres 16, Next 16.2 with React 19.2.3, Expo SDK 56 with React Native 0.85, Vitest, Jest/React Native Testing Library, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-receivy-mvp-design.md`

## Global Constraints

- Use exactly four product workspaces: `packages/api`, `packages/common`, `packages/mobile`, and `packages/web`.
- Use Node.js 24 everywhere and pin `packageManager` to `pnpm@11.5.3`.
- Keep a single root `pnpm-lock.yaml`; shared dependency versions belong in the `pnpm-workspace.yaml` catalog.
- Use EZ4 `0.52.0`, `RuntimeType.Node24`, ARM architecture, remote state per environment, and the two documented Rewarlo vendor patches.
- Use Next `16.2.x` with React `19.2.3`, standalone output, and no ignored TypeScript build errors.
- Use Expo SDK 56, React Native `0.85`, Expo Router, Uniwind, and development builds rather than Expo Go for native authentication work.
- Keep `packages/common` independent of Node, Next, React, and React Native.
- Do not share UI components between web and mobile; share only contracts, pure rules, and portable design tokens.
- Brand every user-facing surface as Receivy and adapt the Stitch emerald palette without copying unsupported promises or features.
- Do not add auth, financial tables, OCR, Premium, WhatsApp automation, QR Pix, bank integration, or speculative provider abstractions in this increment.

---

### Task 1: Initialize the repository and workspace contract

**Files:**
- Create: `.gitignore`
- Create: `.node-version`
- Create: `.nvmrc`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `scripts/verify-workspace.mjs`

**Interfaces:**
- Consumes: the fixed workspace names and versions from the design spec.
- Produces: root commands `dev`, `dev:web`, `dev:mobile`, `dev:api`, `lint`, `check-types`, `test`, `build`, and `verify`; a catalog that every package can consume with `catalog:`.

- [ ] **Step 1: Initialize Git and write the workspace verifier first**

Run:

```bash
git init
mkdir -p scripts packages/api packages/common packages/mobile packages/web
```

Create `scripts/verify-workspace.mjs`:

```js
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const workspace = await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");

assert.equal(root.private, true);
assert.equal(root.packageManager, "pnpm@11.5.3");
assert.equal(root.engines.node, "24.x");
assert.match(workspace, /packages:\n\s+- "packages\/\*"/);
for (const name of ["api", "common", "mobile", "web"]) {
  await access(new URL(`../packages/${name}/`, import.meta.url));
}

console.log("workspace contract ok");
```

- [ ] **Step 2: Run the verifier and confirm the expected failure**

Run: `node scripts/verify-workspace.mjs`

Expected: FAIL with `ENOENT` for `package.json`.

- [ ] **Step 3: Add the root manifests and strict shared TypeScript configuration**

Create `package.json`:

```json
{
  "name": "receivy",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": "24.x", "pnpm": "11.5.3" },
  "packageManager": "pnpm@11.5.3",
  "scripts": {
    "dev": "turbo dev --filter=!@receivy/mobile",
    "dev:api": "turbo dev --filter=@receivy/api",
    "dev:web": "turbo dev --filter=@receivy/web",
    "dev:mobile": "turbo dev --filter=@receivy/mobile",
    "lint": "turbo lint",
    "check-types": "turbo check-types",
    "test": "turbo test",
    "build": "turbo build",
    "verify:workspace": "node scripts/verify-workspace.mjs",
    "verify": "pnpm verify:workspace && pnpm lint && pnpm check-types && pnpm test && pnpm build"
  },
  "devDependencies": {
    "turbo": "^2.9.18",
    "typescript": "catalog:"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"

catalog:
  "@types/node": "^24.10.0"
  "@types/react": "^19.2.0"
  "@types/react-dom": "^19.2.0"
  "@vitejs/plugin-react": "^5.2.0"
  "clsx": "^2.1.1"
  "lucide-react": "^0.544.0"
  "react": "19.2.3"
  "react-dom": "19.2.3"
  "tailwind-merge": "^3.3.1"
  "tailwindcss": "^4.1.14"
  "typescript": "~6.0.3"
  "vitest": "^3.2.4"
  "zod": "^4.1.12"

overrides:
  "@ez4/aws-common": "file:./vendor/ez4-aws-common-0.52.0.tgz"
  "@ez4/raw-pg": "file:./vendor/ez4-raw-pg-0.52.0.tgz"

allowBuilds:
  esbuild: true
  sharp: true
```

Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": { "dependsOn": ["^build"], "inputs": ["$TURBO_DEFAULT$", ".env*"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "lint": { "dependsOn": ["^lint"] },
    "check-types": { "dependsOn": ["^check-types"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Create `.node-version` and `.nvmrc`, each containing `24`. Create `.gitignore` with:

```gitignore
node_modules/
.turbo/
dist/
.next/
coverage/
.expo/
android/
ios/
*.local
local.env
local-*.env
dev.env
prd.env
*.log
.DS_Store
```

- [ ] **Step 4: Verify the root contract and product directories**

The verifier already imports `access` and checks each product directory before the success log:

```js
for (const name of ["api", "common", "mobile", "web"]) {
  await access(new URL(`../packages/${name}/package.json`, import.meta.url));
}
```

Run `node scripts/verify-workspace.mjs` and expect `workspace contract ok`. Package manifests are verified by their own focused tests in Tasks 2–5.

- [ ] **Step 5: Commit the repository contract**

```bash
git add .gitignore .node-version .nvmrc package.json pnpm-workspace.yaml turbo.json tsconfig.base.json scripts/verify-workspace.mjs
git commit -m "chore: initialize receivy workspace"
```

---

### Task 2: Add platform-neutral contracts and portable design tokens

**Files:**
- Create: `packages/common/package.json`
- Create: `packages/common/tsconfig.json`
- Create: `packages/common/src/domain/contracts.ts`
- Create: `packages/common/src/domain/money.ts`
- Create: `packages/common/src/domain/money.test.ts`
- Create: `packages/common/src/design/tokens.ts`
- Create: `packages/common/src/index.ts`

**Interfaces:**
- Consumes: BRL-only MVP rules and the emerald Stitch palette.
- Produces: `Money`, `Direction`, `ChargeState`, `ProofState`, `SplitMode`, `RecurrenceFrequency`, `TimelineItem`, `makeMoney`, `formatMoney`, and `designTokens` from `@receivy/common`.

- [ ] **Step 1: Create the package manifest and failing money tests**

Create `packages/common/package.json`:

```json
{
  "name": "@receivy/common",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```

Create `packages/common/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "lib": ["ESNext", "DOM"] },
  "include": ["src/**/*.ts"]
}
```

Create `packages/common/src/domain/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMoney, makeMoney } from "./money";

describe("money", () => {
  it("rejects fractional cents and negative amounts", () => {
    expect(() => makeMoney(10.5)).toThrow("amountCents must be a non-negative integer");
    expect(() => makeMoney(-1)).toThrow("amountCents must be a non-negative integer");
  });

  it("formats BRL without converting through floating point", () => {
    expect(formatMoney(makeMoney(123456), "pt-BR")).toBe("R$ 1.234,56");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm --filter @receivy/common test`

Expected: FAIL because `./money` does not exist.

- [ ] **Step 3: Implement the contracts, money helper, and design tokens**

Create `packages/common/src/domain/contracts.ts` with the exact unions from the MVP spec and minimal summaries used by the shells:

```ts
export type Money = { amountCents: number; currency: "BRL" };
export type Direction = "receivable" | "payable";
export type ChargeState = "pending" | "paid" | "cancelled";
export type ProofState = "pending" | "accepted" | "rejected";
export type SplitMode = "fixed" | "equal" | "percentage";
export type RecurrenceFrequency = "monthly" | "yearly";

export type ChargeSummary = { id: string; description: string; amount: Money; dueDate: string; state: ChargeState };
export type ProofSummary = { id: string; chargeId: string; state: ProofState; createdAt: string };
export type PaymentSummary = { id: string; chargeId: string; amount: Money; paidAt: string };
export type RecurrencePreview = { recurrenceId: string; description: string; amount: Money; occurrenceDate: string };

export type TimelineItem =
  | { kind: "charge"; direction: Direction; charge: ChargeSummary }
  | { kind: "proof"; direction: Direction; proof: ProofSummary }
  | { kind: "payment"; direction: Direction; payment: PaymentSummary }
  | { kind: "recurrence_preview"; direction: "receivable"; preview: RecurrencePreview };

export type HealthResponse = { status: "ok"; service: "receivy-api" };
```

Create `packages/common/src/domain/money.ts`:

```ts
import type { Money } from "./contracts";

export function makeMoney(amountCents: number): Money {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError("amountCents must be a non-negative integer");
  }
  return { amountCents, currency: "BRL" };
}

export function formatMoney(money: Money, locale = "pt-BR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency }).format(money.amountCents / 100);
}
```

Create `packages/common/src/design/tokens.ts`:

```ts
export const designTokens = {
  color: {
    primary: "#0B513D",
    primaryStrong: "#003828",
    primarySoft: "#B0F0D6",
    accent: "#4EDEA3",
    canvas: "#FAF8FF",
    surface: "#FFFFFF",
    surfaceMuted: "#F2F3FF",
    text: "#131B2E",
    textMuted: "#566070",
    border: "#BFC9C3",
    danger: "#BA1A1A"
  },
  radius: { sm: 8, md: 12, lg: 20, pill: 999 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  typography: { family: "Plus Jakarta Sans", numericVariant: "tabular-nums" }
} as const;
```

Create `packages/common/src/index.ts`:

```ts
export * from "./design/tokens";
export * from "./domain/contracts";
export * from "./domain/money";
```

- [ ] **Step 4: Verify the shared package**

Run: `pnpm --filter @receivy/common test && pnpm --filter @receivy/common check-types`

Expected: PASS, with 2 tests passing and no TypeScript errors.

- [ ] **Step 5: Commit the shared foundation**

```bash
git add packages/common
git commit -m "feat(common): add receivy contracts and design tokens"
```

---

### Task 3: Add the EZ4 API skeleton and local Postgres environment

**Files:**
- Create: `vendor/ez4-aws-common-0.52.0.tgz`
- Create: `vendor/ez4-raw-pg-0.52.0.tgz`
- Create: `docs/ez4-vendor-patches.md`
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/ez4.project.js`
- Create: `packages/api/docker-compose.yml`
- Create: `packages/api/local.env.example`
- Create: `packages/api/src/api.ts`
- Create: `packages/api/src/endpoints/health.ts`
- Create: `packages/api/src/endpoints/health.test.ts`
- Create: `packages/api/src/routes/health.ts`

**Interfaces:**
- Consumes: `HealthResponse` from `@receivy/common` and the Rewarlo EZ4 `0.52.0` deployment pattern.
- Produces: `GET /health -> { status: "ok", service: "receivy-api" }`, local Postgres at `127.0.0.1:55434`, and EZ4 stages `dev`/`prd`.

- [ ] **Step 1: Copy the reviewed vendor patches and document why they exist**

Run:

```bash
mkdir -p vendor
cp /Users/well/Projects/rewarlo/vendor/ez4-aws-common-0.52.0.tgz vendor/ez4-aws-common-0.52.0.tgz
cp /Users/well/Projects/rewarlo/vendor/ez4-raw-pg-0.52.0.tgz vendor/ez4-raw-pg-0.52.0.tgz
```

Create `docs/ez4-vendor-patches.md` explaining these exact fixes:

- `@ez4/raw-pg`: exports `ClientConnection` and `ClientContext` as types so esbuild does not require nonexistent runtime exports.
- `@ez4/aws-common`: treats `BucketAlreadyOwnedByYou` as success so remote state works in `sa-east-1`.
- Before every EZ4 upgrade, remove each override temporarily and verify whether upstream already includes the fix.

- [ ] **Step 2: Create the API manifest and failing health test**

Create `packages/api/package.json` with scripts `dev`, `serve:dev`, `serve:prd`, `build`, `lint`, `check-types`, `test`, `test:watch`, `db:up`, `db:down`, `output:dev`, `deploy:dev`, and `deploy:prd`. Depend on `@ez4/common`, `@ez4/gateway`, `@ez4/project`, `@ez4/schema`, and `@receivy/common`; pin every EZ4 package to `0.52.0`. Add `@ez4/aws-gateway`, `@ez4/local-gateway`, `@types/node`, TypeScript, and Vitest as dev dependencies.

Create `packages/api/src/endpoints/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { healthHandler } from "./health";

describe("healthHandler", () => {
  it("returns the stable public health contract", () => {
    expect(healthHandler()).toEqual({ status: 200, body: { status: "ok", service: "receivy-api" } });
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm --filter @receivy/api test`

Expected: FAIL because `./health` does not exist.

- [ ] **Step 4: Implement the EZ4 health endpoint and route**

Create `packages/api/src/endpoints/health.ts`:

```ts
import type { Http } from "@ez4/gateway";
import type { HealthResponse as HealthBody } from "@receivy/common";

declare class HealthResponse implements Http.Response {
  status: 200;
  body: HealthBody;
}

export function healthHandler(): HealthResponse {
  return { status: 200, body: { status: "ok", service: "receivy-api" } };
}
```

Create `packages/api/src/routes/health.ts`:

```ts
import type { Http } from "@ez4/gateway";
import type { healthHandler } from "../endpoints/health";

export type HealthRoutes = [Http.UseRoute<{ name: "health"; path: "GET /health"; handler: typeof healthHandler }>];
```

Create `packages/api/src/api.ts`:

```ts
import type { Http } from "@ez4/gateway";
import type { NamingStyle } from "@ez4/schema";
import type { HealthRoutes } from "./routes/health";

export declare class Api extends Http.Service {
  name: "Receivy API";
  defaults: Http.UseDefaults<{ preferences: { namingStyle: NamingStyle.CamelCase } }>;
  routes: [...HealthRoutes];
  cors: Http.UseCors<{
    allowOrigins: ["http://localhost:3000"];
    allowMethods: ["GET", "POST", "PATCH", "DELETE"];
    allowHeaders: ["content-type", "authorization", "idempotency-key"];
    allowCredentials: true;
  }>;
}
```

- [ ] **Step 5: Add local and AWS-stage configuration**

Create `packages/api/ez4.project.js` following Rewarlo, with `projectName: "receivy"`, `sourceFiles: ["./src/api.ts"]`, remote state path `${APP_STAGE}-deploy`, local gateway port `3735`, local database fallback `receivy` on port `55434`, `RuntimeType.Node24`, `ArchitectureType.Arm`, informational logging, 30-day retention, and stage tags.

Create `packages/api/docker-compose.yml` with `postgres:16-alpine`, database/user/password `receivy`, host port `55434`, a named `receivy_pg_data` volume, and `pg_isready -U receivy -d receivy` healthcheck.

Create `packages/api/local.env.example`:

```dotenv
APP_STAGE=local
APP_DEBUG=true
EZ4_RAW_PG_DB_URL=postgresql://receivy:receivy@127.0.0.1:55434/receivy
```

- [ ] **Step 6: Verify the API types and handler**

Run: `pnpm --filter @receivy/api test && pnpm --filter @receivy/api check-types`

Expected: PASS with the health contract test and no EZ4 declaration errors.

Run: `pnpm --filter @receivy/api exec ez4 output -e local.env.example --local`

Expected: PASS and output containing `GET /health` without contacting AWS.

- [ ] **Step 7: Commit the API foundation**

```bash
git add vendor docs/ez4-vendor-patches.md packages/api
git commit -m "feat(api): add ez4 health service foundation"
```

---

### Task 4: Add the responsive Next BFF shell

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/next.config.mjs`
- Create: `packages/web/postcss.config.mjs`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/vitest.setup.ts`
- Create: `packages/web/src/app/globals.css`
- Create: `packages/web/src/app/layout.tsx`
- Create: `packages/web/src/app/page.tsx`
- Create: `packages/web/src/app/api/health/route.ts`
- Create: `packages/web/src/components/app-shell.tsx`
- Create: `packages/web/src/components/app-shell.test.tsx`

**Interfaces:**
- Consumes: `designTokens` and `HealthResponse` from `@receivy/common`; API base URL from server-only `EZ4_API_URL`.
- Produces: a responsive Receivy application shell and same-origin `GET /api/health` BFF endpoint; no browser code receives the upstream API URL.

- [ ] **Step 1: Create the Next manifest, test setup, and failing shell test**

Use Next `^16.2.6`, React/React DOM from the catalog, `@receivy/common`, `lucide-react`, `clsx`, `tailwind-merge`, and Tailwind 4. Add Vitest, jsdom, Testing Library, TypeScript, and React/Node type packages as dev dependencies.

Create `packages/web/src/components/app-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("exposes the four approved navigation destinations", () => {
    render(<AppShell><p>Conteúdo</p></AppShell>);
    for (const label of ["Timeline", "Recorrências", "Contatos", "Ajustes"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: "Nova cobrança" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the web test and confirm it fails**

Run: `pnpm --filter @receivy/web test`

Expected: FAIL because `./app-shell` does not exist.

- [ ] **Step 3: Implement the branded responsive shell**

Build `AppShell` as a server-compatible React component with:

- a desktop sidebar visible from 768 px;
- a bottom navigation below 768 px;
- the four exact destinations from the spec;
- a 48 px minimum touch target;
- a `Nova cobrança` button with a plus icon;
- semantic `nav`, `main`, and accessible labels;
- colors sourced from CSS variables initialized from `designTokens` in `layout.tsx`.

Implement `globals.css` with Plus Jakarta Sans fallback stacks, focus-visible outlines, the Stitch-derived emerald/canvas palette, responsive grid layout, and `prefers-reduced-motion` support. The home page must show a production-quality empty timeline state explaining that created and linked charges will appear together, plus the two directional summary cards at zero.

- [ ] **Step 4: Implement and test the server-only BFF health route**

Create `packages/web/src/app/api/health/route.ts`:

```ts
import type { HealthResponse } from "@receivy/common";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse<HealthResponse | { status: "unavailable" }>> {
  const baseUrl = process.env.EZ4_API_URL;
  if (!baseUrl) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  const response = await fetch(new URL("/health", baseUrl), { cache: "no-store" });
  if (!response.ok) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  return NextResponse.json((await response.json()) as HealthResponse, { headers: { "Cache-Control": "no-store" } });
}
```

Add route tests that mock `fetch` and assert 503 without `EZ4_API_URL`, pass-through of the typed success body, and `Cache-Control: no-store`.

- [ ] **Step 5: Configure standalone output without bypasses**

Create `packages/web/next.config.mjs`:

```js
/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname
};

export default nextConfig;
```

Do not add `typescript.ignoreBuildErrors` or ESLint build bypasses.

- [ ] **Step 6: Verify the web package**

Run: `pnpm --filter @receivy/web test && pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web build`

Expected: PASS and `.next/standalone` exists.

- [ ] **Step 7: Commit the web foundation**

```bash
git add packages/web
git commit -m "feat(web): add responsive receivy bff shell"
```

---

### Task 5: Add the Expo SDK 56 mobile shell and development-build configuration

**Files:**
- Create: `packages/mobile/package.json`
- Create: `packages/mobile/app.json`
- Create: `packages/mobile/eas.json`
- Create: `packages/mobile/tsconfig.json`
- Create: `packages/mobile/metro.config.js`
- Create: `packages/mobile/uniwind-types.d.ts`
- Create: `packages/mobile/app/_layout.tsx`
- Create: `packages/mobile/app/(tabs)/_layout.tsx`
- Create: `packages/mobile/app/(tabs)/index.tsx`
- Create: `packages/mobile/app/(tabs)/recurrences.tsx`
- Create: `packages/mobile/app/(tabs)/people.tsx`
- Create: `packages/mobile/app/(tabs)/settings.tsx`
- Create: `packages/mobile/src/components/empty-state.tsx`
- Create: `packages/mobile/src/components/empty-state.test.tsx`
- Create: `packages/mobile/jest.config.js`
- Create: `packages/mobile/jest.setup.ts`

**Interfaces:**
- Consumes: `designTokens` from `@receivy/common` and Expo SDK 56 compatibility constraints.
- Produces: an iOS/Android Expo Router app with the approved four-tab navigation, a Receivy empty timeline, and EAS development/preview/production profiles.

- [ ] **Step 1: Scaffold the SDK 56 package through pnpm**

Run from the repository root:

```bash
pnpm create expo-app --template default@sdk-56 packages/mobile
```

Normalize the generated package name to `@receivy/mobile`, keep `expo-router/entry`, and remove the generated nested lockfile if one exists. Confirm the generated runtime uses Expo `^56.0.0`, React `19.2.3`, and React Native `0.85.x` before adding Receivy files.

- [ ] **Step 2: Install only the foundation-native dependencies**

Run:

```bash
pnpm --filter @receivy/mobile exec expo install expo-dev-client expo-secure-store expo-web-browser
pnpm --filter @receivy/mobile add @receivy/common@workspace:* uniwind
pnpm --filter @receivy/mobile add -D jest jest-expo @types/jest @testing-library/react-native
```

Do not add Google/Apple auth libraries, push, camera, image picker, OCR, purchases, or QR packages in this increment.

- [ ] **Step 3: Write the failing native empty-state test**

Create `packages/mobile/src/components/empty-state.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("explains the combined timeline", () => {
    render(<EmptyState />);
    expect(screen.getByText("Sua timeline começa aqui")).toBeTruthy();
    expect(screen.getByText(/valores a receber e a pagar/i)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the mobile test and confirm it fails**

Run: `pnpm --filter @receivy/mobile test`

Expected: FAIL because `./empty-state` does not exist.

- [ ] **Step 5: Implement the native shell**

Implement `EmptyState` using React Native primitives and colors/spacing from `designTokens`. Build the tab layout with exactly `Timeline`, `Recorrências`, `Contatos`, and `Ajustes`. The timeline screen displays two zero-value directional summaries, `EmptyState`, and a 48 px `Nova cobrança` action. The other tabs use finished empty-copy appropriate to each domain, without fake records or unavailable actions.

Configure `app.json` with:

- name/slug/scheme `Receivy`/`receivy`/`receivy`;
- iOS bundle identifier `com.wellsm.receivy`, minimum implied by SDK 56, and `ITSAppUsesNonExemptEncryption: false`;
- Android package `com.wellsm.receivy`;
- plugins `expo-router`, `expo-dev-client`, `expo-secure-store`, and `expo-web-browser`;
- typed routes enabled;
- no EAS project ID until the real Expo project is created.

Create `eas.json` with Rewarlo-equivalent `development` (`developmentClient: true`, internal), `preview` (internal), and `production` (`autoIncrement: true`) profiles.

- [ ] **Step 6: Verify the native package**

Run: `pnpm --filter @receivy/mobile test && pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile exec expo-doctor`

Expected: PASS with no incompatible Expo package versions.

- [ ] **Step 7: Commit the mobile foundation**

```bash
git add packages/mobile
git commit -m "feat(mobile): add expo 56 receivy shell"
```

---

### Task 6: Add Docker packaging, CI, and local run documentation

**Files:**
- Create: `packages/web/Dockerfile`
- Create: `.dockerignore`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: all four workspaces and their root quality-gate scripts.
- Produces: reproducible CI on Node 24, a minimal Next standalone image, and exact local startup instructions.

- [ ] **Step 1: Add the standalone web Dockerfile based on Rewarlo**

Use a three-stage `node:24-slim` Dockerfile:

1. `base` enables Corepack and activates the version from `packageManager`.
2. `builder` copies root manifests, `vendor`, and package manifests before `pnpm install --frozen-lockfile`; then copies sources and runs `pnpm --filter @receivy/web build`.
3. `runner` uses a non-root user, copies `packages/web/.next/standalone`, `.next/static`, and `public`, sets `PORT=3000`, `HOSTNAME=0.0.0.0`, and starts the emitted `server.js`.

The build must not receive API secrets. `EZ4_API_URL` is a runtime-only server environment variable.

- [ ] **Step 2: Add CI with the same local gates**

Create `.github/workflows/ci.yml` triggered by pushes and pull requests. It must:

- check out the repository;
- install Node `24` with pnpm cache;
- enable Corepack and run `corepack prepare pnpm@11.5.3 --activate`;
- run `pnpm install --frozen-lockfile`;
- run `pnpm verify`;
- build `packages/web/Dockerfile` without pushing;
- run `pnpm --filter @receivy/mobile exec expo-doctor`.

- [ ] **Step 3: Document the exact local loop**

Write `README.md` with prerequisites Node 24, Corepack, Docker, Xcode 26.4+ for SDK 56 iOS builds, Android Studio, and a trusted development device. Include:

```bash
corepack enable
corepack prepare pnpm@11.5.3 --activate
pnpm install
cp packages/api/local.env.example packages/api/local.env
pnpm --filter @receivy/api db:up
pnpm dev
pnpm dev:mobile
pnpm verify
```

Explain that mobile device testing uses a development build, the API listens on `3735`, web on `3000`, Postgres on `55434`, and `EZ4_API_URL=http://127.0.0.1:3735` belongs in the web runtime environment.

- [ ] **Step 4: Install dependencies and generate the only lockfile**

Run: `corepack enable && corepack prepare pnpm@11.5.3 --activate && pnpm install`

Expected: PASS and only `/pnpm-lock.yaml` exists.

- [ ] **Step 5: Run the complete foundation proof**

Run: `pnpm verify`

Expected: PASS for workspace contract, lint, strict types, tests, and builds.

Run: `docker build -f packages/web/Dockerfile -t receivy-web:foundation .`

Expected: PASS with a Node 24 standalone image.

- [ ] **Step 6: Commit the delivery foundation**

```bash
git add .dockerignore .github README.md packages/web/Dockerfile pnpm-lock.yaml
git commit -m "chore: add receivy ci and container build"
```

---

### Task 7: Exercise the local vertical slice and record the stop condition

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: EZ4 health API, Next BFF health route, mobile/web shells, and local Docker services.
- Produces: evidence that the foundation is runnable before auth or domain work begins.

- [ ] **Step 1: Start Postgres and the EZ4 API**

Run:

```bash
pnpm --filter @receivy/api db:up
pnpm dev:api
```

Expected: Postgres becomes healthy and EZ4 serves `GET /health` on `http://127.0.0.1:3735`.

- [ ] **Step 2: Prove the API and BFF responses**

Run: `curl --fail http://127.0.0.1:3735/health`

Expected:

```json
{"status":"ok","service":"receivy-api"}
```

Start web with `EZ4_API_URL=http://127.0.0.1:3735 pnpm dev:web`, then run `curl --fail http://127.0.0.1:3000/api/health` and expect the same JSON.

- [ ] **Step 3: Visually inspect the responsive shell**

Open the web application at 390 px, 768 px, and 1440 px. Confirm the bottom bar/sidebar transition, visible keyboard focus, no horizontal overflow, the four approved destinations, 48 px touch targets, Receivy branding, and zero-state combined timeline copy.

- [ ] **Step 4: Launch the Expo development build path**

Run `pnpm --filter @receivy/mobile ios` or `pnpm --filter @receivy/mobile android` on an available trusted device/simulator. Confirm all four tabs render, system appearance works, the timeline empty state is legible, and no Expo Go-only instruction appears.

- [ ] **Step 5: Record the verified commands and stop**

Append a dated “Foundation verification” section to `README.md` listing the exact successful commands and local ports. Do not start auth, user tables, payment flows, or deployment credentials in this plan.

- [ ] **Step 6: Commit the exercised foundation**

```bash
git add README.md
git commit -m "docs: record foundation verification"
```

## Self-Review

- Spec coverage for increment 1: monorepo, common contracts/tokens, local Postgres, EZ4, Docker, Expo development build, and CI each have an independently testable task.
- Explicit omissions: authentication, financial domain behavior, uploads, notifications, deployment credentials, and all out-of-MVP features remain outside this increment.
- Type consistency: `HealthResponse`, `designTokens`, and package names are defined once in `@receivy/common` and consumed unchanged by API/web/mobile.
- Stop condition: stop after `pnpm verify`, `expo-doctor`, the Docker build, API/BFF curls, and responsive/native shell checks pass.
