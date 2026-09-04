# EZ4 vendor patches

Receivy uses two EZ4 0.52.0 packages built from the same reviewed sources as
Rewarlo. They are pinned in `pnpm-workspace.yaml` so local builds and deploys
remain reproducible.

- `@ez4/raw-pg`: exports `ClientConnection` and `ClientContext` as types. The
  npm bundle re-exported both as runtime values, which makes esbuild fail with
  `No matching export` because `@ez4/pgclient` declares them with
  `export type`.
- `@ez4/aws-common`: treats `BucketAlreadyOwnedByYou` as a successful outcome.
  Without that handling, EZ4 remote state cannot reuse its S3 bucket in
  `sa-east-1`.

Before upgrading EZ4, remove one override at a time, install the upstream
version, and exercise `ez4 output` plus a development deploy. Delete the
matching archive and override once upstream passes both checks.
