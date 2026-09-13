# Categorias novas e foto de perfil Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Saúde, Educação and Lazer billing categories, and let each user change their own profile photo, shown instead of the initial wherever that person appears to a signed-in viewer.

**Architecture:** `@receivy/common` owns the new categories, the `UserAvatar` DTO and the upload limits. The API stores one object per user at `avatars/<userId>` in the existing `ProofFiles` bucket, marks it with `users.avatar_updated_at`, fills DTOs with an unsigned reference (`AvatarRepository.ref`) and signs every reference once per response at the endpoint (`AvatarRepository.sign`). Web and mobile render the photo through `InitialsAvatar` (falling back to the initial) and upload from Perfil with a signed PUT.

**Tech Stack:** TypeScript, EZ4 (`@ez4/storage` bucket client: `getWriteUrl`, `getReadUrl`, `stat`, `write`, `delete`), Postgres via `@ez4/pgclient`, Next 16 + Tailwind v4 (web), Expo SDK 56 + Uniwind + `expo-image` (mobile), Vitest (common/API unit/web), `node:test` + `ez4 test` (API integration), Jest + RNTL (mobile).

**Spec:** `docs/superpowers/specs/2026-09-13-categories-and-avatar-design.md`

## Global Constraints

- User rules: never push, run migrations or deploy; commits only as the run's controller allows. No new dependency except `expo-image-picker` in Task 8 (approved by the user).
- AGENTS.md: repositories are `export namespace XRepository` with short names; handlers destructure the context (`{ db, proofFiles }`), never `context.db`; string unions are `const enum`; classes live in components, never in `globals.css`; clean code with early returns and blank lines between blocks.
- Style: common and API are Biome (single quotes, semicolons, no trailing commas, width 140). Web uses double quotes, no whole-file reformatting. Mobile keeps each file's formatting.
- Categories (exact): `Health = 'health'` → `Saúde`, `Education = 'education'` → `Educação`, `Leisure = 'leisure'` → `Lazer`, listed after `Viagem` and before `Outro`. Colors: `health: '#D94F70'`, `education: '#5B6BD6'`, `leisure: '#C9971C'`. Web icons (lucide): `HeartPulse`, `GraduationCap`, `Ticket`.
- Avatar (exact): object key `avatars/<userId>`; column `users.avatar_updated_at` (`String.DateTime`, optional); `UserAvatar = { url: string; version: string }`; mimes `image/jpeg`, `image/png`; max `2 * 1024 * 1024` bytes; upload URL `expiresIn: 300`; read URL `expiresIn: 3600`; invalid message `Envie uma imagem JPG ou PNG de até 2 MB.` with code `AVATAR_INVALID`; routes `POST /account/avatar` (body `{ mime }` → `{ uploadUrl, expiresAt }`) and `POST /account/avatar/complete` (→ `{ avatar }`).
- Ruling for incremental green builds: every new avatar field in common DTOs is optional (`avatar?: UserAvatar | null`); clients read `undefined` as no photo.
- Copy (exact): web/mobile `aria-label`/`accessibilityLabel` `Trocar foto`; web spinner state label `Enviando foto…`; mobile photo permission `O Receivy usa suas fotos para trocar a foto do perfil.`
- The public payment page (`/pay/`) and public API views never carry avatars.
- Verification per touched package: `pnpm --filter <pkg> check-types && pnpm --filter <pkg> lint && pnpm --filter <pkg> test`; API also `pnpm --filter @receivy/api openapi:check` after regenerating with `openapi:generate`.

## File map

| File | Responsibility |
|---|---|
| `packages/common/src/domain/billing-category.ts` | three new categories, labels, colors |
| `packages/common/src/domain/avatar.ts` (new) | `UserAvatar`, `AvatarMime`, `AVATAR_MAX_BYTES`, `AVATAR_INVALID_MESSAGE`, `AvatarUploadTicket`, `isAvatarUpload` |
| `packages/common/src/domain/{contracts,contacts,billing}.ts`, `auth/auth.ts` | optional avatar fields on DTOs |
| `packages/api/src/users/schemas/user.ts` | `avatar_updated_at` |
| `packages/api/src/users/repositories/avatar.ts` (new) | `AvatarRepository.key/ref/sign/startUpload/complete` |
| `packages/api/src/users/errors.ts` (new) | `AvatarInvalidError` |
| `packages/api/src/users/endpoints/avatar.ts` (new) | start and complete handlers |
| `packages/api/src/users/services/provider-picture.ts` (new) | copy the Google picture once |
| `packages/api/src/{contacts,charges,billings,timeline}/**` | avatar references in DTOs, bucket in providers, `sign` in endpoints |
| `packages/web/src/components/ui/initials-avatar.tsx` | photo with initial fallback |
| `packages/web/src/lib/avatar-upload.ts` (new) | square JPEG from a file, upload flow |
| `packages/web/src/components/screens/profile-screen.tsx` | pencil over the photo |
| `packages/mobile/src/components/ui/initials-avatar.tsx` | photo with initial fallback (`expo-image`, `cacheKey`) |
| `packages/mobile/src/account/avatar.ts` (new) | pick and upload |
| `packages/mobile/src/components/screens/profile-screen.tsx` | pencil over the photo |
| `docs/manual-qa-script.md` | QA section |

---

### Task 1: common — categories and avatar contract

**Files:**
- Modify: `packages/common/src/domain/billing-category.ts`
- Create: `packages/common/src/domain/avatar.ts`, `packages/common/src/domain/avatar.test.ts`, `packages/common/src/domain/billing-category.test.ts`
- Modify: `packages/common/src/index.ts`, `packages/common/src/auth/auth.ts`, `packages/common/src/domain/contracts.ts`, `packages/common/src/domain/contacts.ts`, `packages/common/src/domain/billing.ts`

**Interfaces:**
- Produces: `BillingCategory.Health | Education | Leisure`; `UserAvatar`; `const enum AvatarMime { Jpeg = 'image/jpeg', Png = 'image/png' }`; `AVATAR_MAX_BYTES: number`; `AVATAR_INVALID_MESSAGE: string`; `AvatarUploadTicket = { uploadUrl: string; expiresAt: string }`; `isAvatarUpload(mime: string | null | undefined, size: number | null | undefined): boolean`; optional fields `AuthUser.avatar`, `ChargeSummary.counterpartAvatar`, `ChargeCounterpart.avatar`, `Contact.avatar`, `LinkableContact.avatar`, `BillingGuest.avatar`, `BillingPayee.avatar`.

- [ ] **Step 1: Write the failing tests**

`packages/common/src/domain/billing-category.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BILLING_CATEGORIES, BillingCategory, billingCategoryColor, billingCategoryLabel, isBillingCategory } from './billing-category';

describe('billing categories', () => {
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
      'Outro'
    ]);
  });

  it('labels and tints the new categories', () => {
    expect(billingCategoryLabel(BillingCategory.Health)).toBe('Saúde');
    expect(billingCategoryLabel(BillingCategory.Education)).toBe('Educação');
    expect(billingCategoryLabel(BillingCategory.Leisure)).toBe('Lazer');
    expect(billingCategoryColor(BillingCategory.Health)).toBe('#D94F70');
    expect(billingCategoryColor(BillingCategory.Education)).toBe('#5B6BD6');
    expect(billingCategoryColor(BillingCategory.Leisure)).toBe('#C9971C');
    expect(isBillingCategory('health')).toBe(true);
  });
});
```

`packages/common/src/domain/avatar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, isAvatarUpload } from './avatar';

describe('isAvatarUpload', () => {
  it('accepts JPEG and PNG up to 2 MB', () => {
    expect(isAvatarUpload('image/jpeg', 1)).toBe(true);
    expect(isAvatarUpload('image/png', AVATAR_MAX_BYTES)).toBe(true);
  });

  it('rejects other types, empty and oversized files', () => {
    expect(isAvatarUpload('image/webp', 10)).toBe(false);
    expect(isAvatarUpload('image/jpeg', 0)).toBe(false);
    expect(isAvatarUpload('image/jpeg', AVATAR_MAX_BYTES + 1)).toBe(false);
    expect(isAvatarUpload(undefined, 10)).toBe(false);
    expect(isAvatarUpload('image/png', undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @receivy/common test -- billing-category avatar`
Expected: FAIL — `Saúde` missing and `./avatar` not found.

- [ ] **Step 3: Implement**

`billing-category.ts`: add to the enum after `Travel = 'travel',`:

```ts
  Health = 'health',
  Education = 'education',
  Leisure = 'leisure',
```

In `BILLING_CATEGORIES`, after the `Travel` entry:

```ts
  { value: BillingCategory.Health, label: 'Saúde' },
  { value: BillingCategory.Education, label: 'Educação' },
  { value: BillingCategory.Leisure, label: 'Lazer' },
```

In `BILLING_CATEGORY_COLORS`, after `travel: '#D6538C',`:

```ts
  health: '#D94F70',
  education: '#5B6BD6',
  leisure: '#C9971C',
```

Create `packages/common/src/domain/avatar.ts`:

```ts
/**
 * A person's photo. The API fills `url` with a short-lived signed URL; `version` changes only when the photo
 * does, so clients key their image cache on it instead of on the URL.
 */
export type UserAvatar = { url: string; version: string };

export const enum AvatarMime {
  Jpeg = 'image/jpeg',
  Png = 'image/png'
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_INVALID_MESSAGE = 'Envie uma imagem JPG ou PNG de até 2 MB.';

export type AvatarUploadTicket = { uploadUrl: string; expiresAt: string };

export function isAvatarUpload(mime: string | null | undefined, size: number | null | undefined): boolean {
  if (mime !== AvatarMime.Jpeg && mime !== AvatarMime.Png) {
    return false;
  }

  return typeof size === 'number' && size > 0 && size <= AVATAR_MAX_BYTES;
}
```

`index.ts`: add `export * from './domain/avatar';` right after `export * from './domain/api-error';`.

Optional DTO fields (import `type UserAvatar` from `'../domain/avatar'` in `auth.ts`, from `'./avatar'` elsewhere):
- `auth/auth.ts` `AuthUser`: add `avatar?: UserAvatar | null;` right after `avatarUrl: string | null;` (Task 2 removes `avatarUrl`).
- `domain/contracts.ts` `ChargeSummary`: after `counterpartName: string;` add
  ```ts
  /** Photo of the counterpart; absent or null shows the initial. */
  counterpartAvatar?: UserAvatar | null;
  ```
  `ChargeCounterpart`: after `email: string | null;` add `avatar?: UserAvatar | null;`.
- `domain/contacts.ts` `Contact`: after `displayName: string;` add `avatar?: UserAvatar | null;`.
- `domain/billing.ts`: `export type BillingPayee = { userId: string; name: string; avatar?: UserAvatar | null };`,
  `export type BillingGuest = { id: string; userId: string; name: string; email: string; createdAt: string; avatar?: UserAvatar | null };`,
  `export type LinkableContact = { contactId: string; displayName: string; avatar?: UserAvatar | null };`.

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @receivy/common test && pnpm --filter @receivy/common check-types && pnpm --filter @receivy/common lint`
Expected: PASS. Then `pnpm --filter @receivy/web check-types` and `pnpm --filter @receivy/mobile check-types` — both FAIL only on `Record<BillingCategory, …>` maps missing `health/education/leisure` (web `category-icon.tsx`, mobile `category-icon.tsx`); Tasks 5 and 7 fix those. Record this in the report; do not touch web/mobile here.

- [ ] **Step 5: Commit**

```bash
git add packages/common/src
git commit -m "feat(common): health, education and leisure categories and the avatar contract"
```

---

### Task 2: API — avatar storage, upload endpoints, profile and deletion

**Files:**
- Modify: `packages/api/src/users/schemas/user.ts`
- Create: `packages/api/src/users/errors.ts`, `packages/api/src/users/repositories/avatar.ts`, `packages/api/src/users/repositories/avatar.test.ts`, `packages/api/src/users/endpoints/avatar.ts`, `packages/api/test/account/avatar.spec.ts`
- Modify: `packages/api/src/users/routes.ts`, `packages/api/src/api.ts` (`httpErrors`), `packages/api/src/users/repositories/auth.ts`, `packages/api/src/users/endpoints/me.ts`, `packages/api/src/users/endpoints/profile.ts`, `packages/api/src/users/services/deletion.ts`, `packages/common/src/auth/auth.ts`, `docs/api-oas.yml` (regenerated)

**Interfaces:**
- Consumes: Task 1 `UserAvatar`, `AvatarMime`, `AvatarUploadTicket`, `isAvatarUpload`, `AVATAR_INVALID_MESSAGE`.
- Produces (`packages/api/src/users/repositories/avatar.ts`):
  - `AvatarRepository.key(userId: string): string` → `avatars/<userId>`
  - `AvatarRepository.ref(userId: string, updatedAt: string | Date | null | undefined): UserAvatar | null`
  - `AvatarRepository.sign<T>(bucket: Client, body: T): Promise<T>`
  - `AvatarRepository.startUpload(bucket: Client, userId: string, mime: AvatarMime, now?: Date): Promise<AvatarUploadTicket>`
  - `AvatarRepository.complete(db: DbClient, bucket: Client, userId: string, now?: Date): Promise<{ avatar: UserAvatar }>`
- `AuthUser.avatar` is always set by the API from here on (`avatarUrl` is removed from common).

- [ ] **Step 1: Write the failing unit test**

`packages/api/src/users/repositories/avatar.test.ts`:

```ts
import type { Client } from '@ez4/storage';
import { describe, expect, it, vi } from 'vitest';
import { AvatarRepository } from './avatar';

function bucket() {
  return {
    getReadUrl: vi.fn(async (key: string) => `https://bucket.test/${key}?signed`)
  } as unknown as Client;
}

describe('AvatarRepository.ref', () => {
  it('references the object only when a photo exists', () => {
    expect(AvatarRepository.ref('u1', null)).toBeNull();
    expect(AvatarRepository.ref('u1', '2026-09-13T10:00:00.000Z')).toEqual({ url: 'avatars/u1', version: '2026-09-13T10:00:00.000Z' });
    expect(AvatarRepository.ref('u1', new Date('2026-09-13T10:00:00.000Z'))?.version).toBe('2026-09-13T10:00:00.000Z');
  });
});

describe('AvatarRepository.sign', () => {
  it('signs every reference in a nested body once per key', async () => {
    const client = bucket();
    const body = {
      items: [
        { charge: { counterpartAvatar: AvatarRepository.ref('u1', '2026-01-01T00:00:00.000Z') } },
        { charge: { counterpartAvatar: AvatarRepository.ref('u1', '2026-01-01T00:00:00.000Z') } }
      ],
      recipient: { name: 'Ana', avatar: AvatarRepository.ref('u2', '2026-01-02T00:00:00.000Z') },
      other: { url: 'https://example.test', version: 'x' },
      empty: null
    };

    const signed = await AvatarRepository.sign(client, body);

    expect(signed.items[0]!.charge.counterpartAvatar?.url).toBe('https://bucket.test/avatars/u1?signed');
    expect(signed.recipient.avatar).toEqual({ url: 'https://bucket.test/avatars/u2?signed', version: '2026-01-02T00:00:00.000Z' });
    expect(signed.other.url).toBe('https://example.test');
    expect(client.getReadUrl).toHaveBeenCalledTimes(2);
    expect(client.getReadUrl).toHaveBeenCalledWith('avatars/u1', { expiresIn: 3600 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @receivy/api test -- avatar`
Expected: FAIL — `./avatar` not found.

- [ ] **Step 3: Implement storage, errors and repository**

`users/schemas/user.ts`, after `avatar_url?: String.Max<512>;`:

```ts
  /** When the photo at `avatars/<id>` was last replaced; absent means no photo. */
  avatar_updated_at?: String.DateTime;
```

Create `packages/api/src/users/errors.ts`:

```ts
import { AVATAR_INVALID_MESSAGE } from '@receivy/common';
import { UnprocessableEntityError } from '../common/errors';

export class AvatarInvalidError extends UnprocessableEntityError {
  constructor() {
    super(AVATAR_INVALID_MESSAGE, 'AVATAR_INVALID');
  }
}
```

Register it in `src/api.ts`: append `AvatarInvalidError` to the existing `422: [...]` array of `httpErrors` (next to `ProofInvalidFileError`) and import it from `'./users/errors'` following the file's import order.

Create `packages/api/src/users/repositories/avatar.ts`:

```ts
import { HttpNotFoundError } from '@ez4/gateway';
import type { Client } from '@ez4/storage';
import { type AvatarMime, type AvatarUploadTicket, isAvatarUpload, type UserAvatar } from '@receivy/common';
import type { DbClient } from '../../database';
import { AvatarInvalidError } from '../errors';

const PREFIX = 'avatars/';
const UPLOAD_SECONDS = 300;
const READ_SECONDS = 3600;

function isReference(value: Record<string, unknown>): value is UserAvatar {
  const keys = Object.keys(value);

  return (
    keys.length === 2 &&
    typeof value['version'] === 'string' &&
    typeof value['url'] === 'string' &&
    (value['url'] as string).startsWith(PREFIX)
  );
}

export namespace AvatarRepository {
  export function key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  /** Unsigned reference for a DTO: the object key stands in for the URL until the endpoint signs the body. */
  export function ref(userId: string, updatedAt: string | Date | null | undefined): UserAvatar | null {
    if (!updatedAt) {
      return null;
    }

    return { url: key(userId), version: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt };
  }

  /** Replaces every avatar reference in `body` with a signed read URL; one signature per object key. */
  export async function sign<T>(bucket: Client, body: T): Promise<T> {
    const urls = new Map<string, Promise<string>>();

    async function visit(value: unknown): Promise<void> {
      if (!value || typeof value !== 'object') {
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          await visit(item);
        }

        return;
      }

      const record = value as Record<string, unknown>;

      if (isReference(record)) {
        const objectKey = record.url;

        if (!urls.has(objectKey)) {
          urls.set(objectKey, bucket.getReadUrl(objectKey, { expiresIn: READ_SECONDS }));
        }

        record.url = await urls.get(objectKey)!;
        return;
      }

      for (const child of Object.values(record)) {
        await visit(child);
      }
    }

    await visit(body);

    return body;
  }

  export async function startUpload(bucket: Client, userId: string, mime: AvatarMime, now = new Date()): Promise<AvatarUploadTicket> {
    if (!isAvatarUpload(mime, 1)) {
      throw new AvatarInvalidError();
    }

    return {
      uploadUrl: await bucket.getWriteUrl(key(userId), { expiresIn: UPLOAD_SECONDS, contentType: mime }),
      expiresAt: new Date(now.getTime() + UPLOAD_SECONDS * 1000).toISOString()
    };
  }

  /** Confirms the bytes landed and are acceptable; a bad file is removed so the previous photo never points at it. */
  export async function complete(db: DbClient, bucket: Client, userId: string, now = new Date()): Promise<{ avatar: UserAvatar }> {
    const stats = await bucket.stat(key(userId));

    if (!stats) {
      throw new HttpNotFoundError();
    }

    if (!isAvatarUpload(stats.type, stats.size)) {
      await bucket.delete(key(userId));
      throw new AvatarInvalidError();
    }

    const instant = now.toISOString();

    await db.users.updateOne({ where: { id: userId, deleted_at: { isNull: true } }, data: { avatar_updated_at: instant, updated_at: instant } });

    return sign(bucket, { avatar: ref(userId, instant)! });
  }
}
```

Note: a bad upload removes the object even if a previous valid photo existed, because both share the key; `complete` then leaves `avatar_updated_at` as it was, so the client shows the initial when the old URL 404s. This matches the spec (one key, always overwritten).

- [ ] **Step 4: Endpoints and routes**

Create `packages/api/src/users/endpoints/avatar.ts`:

```ts
import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AvatarMime, AvatarUploadTicket, UserAvatar } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';
import { AvatarRepository } from '../repositories/avatar';

declare class AvatarUploadRequest implements Http.Request {
  identity: SessionIdentity;
  body: { mime: AvatarMime };
}

declare class AvatarUploadResponse implements Http.Response {
  status: 200;
  body: AvatarUploadTicket;
}

declare class AvatarCompleteRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class AvatarCompleteResponse implements Http.Response {
  status: 200;
  body: { avatar: UserAvatar };
}

export async function startAvatarUploadHandler(
  request: AvatarUploadRequest,
  { proofFiles }: Service.Context<UserProvider>
): Promise<AvatarUploadResponse> {
  return { status: 200, body: await AvatarRepository.startUpload(proofFiles, request.identity.userId, request.body.mime) };
}

export async function completeAvatarUploadHandler(
  request: AvatarCompleteRequest,
  { db, proofFiles }: Service.Context<UserProvider>
): Promise<AvatarCompleteResponse> {
  return { status: 200, body: await AvatarRepository.complete(db, proofFiles, request.identity.userId) };
}
```

`users/routes.ts`: import `import type { completeAvatarUploadHandler, startAvatarUploadHandler } from './endpoints/avatar';` (alphabetical among the endpoint imports) and append before the `deleteAccount` route:

```ts
  Http.UseRoute<{
    name: 'startAvatarUpload';
    path: 'POST /account/avatar';
    authorizer: typeof sessionAuthorizer;
    handler: typeof startAvatarUploadHandler;
  }>,
  Http.UseRoute<{
    name: 'completeAvatarUpload';
    path: 'POST /account/avatar/complete';
    authorizer: typeof sessionAuthorizer;
    handler: typeof completeAvatarUploadHandler;
  }>,
```

- [ ] **Step 5: `AuthUser.avatar` replaces `avatarUrl`**

`packages/common/src/auth/auth.ts`: delete `avatarUrl: string | null;` and make the field required: `avatar: UserAvatar | null;`.

`users/repositories/auth.ts`:
- `toAuthUser` row type: add `avatar_updated_at?: string;`; in the returned object replace `avatarUrl: row.avatar_url ?? null,` with `avatar: AvatarRepository.ref(row.id, row.avatar_updated_at),` (import `AvatarRepository` from `'./avatar'`).
- Every `select` object that feeds `toAuthUser` (the ones listed with `avatar_url: true` at the current lines ~169, ~314, ~430, ~573) gets `avatar_updated_at: true` next to `avatar_url: true`.

`users/endpoints/me.ts`: destructure `{ db, proofFiles }` and return `{ status: 200, body: await AvatarRepository.sign(proofFiles, { user }) }`.

`users/endpoints/profile.ts`: destructure `{ db, proofFiles }` and return
`{ status: 200, body: await AvatarRepository.sign(proofFiles, { user: await AccountRepository.updateProfile(db, request.identity.userId, request.body) }) }`. If `updateProfile` builds its `AuthUser` without `toAuthUser`, add `avatar_updated_at: true` to its select and map `avatar: AvatarRepository.ref(...)` the same way.

Run `pnpm --filter @receivy/api check-types` and fix every remaining `avatarUrl` reference the compiler reports in the API (there are none in web/mobile; verify with `grep -rn avatarUrl packages/web/src packages/mobile/src`).

- [ ] **Step 6: Account deletion removes the photo**

`users/services/deletion.ts`: right after the early `if (user.deleted_at) return { deleted: true, objectKeys };` line add `objectKeys.push(AvatarRepository.key(userId));` (import from `'../repositories/avatar'`), so an already-deleted account returns no keys; in the final `tx.users.updateOne` data add `avatar_updated_at: sqlNull,` next to `avatar_url: sqlNull,`. The existing `bucketProofStorage.delete` already tolerates an absent object.

- [ ] **Step 7: Integration test**

`packages/api/test/account/avatar.spec.ts`:

```ts
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BucketTester } from '@ez4/local-storage/test';
import { AvatarMime } from '@receivy/common';
import { AvatarInvalidError } from '../../src/users/errors';
import { AvatarRepository } from '../../src/users/repositories/avatar';
import { AuthRepository } from '../../src/users/repositories/auth';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const user = '61000000-0000-4000-8000-0000000000a1';

describe('avatar upload', () => {
  const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });

  before(async () => {
    await cleanupUsers(db, [user]);
    await createUser(db, { id: user, email: 'avatar@example.test', name: 'Avatar' });
  });

  after(async () => {
    await cleanupUsers(db, [user]);
  });

  it('signs a write URL for the fixed key', async () => {
    bucket.getWriteUrl.mock.mockImplementation(async (key: string) => `https://bucket.test/${key}?put`);

    const ticket = await AvatarRepository.startUpload(bucket, user, AvatarMime.Jpeg);

    equal(ticket.uploadUrl, `https://bucket.test/avatars/${user}?put`);
    ok(Date.parse(ticket.expiresAt) > Date.now());
  });

  it('rejects an oversized file, removes it and keeps the user without photo', async () => {
    bucket.stat.mock.mockImplementation(async () => ({ type: 'image/jpeg', size: 3 * 1024 * 1024 }));
    bucket.delete.mock.mockImplementation(async () => undefined);

    await rejects(AvatarRepository.complete(db, bucket, user), AvatarInvalidError);

    equal(bucket.delete.mock.calls.at(-1)?.arguments[0], `avatars/${user}`);
    equal((await AuthRepository.findUserById(db, user))?.avatar, null);
  });

  it('accepts a PNG and exposes the signed avatar', async () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    bucket.stat.mock.mockImplementation(async () => ({ type: 'image/png', size: 1024 }));
    bucket.getReadUrl.mock.mockImplementation(async (key: string) => `https://bucket.test/${key}?get`);

    const result = await AvatarRepository.complete(db, bucket, user, now);

    deepEqual(result, { avatar: { url: `https://bucket.test/avatars/${user}?get`, version: now.toISOString() } });
    deepEqual((await AuthRepository.findUserById(db, user))?.avatar, { url: `avatars/${user}`, version: now.toISOString() });
  });
});
```

If the mock methods of `BucketTester.getClientMock` expose a different API than `node:test`'s `mock.method` (`.mock.mockImplementation`, `.mock.calls[i].arguments`), adapt the calls to what the type definitions offer and note it in the report; keep the three assertions.

- [ ] **Step 8: Regenerate OpenAPI and verify**

Run: `pnpm --filter @receivy/api openapi:generate && pnpm --filter @receivy/api openapi:check`
Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api lint && pnpm --filter @receivy/api test && pnpm --filter @receivy/api check-types:test`
Expected: PASS. `test:integration` needs the local database; run it only if `receivy-pg` is up (`docker ps`), otherwise say so in the report. Do not run `ez4 serve`.

- [ ] **Step 9: Commit**

```bash
git add packages/api packages/common/src/auth/auth.ts docs/api-oas.yml
git commit -m "feat(api): profile photo upload, signed avatar on the account and removal on deletion"
```

---

### Task 3: API — avatars on people across DTOs

**Files:**
- Modify: `packages/api/src/contacts/repositories/contact.ts`, `packages/api/src/charges/repositories/charge.ts`, `packages/api/src/timeline/repositories/timeline.ts`, `packages/api/src/billings/repositories/billing.ts`
- Modify providers: `packages/api/src/contacts/provider.ts`, `packages/api/src/charges/provider.ts`, `packages/api/src/billings/provider.ts`, `packages/api/src/timeline/provider.ts`
- Modify endpoints (sign before responding): `billings/endpoints/{create,get,patch}.ts`, the billing guest resolution endpoint (the handler behind `POST /billings/{id}/guests/{guestId}`), `charges/endpoints/{get,cancel,pay,reopen}.ts`, `contacts/endpoints/{get,list,archive}.ts` plus any other contacts endpoint whose response type contains `Contact`, `proofs/endpoints/{complete-upload,review,withdraw}.ts` when their body is a `ChargeDetail`, `timeline/endpoints/{timeline,contact-ledger}.ts`
- Create: `packages/api/test/account/avatar-people.spec.ts`
- Modify: `docs/api-oas.yml` (regenerated)

**Interfaces:**
- Consumes: Task 2 `AvatarRepository.ref`, `AvatarRepository.sign`.
- Produces: `ContactRepository.counterpartOf` result gains `avatar: UserAvatar | null`; `ChargeRepository.counterpartAvatar(db: DbClient, row: Row, userId: string): Promise<UserAvatar | null>`; DTOs fill `Contact.avatar`, `LinkableContact.avatar`, `ChargeSummary.counterpartAvatar`, `ChargeCounterpart.avatar`, `BillingPayee.avatar`, `BillingGuest.avatar` with signed URLs in every authenticated response.

- [ ] **Step 1: Write the failing integration test**

`packages/api/test/account/avatar-people.spec.ts`:

```ts
import { deepEqual, equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

const owner = '61000000-0000-4000-8000-0000000000b1';
const debtor = '61000000-0000-4000-8000-0000000000b2';
const version = '2026-09-13T12:00:00.000Z';

describe('avatars on people', () => {
  let chargeId = '';

  before(async () => {
    await cleanupUsers(db, [owner, debtor]);
    await createUser(db, { id: owner, email: 'owner-avatar@example.test', name: 'Dona' });
    await createUser(db, { id: debtor, email: 'debtor-avatar@example.test', name: 'Devedor' });
    await db.users.updateOne({ where: { id: debtor }, data: { avatar_updated_at: version } });
    chargeId = (await createOnceCharge({ ownerId: owner, debtorId: debtor })).id;
  });

  after(async () => {
    await cleanupUsers(db, [owner, debtor]);
  });

  it('references the debtor photo on the charge detail and the owner timeline', async () => {
    const expected = { url: `avatars/${debtor}`, version };
    const detail = await ChargeRepository.get(db, owner, chargeId);

    deepEqual(detail.recipient.avatar, expected);
    deepEqual(detail.counterpartAvatar, expected);

    const page = await TimelineRepository.list(db, owner, {});
    const item = page.items.find((entry) => entry.charge.id === chargeId);

    deepEqual(item?.charge.counterpartAvatar, expected);
  });

  it('references no photo for a person without one', async () => {
    const detail = await ChargeRepository.get(db, debtor, chargeId);

    equal(detail.counterpartAvatar, null);
  });

  it('references the photo on the owner contact', async () => {
    const person = await ContactRepository.counterpartOf(db, debtor);

    deepEqual(person?.avatar, { url: `avatars/${debtor}`, version });
  });
});
```

Before running, open `test/fixtures/financial.ts` and `timeline/repositories/timeline.ts` and adapt the helper names to the real ones (`createOnceCharge`'s input shape, the charge detail getter — `ChargeRepository.get` or the function `charges/endpoints/get.ts` calls — and the timeline listing function with its filters argument). Keep the assertions.

- [ ] **Step 2: Run it to see it fail**

Run (only with `receivy-pg` up): `pnpm --filter @receivy/api test:integration`
Expected: FAIL on `avatar` / `counterpartAvatar` being `undefined`. Without the database, run `pnpm --filter @receivy/api check-types:test` and expect FAIL on the missing `avatar` property of `counterpartOf`.

- [ ] **Step 3: Contacts**

`contacts/repositories/contact.ts`:
- `USER_SELECT`: add `avatar_updated_at: true`.
- In `details`, add to each returned contact, after `displayName: row.nickname || name,`: `avatar: user.status === UserStatus.Removed ? null : AvatarRepository.ref(user.id, user.avatar_updated_at),`.
- `linkable`: select `u.id AS user_id, u.avatar_updated_at` in the SQL and map
  `avatar: AvatarRepository.ref(String(row['user_id']), row['avatar_updated_at'] as string | Date | null)`.
- `counterpartOf`: return type gains `avatar: UserAvatar | null`; value `user.status === UserStatus.Removed ? null : AvatarRepository.ref(user.id, user.avatar_updated_at)`.

Import `AvatarRepository` from `'../../users/repositories/avatar'` and `type UserAvatar` from `@receivy/common`. After editing, run `pnpm --filter @receivy/api test -- import-cycles` — if the new import creates a cycle, move nothing else; `users/repositories/avatar.ts` imports only `@ez4/*`, `@receivy/common`, `../../database` types and `../errors`, so it must stay a leaf.

- [ ] **Step 4: Charges and timeline**

`charges/repositories/charge.ts`:
- `recipientOf`: `{ userId: row.debtor_user_id!, name: person.name, email: person.email, avatar: person.avatar }` for the person; `{ userId: null, name: owner?.name ?? 'Conta excluída', email: null, avatar: owner?.avatar ?? null }` for the owner's own bill.
- Add inside the namespace, right after `counterpartName`:

```ts
  /** Photo of the person `counterpartName` names; null on a bill that is the owner's alone. */
  export async function counterpartAvatar(db: DbClient, row: Row, userId: string): Promise<UserAvatar | null> {
    const otherId = owns(row, userId) ? row.debtor_user_id : row.creditor_id;

    if (!otherId) {
      return null;
    }

    return (await ContactRepository.counterpartOf(db, otherId))?.avatar ?? null;
  }
```

- `dto`: after `counterpartName: await counterpartName(db, row, userId),` add `counterpartAvatar: await counterpartAvatar(db, row, userId),`.

`timeline/repositories/timeline.ts`: in the charge mapping, after `counterpartName: await ChargeRepository.counterpartName(db, row, userId),` add `counterpartAvatar: await ChargeRepository.counterpartAvatar(db, row, userId),`.

- [ ] **Step 5: Billings**

`billings/repositories/billing.ts`:
- `payeeOf`: `return person ? { userId: row.payee_user_id, name: person.name, avatar: person.avatar } : null;`
- `waitingGuests`: add `avatar_updated_at: true` to the users select and `avatar: AvatarRepository.ref(user.id, user.avatar_updated_at)` to each guest object.

- [ ] **Step 6: Providers and endpoints sign the body**

Add `proofFiles: Environment.Service<ProofFiles>;` (import `type { ProofFiles } from '../storage'`) to the `services` of `ContactProvider`, `ChargeProvider`, `BillingProvider` and `TimelineProvider` (`ProofProvider` already has it).

In every endpoint listed under **Files**, destructure `proofFiles` from the context and wrap the body. Example — `charges/endpoints/get.ts` turns

```ts
return { status: 200, body: await ChargeRepository.get(db, request.identity.userId, request.parameters.id) };
```

into

```ts
return { status: 200, body: await AvatarRepository.sign(proofFiles, await ChargeRepository.get(db, request.identity.userId, request.parameters.id)) };
```

The rule for the implementer: an authenticated endpoint whose response type contains `ChargeDetail`, `ChargeSummary`, `TimelinePage`, `ContactLedger`, `Contact`, `ContactsPage` or `BillingDetail` signs its body. Find them with
`grep -rln "ChargeDetail\|TimelinePage\|ContactLedger\|Contact\b\|ContactsPage\|BillingDetail" packages/api/src/*/endpoints`
and list in the report every endpoint changed and every match deliberately skipped (public endpoints, `BillingsPage`, `InviteAcceptResult`).

- [ ] **Step 7: Run tests, regenerate OpenAPI, verify**

Run: `pnpm --filter @receivy/api openapi:generate && pnpm --filter @receivy/api openapi:check`
Run: `pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api lint && pnpm --filter @receivy/api test`
Run with `receivy-pg` up: `pnpm --filter @receivy/api test:integration`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api docs/api-oas.yml
git commit -m "feat(api): signed avatars for counterparts, contacts, guests and payees"
```

---

### Task 4: API — adopt the Google picture once

**Files:**
- Create: `packages/api/src/users/services/provider-picture.ts`, `packages/api/src/users/services/provider-picture.test.ts`
- Modify: `packages/api/src/users/endpoints/google-callback.ts`

**Interfaces:**
- Consumes: Task 2 `AvatarRepository.key`, `AVATAR_MAX_BYTES`.
- Produces: `adoptProviderPicture(input: { db: DbClient; bucket: Client; userId: string; picture: string | undefined; fetcher?: typeof fetch; now?: Date }): Promise<boolean>` — `true` when a photo was stored.

- [ ] **Step 1: Write the failing unit test**

`packages/api/src/users/services/provider-picture.test.ts`:

```ts
import type { Client } from '@ez4/storage';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import { adoptProviderPicture } from './provider-picture';

function fakes(avatarUpdatedAt?: string) {
  const db = {
    users: {
      findOne: vi.fn(async () => ({ id: 'u1', avatar_updated_at: avatarUpdatedAt })),
      updateOne: vi.fn(async () => undefined)
    }
  } as unknown as DbClient;
  const bucket = { write: vi.fn(async () => undefined) } as unknown as Client;

  return { db, bucket };
}

function image(type = 'image/jpeg', bytes = 10) {
  return vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } })) as unknown as typeof fetch;
}

describe('adoptProviderPicture', () => {
  it('stores the picture for a user without photo', async () => {
    const { db, bucket } = fakes();
    const stored = await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'https://lh3.test/p.jpg', fetcher: image() });

    expect(stored).toBe(true);
    expect(bucket.write).toHaveBeenCalledWith('avatars/u1', expect.any(Buffer), { contentType: 'image/jpeg' });
    expect(db.users.updateOne).toHaveBeenCalled();
  });

  it('never replaces an existing photo', async () => {
    const { db, bucket } = fakes('2026-01-01T00:00:00.000Z');
    const fetcher = image();

    expect(await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'https://lh3.test/p.jpg', fetcher })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ignores missing, insecure, non-image, oversized and failing pictures', async () => {
    const { db, bucket } = fakes();

    expect(await adoptProviderPicture({ db, bucket, userId: 'u1', picture: undefined, fetcher: image() })).toBe(false);
    expect(await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'http://lh3.test/p.jpg', fetcher: image() })).toBe(false);
    expect(await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'https://lh3.test/p', fetcher: image('text/html') })).toBe(false);
    expect(await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'https://lh3.test/p', fetcher: image('image/png', 3 * 1024 * 1024) })).toBe(false);
    expect(
      await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'https://lh3.test/p', fetcher: vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch })
    ).toBe(false);
    expect(bucket.write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @receivy/api test -- provider-picture`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/api/src/users/services/provider-picture.ts`:

```ts
import type { Client } from '@ez4/storage';
import { AVATAR_MAX_BYTES } from '@receivy/common';
import type { DbClient } from '../../database';
import { AvatarRepository } from '../repositories/avatar';

const TIMEOUT_MS = 3000;

type AdoptInput = { db: DbClient; bucket: Client; userId: string; picture: string | undefined; fetcher?: typeof fetch; now?: Date };

/**
 * Copies the OAuth provider's picture into `avatars/<id>` for a user who has no photo yet. Best effort: the login
 * that calls it must never fail because of the picture, so every problem ends in `false`.
 */
export async function adoptProviderPicture({ db, bucket, userId, picture, fetcher = fetch, now = new Date() }: AdoptInput): Promise<boolean> {
  if (!picture?.startsWith('https://')) {
    return false;
  }

  try {
    const user = await db.users.findOne({ select: { id: true, avatar_updated_at: true }, where: { id: userId, deleted_at: { isNull: true } } });

    if (!user || user.avatar_updated_at) {
      return false;
    }

    const response = await fetcher(picture, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';

    if (!response.ok || !type.startsWith('image/')) {
      return false;
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (!bytes.length || bytes.length > AVATAR_MAX_BYTES) {
      return false;
    }

    const instant = now.toISOString();

    await bucket.write(AvatarRepository.key(userId), bytes, { contentType: type });
    await db.users.updateOne({ where: { id: userId }, data: { avatar_updated_at: instant, updated_at: instant } });

    return true;
  } catch {
    // Counts only: no URL, no user data.
    console.warn('Provider picture skipped');
    return false;
  }
}
```

If `WriteOptions` in `@ez4/storage` does not accept `contentType`, check its fields in `node_modules/@ez4/storage/dist/services/client.d.ts` and use the equivalent; adjust the test expectation to the same shape.

`users/endpoints/google-callback.ts`: destructure `{ db, variables, proofFiles }` and replace `repo: AuthRepository.create(db),` with a repository whose `resolveUser` adopts the picture after the user is resolved:

```ts
    const repository = AuthRepository.create(db);
    const result = await completeOauth(
      {
        code: request.query.code,
        error: request.query.error,
        provider: OauthProvider.Google,
        state: request.query.state
      },
      {
        providerClient: dependencies.client,
        repo: {
          ...repository,
          resolveUser: async (input) => {
            const user = await repository.resolveUser(input);

            await adoptProviderPicture({ db, bucket: proofFiles, userId: user.id, picture: input.identity.picture });

            return user;
          }
        },
        commitGrant: (input) => commitOauthIdentity(db, input)
      }
    );
```

(`const repository` goes right before the existing `try {` block's `completeOauth` call, inside `try`.) Apple does not send a picture; its handlers stay unchanged.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @receivy/api test && pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api lint && pnpm --filter @receivy/api openapi:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/users
git commit -m "feat(api): adopt the Google picture when the user has no photo"
```

---

### Task 5: web — category icons and photos in place of initials

**Files:**
- Modify: `packages/web/src/components/ui/category-icon.tsx`, `packages/web/src/components/ui/initials-avatar.tsx`
- Create: `packages/web/src/components/ui/initials-avatar.test.tsx`
- Modify: `packages/web/src/components/app/split-editor.tsx`, `packages/web/src/components/app/contact-picker-sheet.tsx`, `packages/web/src/components/forms/billing-form-screen.tsx`, `packages/web/src/components/screens/feed-screen.tsx`, `packages/web/src/components/screens/charge-detail-screen.tsx`, `packages/web/src/components/screens/billing-detail-screen.tsx`, `packages/web/src/components/screens/contacts-screen.tsx`, `packages/web/src/components/screens/contact-ledger-screen.tsx`

**Interfaces:**
- Consumes: Task 1 categories and optional avatar fields.
- Produces: `InitialsAvatar({ name, size?, inverted?, avatar?: UserAvatar | null })`; `SplitRow.avatar?: UserAvatar | null`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/components/ui/initials-avatar.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

afterEach(cleanup);

it("shows the initial without a photo", () => {
  const { container } = render(<InitialsAvatar name="ana" size={40} />);

  expect(container.textContent).toBe("A");
  expect(container.querySelector("img")).toBeNull();
});

it("shows the photo and falls back to the initial when it fails", () => {
  const { container } = render(<InitialsAvatar name="ana" size={40} avatar={{ url: "https://bucket.test/avatars/u1", version: "v1" }} />);
  const image = container.querySelector("img");

  expect(image?.getAttribute("src")).toBe("https://bucket.test/avatars/u1");
  expect(image?.getAttribute("width")).toBe("40");

  fireEvent.error(image!);

  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("A");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @receivy/web test -- initials-avatar`
Expected: FAIL — no `img` rendered.

- [ ] **Step 3: Implement the avatar and the icons**

`initials-avatar.tsx` (keep `initialOf` exported):

```tsx
"use client";

import type { UserAvatar } from "@receivy/common";
import { useState } from "react";

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
}

type InitialsAvatarProps = {
  name: string;
  /** Diameter in pixels; the letter scales with it. */
  size?: number;
  inverted?: boolean;
  /** The person's photo; the initial shows when absent or when the image fails to load. */
  avatar?: UserAvatar | null;
};

/** Round monogram used by contact chips, the picker and the split rows; the photo takes its place when there is one. */
export function InitialsAvatar({ name, size = 28, inverted = false, avatar }: InitialsAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);

  if (avatar && failed !== avatar.url) {
    return (
      // A signed bucket URL that changes on every response: nothing for next/image to optimise or cache.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar.url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        onError={() => setFailed(avatar.url)}
        className="shrink-0 rounded-full bg-primary-soft/60 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold ${inverted ? "bg-primary text-on-primary" : "bg-primary-soft/60 text-primary-strong"}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initialOf(name)}
    </span>
  );
}
```

`category-icon.tsx`: import `GraduationCap, HeartPulse, Ticket` from `lucide-react` (keep alphabetical order in the import) and add to `CATEGORY_ICONS` after `travel: Plane,`:

```tsx
  health: HeartPulse,
  education: GraduationCap,
  leisure: Ticket,
```

- [ ] **Step 4: Pass the photo at every use**

- `split-editor.tsx`: `SplitRow` gains `avatar?: UserAvatar | null;` (import `type UserAvatar`); render `<InitialsAvatar name={row.name} avatar={row.avatar} />`.
- `billing-form-screen.tsx`: in the `rows` mapping add `avatar: key === "owner" ? null : contactFor(key).avatar,` after `name: nameOf(key),`; the payee chip `<InitialsAvatar name={payee.displayName} size={24} avatar={payee.avatar} />`; the contact chip at the `contact.displayName` 24px avatar gets `avatar={contact.avatar}`. The `"Eu"` chip stays unchanged.
- `contact-picker-sheet.tsx`: `<InitialsAvatar name={contact.displayName} size={36} avatar={contact.avatar} />`.
- `feed-screen.tsx`: `<InitialsAvatar name={charge.counterpartName} size={44} avatar={charge.counterpartAvatar} />`.
- `charge-detail-screen.tsx`: `<InitialsAvatar name={charge.recipient.name} size={40} avatar={charge.recipient.avatar} />`.
- `billing-detail-screen.tsx`:
  - guests: `<InitialsAvatar name={guest.name} size={40} avatar={guest.avatar} />`;
  - participants: next to `const name = …` add `const avatar = payable ? (billing.payee?.avatar ?? null) : charge.recipient.avatar;` and render `<InitialsAvatar name={name} size={40} avatar={avatar} />`;
  - share links: `<InitialsAvatar name={charge.recipient.name} size={36} avatar={charge.recipient.avatar} />`.
- `contacts-screen.tsx` (`ContactCard`): replace the monogram `<span …>{initialsOf(contact.displayName)}</span>` with
  ```tsx
  {contact.avatar ? (
    <InitialsAvatar name={contact.displayName} size={44} avatar={contact.avatar} />
  ) : (
    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-extrabold text-primary-strong">
      {initialsOf(contact.displayName)}
    </span>
  )}
  ```
  (import `InitialsAvatar` from `@/components/ui/initials-avatar`).
- `contact-ledger-screen.tsx` (profile header): same pattern with `size={80}` and wrapping the image in `<span className="mb-3 rounded-full border-2 border-surface">…</span>` so the border and spacing stay; the existing span stays as the else branch.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @receivy/web test && pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint`
Expected: PASS (the `theme-tokens` guard included).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): new category icons and profile photos in place of initials"
```

---

### Task 6: web — change the photo in Perfil

**Files:**
- Create: `packages/web/src/lib/avatar-upload.ts`, `packages/web/src/lib/avatar-upload.test.ts`
- Modify: `packages/web/src/lib/financial-proxy.ts`, `packages/web/src/components/screens/profile-screen.tsx`, `packages/web/src/components/screens/profile-screen.test.tsx`

**Interfaces:**
- Consumes: Task 2 routes; Task 1 `AvatarMime`, `AvatarUploadTicket`, `UserAvatar`, `AVATAR_INVALID_MESSAGE`; Task 5 `InitialsAvatar` with `avatar`.
- Produces: `squareJpeg(file: File, edge?: number): Promise<Blob>`; `uploadAvatar(blob: Blob): Promise<UserAvatar>`.

- [ ] **Step 1: Write the failing tests**

`packages/web/src/lib/avatar-upload.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { uploadAvatar } from "./avatar-upload";

afterEach(() => vi.restoreAllMocks());

it("reserves, puts the bytes and completes the upload", async () => {
  const blob = new Blob(["jpeg"], { type: "image/jpeg" });
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (url === "/api/financial/account/avatar") return Response.json({ uploadUrl: "https://bucket.test/put", expiresAt: "2026-09-13T12:05:00.000Z" });
    if (url === "https://bucket.test/put") return new Response(null, { status: 200 });
    if (url === "/api/financial/account/avatar/complete") return Response.json({ avatar: { url: "https://bucket.test/get", version: "v2" } });
    throw new Error(`unexpected ${String(url)} ${init?.method}`);
  });

  await expect(uploadAvatar(blob)).resolves.toEqual({ url: "https://bucket.test/get", version: "v2" });

  expect(fetcher.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toEqual([
    "POST /api/financial/account/avatar",
    "PUT https://bucket.test/put",
    "POST /api/financial/account/avatar/complete",
  ]);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ mime: "image/jpeg" });
});

it("explains a rejected file", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (url === "/api/financial/account/avatar") return Response.json({ uploadUrl: "https://bucket.test/put", expiresAt: "x" });
    if (url === "https://bucket.test/put") return new Response(null, { status: 200 });
    return Response.json({ message: "Envie uma imagem JPG ou PNG de até 2 MB." }, { status: 422 });
  });

  await expect(uploadAvatar(new Blob(["x"], { type: "image/jpeg" }))).rejects.toThrow("Envie uma imagem JPG ou PNG de até 2 MB.");
});
```

If `browserFetch` (used below) adds retries or headers that change the recorded calls, spy on `browserFetch`'s module instead and keep the same expectations.

In `profile-screen.test.tsx`, add a test: render the screen with `/api/auth/me` answering a user with `avatar: null`; `vi.mock("@/lib/avatar-upload", () => ({ squareJpeg: vi.fn(async () => new Blob(["j"], { type: "image/jpeg" })), uploadAvatar: vi.fn(async () => ({ url: "https://bucket.test/new", version: "v3" })) }))`; change the hidden input labelled `Trocar foto` with a PNG `File`; expect `await screen.findByRole("img", { hidden: true })` (or `container.querySelector("img")`) to have `src` `https://bucket.test/new`. Follow the file's existing render/fetch mocking helpers.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @receivy/web test -- avatar-upload profile-screen`
Expected: FAIL — module missing, no `Trocar foto` control.

- [ ] **Step 3: Implement the upload library**

`packages/web/src/lib/avatar-upload.ts`:

```ts
import { AVATAR_INVALID_MESSAGE, AvatarMime, type AvatarUploadTicket, type UserAvatar } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const EDGE = 512;
const QUALITY = 0.85;

/** Centre-crops the picked image to a square and re-encodes it as a JPEG small enough for the 2 MB limit. */
export async function squareJpeg(file: File, edge = EDGE): Promise<Blob> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(AVATAR_INVALID_MESSAGE);
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");

  canvas.width = edge;
  canvas.height = edge;
  canvas.getContext("2d")?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, AvatarMime.Jpeg, QUALITY));

  if (!blob) {
    throw new Error(AVATAR_INVALID_MESSAGE);
  }

  return blob;
}

/** Reserve, signed PUT, then complete: the same three steps as a proof upload. */
export async function uploadAvatar(blob: Blob): Promise<UserAvatar> {
  const reserve = await browserFetch("/api/financial/account/avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mime: AvatarMime.Jpeg }),
  });

  if (!reserve.ok) {
    throw new Error(await responseMessage(reserve, "Não foi possível trocar a foto."));
  }

  const ticket = (await reserve.json()) as AvatarUploadTicket;
  const put = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": AvatarMime.Jpeg }, body: blob, credentials: "omit", referrerPolicy: "no-referrer" });

  if (!put.ok) {
    throw new Error("A foto não foi enviada. Tente novamente.");
  }

  const complete = await browserFetch("/api/financial/account/avatar/complete", { method: "POST" });

  if (!complete.ok) {
    throw new Error(await responseMessage(complete, AVATAR_INVALID_MESSAGE));
  }

  return ((await complete.json()) as { avatar: UserAvatar }).avatar;
}
```

`financial-proxy.ts` `ALLOWED_ROUTES`: next to the `account/profile` entry add `["POST", /^account\/avatar(?:\/complete)?$/],`. The existing `openapi-contract.test.ts` proves the route exists in `docs/api-oas.yml` (Task 2).

- [ ] **Step 4: Pencil over the photo in Perfil**

`profile-screen.tsx`:
- Imports: add `Loader2` to the lucide import (keep `Pencil`), `import { squareJpeg, uploadAvatar } from "@/lib/avatar-upload";`.
- State: `const [photoBusy, setPhotoBusy] = useState(false);` and `const [photoError, setPhotoError] = useState("");`.
- Handler:

```tsx
  async function changePhoto(file: File | undefined) {
    if (!file || !user) {
      return;
    }

    setPhotoBusy(true);
    setPhotoError("");

    try {
      const avatar = await uploadAvatar(await squareJpeg(file));

      setUser({ ...user, avatar });
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "Não foi possível trocar a foto.");
    } finally {
      setPhotoBusy(false);
    }
  }
```

- Replace `<InitialsAvatar name={initial} size={96} />` with:

```tsx
            <div className="relative h-24 w-24">
              <InitialsAvatar name={initial} size={96} avatar={user.avatar} />

              <label
                className={`absolute inset-0 m-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-surface/90 text-primary-strong shadow-md transition hover:bg-surface has-disabled:cursor-not-allowed has-focus-visible:ring-2 has-focus-visible:ring-primary ${photoBusy ? "opacity-90" : ""}`}
              >
                {photoBusy ? <Loader2 size={18} aria-hidden="true" className="animate-spin" /> : <Pencil size={18} aria-hidden="true" />}
                <span className="sr-only">{photoBusy ? "Enviando foto…" : "Trocar foto"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  aria-label="Trocar foto"
                  disabled={photoBusy}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    event.target.value = "";
                    void changePhoto(file);
                  }}
                />
              </label>
            </div>

            {photoError && (
              <p role="alert" className="m-0 rounded-xl bg-danger-soft px-3 py-2 text-center text-sm text-danger">
                {photoError}
              </p>
            )}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @receivy/web test && pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): change the profile photo from Perfil"
```

---

### Task 7: mobile — category icons and photos in place of initials

**Files:**
- Create: `packages/mobile/assets/images/categories/health.svg`, `education.svg`, `leisure.svg`, `packages/mobile/src/components/ui/initials-avatar.test.tsx`
- Modify: `packages/mobile/src/components/ui/category-icon.tsx`, `packages/mobile/src/components/ui/initials-avatar.tsx`, `packages/mobile/src/components/app/split-editor.tsx`, `packages/mobile/src/components/app/contact-picker-sheet.tsx`, `packages/mobile/src/components/forms/billing-form-screen.tsx`, `packages/mobile/src/components/screens/feed-screen.tsx`, `packages/mobile/src/components/screens/charge-detail-screen.tsx`, `packages/mobile/src/components/screens/billing-detail-screen.tsx`, `packages/mobile/src/components/screens/contacts-screen.tsx`, `packages/mobile/src/components/screens/contact-ledger-screen.tsx`

**Interfaces:**
- Consumes: Task 1 categories and optional avatar fields.
- Produces: mobile `InitialsAvatar({ name, size?, inverted?, avatar?: UserAvatar | null })`, `avatarCacheKey(avatar: UserAvatar): string`; `SplitRow.avatar?: UserAvatar | null`.

- [ ] **Step 1: SVG icons**

`health.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/></svg>
```

`education.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>
```

`leisure.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>
```

`category-icon.tsx`: add after the `travel` entry:

```tsx
  health: require("../../../assets/images/categories/health.svg"),
  education: require("../../../assets/images/categories/education.svg"),
  leisure: require("../../../assets/images/categories/leisure.svg"),
```

- [ ] **Step 2: Write the failing avatar test**

`packages/mobile/src/components/ui/initials-avatar.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { avatarCacheKey, InitialsAvatar } from "@/components/ui/initials-avatar";

it("shows the initial without a photo", async () => {
  await render(<InitialsAvatar name="ana" size={40} />);

  expect(screen.getByText("A")).toBeTruthy();
});

it("shows the photo keyed on the object and version, and falls back on error", async () => {
  const avatar = { url: "https://bucket.test/avatars/u1?X-Amz-Signature=abc", version: "v1" };

  await render(<InitialsAvatar name="ana" size={40} avatar={avatar} />);

  const image = screen.getByTestId("initials-avatar-photo");

  expect(image.props.source).toEqual({ uri: avatar.url, cacheKey: "/avatars/u1:v1" });
  expect(screen.queryByText("A")).toBeNull();

  await fireEvent(image, "error");

  expect(screen.getByText("A")).toBeTruthy();
});

it("builds the cache key without the signature", () => {
  expect(avatarCacheKey({ url: "https://bucket.test/avatars/u2?sig=1", version: "2026" })).toBe("/avatars/u2:2026");
});
```

Run: `pnpm --filter @receivy/mobile test -- initials-avatar`
Expected: FAIL — `avatarCacheKey` missing.

- [ ] **Step 3: Implement the avatar**

`packages/mobile/src/components/ui/initials-avatar.tsx`:

```tsx
import type { UserAvatar } from "@receivy/common";
import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
}

/** The signed URL changes on every response; the object path plus version only changes with the photo. */
export function avatarCacheKey(avatar: UserAvatar): string {
  const path = avatar.url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?", 1)[0] ?? avatar.url;

  return `${path}:${avatar.version}`;
}

type InitialsAvatarProps = {
  name: string;
  /** Diameter in pixels; the letter scales with it. */
  size?: number;
  inverted?: boolean;
  /** The person's photo; the initial shows when absent or when the image fails to load. */
  avatar?: UserAvatar | null;
};

/** Round monogram used by contact chips, the picker and the split rows; the photo takes its place when there is one. */
export function InitialsAvatar({ name, size = 28, inverted = false, avatar }: InitialsAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);

  if (avatar && failed !== avatar.url) {
    return (
      <Image
        testID="initials-avatar-photo"
        source={{ uri: avatar.url, cacheKey: avatarCacheKey(avatar) }}
        onError={() => setFailed(avatar.url)}
        contentFit="cover"
        className="rounded-full bg-primary-soft/60"
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  return (
    <View
      className={`items-center justify-center rounded-full ${inverted ? "bg-primary" : "bg-primary-soft/60"}`}
      style={{ width: size, height: size }}
    >
      <Text className={`font-extrabold ${inverted ? "text-on-primary" : "text-primary-strong"}`} style={{ fontSize: size * 0.42 }}>
        {initialOf(name)}
      </Text>
    </View>
  );
}
```

If `expo-image`'s `Image` does not accept `className` under Uniwind in this project, drop `className` and keep the `style` (other files use `style` with `Image`).

- [ ] **Step 4: Pass the photo at every use**

- `split-editor.tsx`: `SplitRow` gains `avatar?: UserAvatar | null;`; render `<InitialsAvatar name={row.name} avatar={row.avatar} />`.
- `billing-form-screen.tsx`: `rows` mapping adds `avatar: key === "owner" ? null : (directory.find((contact) => contact.userId === key)?.avatar ?? null),`; payee chip `avatar={payee.avatar}`; contact chip (24px, `contact.displayName`) `avatar={contact.avatar}`; `"Eu"` unchanged.
- `contact-picker-sheet.tsx`: `avatar={contact.avatar}`.
- `feed-screen.tsx` (`ChargeCard`): replace the `View h-11 w-11 …` monogram with
  ```tsx
  {charge.counterpartAvatar ? (
    <InitialsAvatar name={charge.counterpartName} size={44} avatar={charge.counterpartAvatar} />
  ) : (
    <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft/50">
      <Text className="text-base font-extrabold text-primary-strong">{charge.counterpartName.slice(0, 1).toUpperCase()}</Text>
    </View>
  )}
  ```
- `charge-detail-screen.tsx`: `<InitialsAvatar name={name} size={40} avatar={charge.counterpartAvatar ?? charge.recipient.avatar} />` (matches `const name = charge.counterpartName || charge.recipient.name`).
- `billing-detail-screen.tsx`: participants — next to `const name = …` add `const avatar = payable ? (billing.payee?.avatar ?? null) : charge.recipient.avatar;` and pass `avatar={avatar}`; share links `avatar={charge.recipient.avatar}`. Guests have no monogram on mobile; leave them.
- `contacts-screen.tsx`: same conditional as the feed with `size={44}` and the existing `View h-11 w-11 … bg-primary-soft` as the else branch.
- `contact-ledger-screen.tsx`: conditional with `size={80}`; wrap the photo in `<View className="mb-3 rounded-full border-2 border-surface">…</View>`; the existing monogram `View` is the else branch.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @receivy/mobile test && pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint`
Expected: PASS (the `theme-tokens` guard included).

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/assets/images/categories packages/mobile/src
git commit -m "feat(mobile): new category icons and profile photos in place of initials"
```

---

### Task 8: mobile — change the photo in Perfil

**Files:**
- Modify: `packages/mobile/package.json`, `pnpm-lock.yaml` (via `npx expo install`), `packages/mobile/app.json`, `packages/mobile/jest.setup.ts`, `packages/mobile/src/account/client.ts`, `packages/mobile/src/components/screens/profile-screen.tsx`, `packages/mobile/src/components/screens/profile-screen.test.tsx`
- Create: `packages/mobile/src/account/avatar.ts`, `packages/mobile/src/account/avatar.test.ts`

**Interfaces:**
- Consumes: Task 2 routes; Task 1 `AvatarMime`, `isAvatarUpload`, `AVATAR_INVALID_MESSAGE`, `UserAvatar`, `AvatarUploadTicket`; Task 7 `InitialsAvatar`.
- Produces: `accountClient.startAvatarUpload(mime: AvatarMime): Promise<AvatarUploadTicket>`, `accountClient.completeAvatarUpload(): Promise<UserAvatar>`; `pickAndUploadAvatar(client: Pick<AccountClient, "startAvatarUpload" | "completeAvatarUpload">): Promise<UserAvatar | null>`.

- [ ] **Step 1: Add the approved dependency and native config**

Run: `cd packages/mobile && npx expo install expo-image-picker`
`app.json` `plugins`: after `"expo-secure-store",` add

```json
      [
        "expo-image-picker",
        {
          "photosPermission": "O Receivy usa suas fotos para trocar a foto do perfil.",
          "cameraPermission": false,
          "microphonePermission": false
        }
      ],
```

`jest.setup.ts`, at the end:

```ts
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
```

- [ ] **Step 2: Write the failing tests**

`packages/mobile/src/account/avatar.test.ts`:

```ts
import * as ImagePicker from "expo-image-picker";
import { pickAndUploadAvatar } from "@/account/avatar";

jest.mock("expo/fetch", () => ({ fetch: jest.fn(async () => ({ ok: true })) }));
jest.mock("expo-file-system", () => ({ File: jest.fn().mockImplementation((uri: string) => ({ uri })) }));

const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;

function client() {
  return {
    startAvatarUpload: jest.fn(async () => ({ uploadUrl: "https://bucket.test/put", expiresAt: "x" })),
    completeAvatarUpload: jest.fn(async () => ({ url: "https://bucket.test/get", version: "v1" })),
  };
}

it("returns null when the picker is cancelled", async () => {
  launch.mockResolvedValueOnce({ canceled: true, assets: null });

  await expect(pickAndUploadAvatar(client())).resolves.toBeNull();
});

it("opens a square editor and uploads the picked image", async () => {
  const api = client();
  launch.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///p.jpg", mimeType: "image/jpeg", fileSize: 2048, width: 1, height: 1 }] });

  await expect(pickAndUploadAvatar(api)).resolves.toEqual({ url: "https://bucket.test/get", version: "v1" });

  expect(launch).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
  expect(api.startAvatarUpload).toHaveBeenCalledWith("image/jpeg");
  expect(api.completeAvatarUpload).toHaveBeenCalled();
});

it("rejects files the API would refuse without calling it", async () => {
  const api = client();
  launch.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///p.heic", mimeType: "image/heic", fileSize: 2048, width: 1, height: 1 }] });

  await expect(pickAndUploadAvatar(api)).rejects.toThrow("Envie uma imagem JPG ou PNG de até 2 MB.");
  expect(api.startAvatarUpload).not.toHaveBeenCalled();
});
```

In `profile-screen.test.tsx`, add a test that mocks `@/account/avatar` (`pickAndUploadAvatar: jest.fn(async () => ({ url: "https://bucket.test/new", version: "v2" }))`), renders the screen with a client whose `profile` resolves a user with `avatar: null`, presses the `Trocar foto` button and expects `screen.getByTestId("initials-avatar-photo").props.source.uri` to be `https://bucket.test/new`. Use the file's existing client doubles and `await` on RNTL events.

Run: `pnpm --filter @receivy/mobile test -- account/avatar profile-screen`
Expected: FAIL — module missing, no `Trocar foto`.

- [ ] **Step 3: Implement client and picker flow**

`src/account/client.ts`: add to `accountClient` (keep the one-line style of the file):

```ts
  startAvatarUpload: (mime: AvatarMime) => request<AvatarUploadTicket>("account/avatar", { method: "POST", body: JSON.stringify({ mime }) }),
  completeAvatarUpload: async () => (await request<{ avatar: UserAvatar }>("account/avatar/complete", { method: "POST" })).avatar,
```

and extend the type import with `AvatarMime, AvatarUploadTicket, UserAvatar`.

`src/account/avatar.ts`:

```ts
import { AVATAR_INVALID_MESSAGE, type AvatarMime, isAvatarUpload, type UserAvatar } from "@receivy/common";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import * as ImagePicker from "expo-image-picker";
import type { AccountClient } from "./client";

/** Must be called directly from a user-triggered action. Resolves with the new photo, or null when nothing was picked. */
export async function pickAndUploadAvatar(client: Pick<AccountClient, "startAvatarUpload" | "completeAvatarUpload">): Promise<UserAvatar | null> {
  // `aspect` only applies on Android; the iOS editor is always square.
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];

  if (!asset) {
    return null;
  }

  const file = new File(asset.uri);
  const size = asset.fileSize ?? file.size;

  if (!isAvatarUpload(asset.mimeType, size)) {
    throw new Error(AVATAR_INVALID_MESSAGE);
  }

  const mime = asset.mimeType as AvatarMime;
  const ticket = await client.startAvatarUpload(mime);
  const response = await expoFetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": mime }, body: file });

  if (!response.ok) {
    throw new Error("A foto não foi enviada. Tente novamente.");
  }

  return client.completeAvatarUpload();
}
```

- [ ] **Step 4: Pencil over the photo in Perfil**

`profile-screen.tsx`:
- `ProfileScreenProps.client` becomes `Pick<AccountClient, "profile" | "save" | "logout" | "erase" | "startAvatarUpload" | "completeAvatarUpload">`.
- Imports: `ActivityIndicator` from `react-native`; `InitialsAvatar` from `@/components/ui/initials-avatar`; `pickAndUploadAvatar` from `@/account/avatar`.
- State: `const [photoBusy, setPhotoBusy] = useState(false);`.
- Handler:

```tsx
  async function changePhoto() {
    if (!user) {
      return;
    }

    setPhotoBusy(true);
    setNotice("");

    try {
      const avatar = await pickAndUploadAvatar(client);

      if (avatar) {
        setUser({ ...user, avatar });
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Não foi possível trocar a foto.");
    } finally {
      setPhotoBusy(false);
    }
  }
```

- Replace the `View h-24 w-24 …` monogram block with:

```tsx
                <View className="h-24 w-24 items-center justify-center">
                  <InitialsAvatar name={user.name?.trim() || "R"} size={96} avatar={user.avatar} />

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Trocar foto"
                    accessibilityState={{ disabled: photoBusy, busy: photoBusy }}
                    disabled={photoBusy}
                    onPress={() => void changePhoto()}
                    className="absolute h-10 w-10 items-center justify-center rounded-full bg-surface/90"
                  >
                    {photoBusy ? (
                      <ActivityIndicator color={colors.primaryStrong} />
                    ) : (
                      <Image source={ICONS.edit} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
                    )}
                  </Pressable>
                </View>
```

Delete the now-unused `initial` constant only if nothing else uses it.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @receivy/mobile test && pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mobile pnpm-lock.yaml
git commit -m "feat(mobile): change the profile photo from Perfil"
```

---

### Task 9: QA script, note and final verification

**Files:**
- Modify: `docs/manual-qa-script.md` (new section before `## Divergências`, next number after the last section)
- Modify: `~/Projects/ai-rules/notes/receivy.md` (append one line; separate repository, do not commit it)

- [ ] **Step 1: QA section**

```md
## 19. Categorias e foto de perfil

- [ ] Web e mobile, nova conta: Saúde, Educação e Lazer aparecem antes de Outro, com ícone e cor próprios; salvar com Saúde funciona (exige `ez4 serve --local` ou deploy com a restrição atualizada).
- [ ] Web, Perfil › lápis no meio da foto: escolher JPG, PNG ou HEIC (Safari); spinner durante o envio; a foto aparece recortada em círculo.
- [ ] Web, trocar de novo: a foto nova substitui a anterior (mesma chave `avatars/<id>` no bucket).
- [ ] Mobile (após rebuild), Perfil › lápis: galeria abre com recorte quadrado; cancelar não muda nada; a foto aparece.
- [ ] Outra conta que cobra ou paga essa pessoa: a foto aparece no Feed, no detalhe da cobrança, no detalhe da conta (participantes, recebedor, links), em Contatos, no extrato do contato, no seletor de contatos e na divisão.
- [ ] Pessoa sem foto: continua com a inicial em todos esses lugares.
- [ ] Primeiro login com Google numa conta nova: a foto do Google vira a foto do perfil. Login posterior com Google numa conta que já tem foto: a foto enviada continua.
- [ ] `/pay/<token>`: continua sem foto.
- [ ] Excluir a conta: o objeto `avatars/<id>` some do bucket.
```

- [ ] **Step 2: Note** — append to `~/Projects/ai-rules/notes/receivy.md`:

```
- 2026-09-13: categorias Saúde/Educação/Lazer (restrição `billings_category_ck` sincroniza no ez4 serve/deploy). Foto de perfil: objeto fixo `avatars/<userId>` no bucket ProofFiles, `users.avatar_updated_at` marca a versão; repositórios devolvem `AvatarRepository.ref` (chave no lugar da URL) e cada endpoint autenticado chama `AvatarRepository.sign(proofFiles, body)` antes de responder — endpoint sem `sign` entrega só a chave e o cliente cai na inicial. Upload: `POST /account/avatar` → PUT assinado → `POST /account/avatar/complete` (stat, JPEG/PNG ≤ 2 MB). Mobile usa expo-image-picker (rebuild) e `cacheKey` = caminho + versão. Foto do Google só entra quando o usuário não tem foto.
```

- [ ] **Step 3: Full verification**

```bash
pnpm --filter @receivy/common check-types && pnpm --filter @receivy/common lint && pnpm --filter @receivy/common test
pnpm --filter @receivy/api check-types && pnpm --filter @receivy/api check-types:test && pnpm --filter @receivy/api lint && pnpm --filter @receivy/api test && pnpm --filter @receivy/api openapi:check
pnpm --filter @receivy/web check-types && pnpm --filter @receivy/web lint && pnpm --filter @receivy/web test
pnpm --filter @receivy/mobile check-types && pnpm --filter @receivy/mobile lint && pnpm --filter @receivy/mobile test
```

Expected: all green. With `receivy-pg` up, also `pnpm --filter @receivy/api test:integration`. Hand the user: the schema sync (`ez4 serve --local` / deploy) and the mobile rebuild are theirs.

- [ ] **Step 4: Commit** (the QA doc only)

```bash
git add docs/manual-qa-script.md
git commit -m "docs: categories and profile photo in the manual QA script"
```
