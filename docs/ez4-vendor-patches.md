# EZ4 vendor patches

Receivy uses two EZ4 0.53.0 packages built from the local EZ4 sources
(`~/Projects/ez4`). They are pinned in `pnpm-workspace.yaml` so local builds and
deploys remain reproducible.

- `@ez4/raw-pg`: `src/client.ts` re-exports `ClientConnection`, `Client` and
  `ClientContext` with `export type`. Upstream re-exports them as runtime
  values, but `@ez4/pgclient` declares all three with `export type`, so esbuild
  fails with `No matching export` when bundling anything that reaches
  `@ez4/raw-pg/client`.
- `@ez4/aws-common`: treats `BucketAlreadyOwnedByYou` as a successful outcome.
  Without it EZ4 cannot reuse its remote state bucket: the name is
  `ez4-<sha256(accountId)>`, which is deterministic, so every run after the
  first one fails on `CreateBucket`.

`@ez4/project` is no longer vendored. Its patch printed an STS account report
(`AWS account: ID - name`) between the deployment plan and `Are you sure you
want to proceed?`. Upstream 0.53.0 has no equivalent, so the confirmation no
longer says which account is about to be touched — check it by hand before
confirming a deploy.

## Rebuilding the archives

Each package in the EZ4 monorepo compiles against its siblings' `dist`, so a
stale `dist` fails the build with type errors unrelated to the patch (a stale
`@ez4/pgmigration` breaks `raw-pg` on `PgMigrationStepQueries`). Build the
dependency chain first:

```sh
cd ~/Projects/ez4
(cd contracts/database && npm run build)
(cd libraries/pgsql && npm run build)
(cd libraries/pgmigration && npm run build)
(cd providers/raw/raw-pg && npm run build && npm pack --pack-destination ~/Projects/receivy/vendor)
(cd providers/aws/aws-common && npm run build && npm pack --pack-destination ~/Projects/receivy/vendor)
```

Then point the `overrides` in `pnpm-workspace.yaml` at the new archives and run
`pnpm install`.

## Checking an upgrade

`ez4 test --local` never bundles — esbuild only runs from
`@ez4/aws-common/src/common/bundler.ts`, on the deploy path — so the integration
suite cannot catch the `raw-pg` problem. Reproduce the bundling step directly:

```sh
cd packages/api
ESBUILD=$(find ../../node_modules/.pnpm -path '*esbuild/bin/esbuild' | head -1)
printf "import { Client } from '@ez4/raw-pg/client';\n" > .probe.mjs
"$ESBUILD" .probe.mjs --bundle --format=esm --platform=node --outfile=/dev/null
rm .probe.mjs
```

`No matching export` means the override is still needed. A clean bundle means
upstream can be reconsidered — the `Import "Client" will always be undefined`
warning is expected, since `export type` leaves the module with no runtime
exports.

The `aws-common` behaviour only shows on a real deploy. Before deleting that
archive, remove the override, then run `ez4 output` and a development deploy.
