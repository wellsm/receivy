# Private proof storage

Uploads use a five-minute intent and exact size (maximum 10 MiB) and JPG/PNG/PDF
MIME. The API reads bounded actual bytes, checks magic bytes and SHA-256, and
writes those exact bytes to a new server-only final key. Upload keys contain no
charge identifiers. Finalization rechecks authorization/capability and charge
state under the financial charge lock. An upload URL is never a final proof URL.
Download links are authenticated, last 60 seconds, and force an attachment name.
Public capabilities cannot list/download proofs; an uploader may recover only
the state/reason of their own intent, with the same still-valid capability.
The web client saves only the opaque recovery handle before upload/finalization.
An ambiguous finalize response is reconciled against that status, including on
reload or explicit verification; an observed committed proof is not called a
failed upload. Definitively invalid bytes expire the owned intent so a new file
can be selected; transient storage errors retain the intent for retry. Expiry
also unlocks the web picker without requiring a reload.

Manual payment/cancellation atomically rejects an outstanding proof with
`closure_reason=paid|cancelled` and an explicit system reason. Files and audit are
retained. This is closure, not a claim that the uploaded document is invalid.
Acceptance creates one integral payment in the same transaction as the paid
charge, accepted proof, activity, and notification outbox. No OCR is performed.

## Explicit local QA

No local adapter is selected automatically. `PROOF_STORAGE_MODE=local` requires
`APP_STAGE=local|test`, an absolute directory, a loopback storage URL, and a
32-character-or-longer local signing secret. The separate loopback HTTP server
checks signatures, method, expiry, size and MIME, serves only final attachments,
and does not log request URLs/filenames. It is not an S3 emulator or cloud proof.

Use only fictitious fixtures. `proof-local.env.example` points at the disposable
HTTP-smoke database on port 55435, not the normal database on 55434. After starting
that isolated database, from `packages/api`, start two terminals:

```sh
node --env-file=proof-local.env.example scripts/local-proof-storage.ts
node --env-file=proof-local.env.example ./node_modules/@ez4/project/bin/cli.mjs serve --local
```

The local API base is `http://127.0.0.1:3735/local-receivy-api`. Start Next on
localhost:3001 with `EZ4_API_URL` set to that base and
`PROOF_UPLOAD_ORIGIN=http://127.0.0.1:3736`. API startup may require initial schema
reset **only after verifying the URL points at the disposable port-55435 DB**.
Reuse native fixture helpers in `packages/api/test/fixtures/financial.ts` for
domain tests; browser QA can create fictitious accounts/contacts/charges through
the existing app. Local files remain under `/private/tmp/receivy-proof-qa` until
explicitly removed after QA. Physical phones cannot reach this loopback storage
server; native-device QA needs an explicitly approved reachable private adapter.

## Production gates — not deployed or claimed verified

- Set `PROOF_STORAGE_MODE=s3` and `PROOF_S3_BUCKET` to the **exact** generated
  linked `ProofFiles` bucket name from EZ4 output. Missing/foreign names fail
  closed. The current validator supports unbranched stage names only. The
  declared bucket is private and linked through `ApiProvider.proofFiles`.
  Installed EZ4 0.52 policy source grants List/Get/Put/Delete on the project
  prefix; `getServiceName('ProofFiles', {prefix:'dev',projectName:'receivy',
  branchName:''})` resolves to `dev-receivy-proof-files`, then the bucket provider
  adds a random suffix. Runtime AWS permission success has not been exercised.
- Change the declared `ProofFiles` CORS allowlist from localhost to the exact
  approved production web origin, and set Next `PROOF_UPLOAD_ORIGIN` to the exact
  S3 upload origin. No wildcard/all-HTTPS CSP fallback exists. AWS default private
  bucket/SSE plus explicit AES256 on final puts are used; verify account policies.
- Configure lifecycle expiration **only for `temporary/`**, not the whole bucket.
  EZ4's `autoExpireDays` is bucket-wide and is deliberately not used. No cloud
  lifecycle was provisioned. Failed temporary deletion can be retried by lifecycle;
  final-object rollback cleanup is best-effort. A final orphan reconciler remains
  an operational gate (never expire all retained `proofs/` objects). A lost commit
  acknowledgement causes a DB existence check before deletion; uncertain DB
  status retains the object rather than risking a committed proof.
  Task 5/6 reconciliation must enumerate `proofs/{chargeId}/{proofId}` keys and
  metadata, not trust a client filename. For each old candidate, acquire the same
  charge row lock, verify no `payment_proofs.id=proofId` references it, and skip
  the whole charge while any unexpired pending `upload_intents` exist. A
  finalization already in its transaction must finish before this lock can be
  acquired; a finalization still doing object I/O must recheck its intent expiry
  under this lock before committing. Expire the stale intent under that lock,
  then release it before bounded deletion; never delete on missing/failed DB
  reads. Grace age must exceed the upload intent's five-minute lifetime plus
  clock skew. This durable charge/intent/proof mapping makes conservative
  reconciliation possible, but that worker and its race tests are **not yet
  implemented**. No claim of durable cleanup is made by this task.
- EZ4 0.52 discards trusted gateway `sourceIp` from handler input. The approved
  interim limiter persists a per-capability/user quota (12 mutation requests per
  10 minutes) plus shared unknown-client quota (120 per 10 minutes). Spoofed
  forwarded headers cannot change these identities. **This is not per-IP proof**;
  real trusted-edge IP extraction/rate limiting remains a production gate.
  Only validated public capabilities consume legitimate mutation quota. Invalid
  capabilities cannot exhaust that shared budget. No separate malformed-request
  limiter is delivered here; invalid-request edge enforcement remains Task 7.
- Public framework/access logs and provider malformed-body error logging need
  the separate Task 7 logging hardening. Application proof code never logs tokens,
  signed URLs, file names or file contents. Do not use real data before that gate.
- S3 tests sign offline with fictitious credentials; local HTTP tests exercise a
  real filesystem server. Neither proves deployed S3, browser CORS or devices.

Expo uses SDK 56 `DocumentPicker` with `copyToCacheDirectory:true`, checks canceled
selection first, then uploads a `File` with `expo/fetch`. The picker is only
invoked by a user action. References: [SDK56 DocumentPicker](https://docs.expo.dev/versions/v56.0.0/sdk/document-picker/)
and [SDK56 FileSystem](https://docs.expo.dev/versions/v56.0.0/sdk/filesystem/).
