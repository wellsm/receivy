# EZ4 vendor patches

Receivy uses three EZ4 0.52.0 packages built from local EZ4 sources. They are
pinned in `pnpm-workspace.yaml` so local builds and deploys remain reproducible.

- `@ez4/raw-pg`: exports `ClientConnection` and `ClientContext` as types. The
  npm bundle re-exported both as runtime values, which makes esbuild fail with
  `No matching export` because `@ez4/pgclient` declares them with
  `export type`.
- `@ez4/aws-common`: treats `BucketAlreadyOwnedByYou` as a successful outcome.
  Without that handling, EZ4 remote state cannot reuse its S3 bucket in
  `sa-east-1`. It also queries STS to report the effective AWS account ID,
  caller ARN and region before deployment confirmation. Account Management
  supplies the registered name for `AWS account: ID - name`.
- `@ez4/project`: invokes the account report after the deployment plan and
  before `Are you sure you want to proceed?`. It also reports the account when
  confirmation is disabled. Identity lookup failures stop the deployment.

The account report uses the AWS SDK credential chain, including session or
profile credentials when the environment file does not supply credentials.
Both `aws-common` and `project` overrides are required for this report.
Reading the account name requires `account:GetAccountInformation`. If the
name lookup fails, returns no name or identifies a different account, the
report keeps the STS-verified ID and displays `name unavailable`.

Before upgrading EZ4, remove one override at a time, install the upstream
version, and exercise `ez4 output` plus a development deploy. Delete the
matching archive and override once upstream passes both checks.
