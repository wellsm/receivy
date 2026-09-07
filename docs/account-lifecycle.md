# Account lifecycle boundary

Receivy is a personal-record organizer. These product disclosures are not legal
certification, a bank service, a payment processor or automatic Pix verification.

## Profile and sessions

The first name-less login asks only for a name and derives timezone from the
device's Intl configuration. Name and IANA timezone can be corrected in settings.
The existing launch contract remains pt-BR / BR / BRL; other languages and countries
are not advertised as editable. Internationalization requires a later explicit scope.

Every API authorization verifies JWT issuer/audience/expiry/signature and then checks
the persisted family belongs to that user, is not revoked, and the user is not erased.
Gateway authorizer caching is explicitly zero at the Http.Service cache boundary.
Refresh, device registration, remote revocation and account deletion serialize on
the user before family/token mutations. Logout remains refresh-token based and does
not require an unexpired access token. Refresh replay also revokes family push access.
Session revocation disables registrations linked to that family and conservatively
disables legacy registrations with no family link. Removed token tombstones preserve
delivery history and release the actual token for another account. Already accepted
external sends cannot be recalled; unsubmitted/retry work is prevented.

## Export

POST account/export issues a five-minute, purpose-separated HMAC authorization bound
to the authenticated user and family. POST account/export/download receives it in the
body (not URL), revalidates the active session and returns filename plus JSON bytes.
The web downloads an application/json attachment; mobile opens its native share sheet
with JSON text. A leaked export ticket alone cannot download anything. No exports are
persisted server-side, so no additional bucket, upload MIME or expiry policy is needed.

Enumeration is explicit: own profile, address book/contacts, Pix methods, expenses,
recurrences, uploaded proof metadata, preferences and activity facts; financial charge
and payment history is restricted to creditor ownership or the immutable recipient
ID/verified email authorization. Other accounts' address books are excluded. Login
codes, provider identities/grants/attempts, refresh tokens, device tokens, public-link
capabilities, storage object keys and credentials are never part of the export.
User-downloaded/shared copies leave Receivy's control and must be protected by users.

## Deletion and retention allowlist

DELETE account requires the literal EXCLUIR. One transaction revokes sessions, ends
owned recurrence generation, removes owned login artifacts/preferences/Pix methods,
scrubs affected notification render inputs/recipient routing, prevents outbox retries,
and erases user identity. A retry at the repository boundary is idempotent under the
user lock. Already-revoked HTTP credentials get normal 401, not an auth exception.
Clients attempt to clear local auth and show a neutral unconfirmed message unless an
actual successful deletion response is received. A 401 is never evidence of deletion.
The web separately confirms its logout HTTP response before claiming the browser
session ended. Rejected/non-success logout requests keep an explicit retry action;
confirmed account deletion is not undone or downgraded by a failed cookie-clear request.

Cross-account reference writers acquire a shared transaction-scoped PostgreSQL
advisory barrier before any row or implicit FK locks; erasure acquires it exclusively
before locking the user or scanning references. The stable two-int key is
`(0x52454356, 1)` (RECV/account references). No shared-to-exclusive upgrade is allowed.
Ordinary writers still run concurrently; infrequent erasure briefly stalls these
writers globally and serializes erasures. No external I/O occurs under this barrier.
Commit and rollback both release it automatically.

Participating transaction entries are expense creation; person save/archive and
verified-email linking; recurrence create/edit/state changes, each materialization
and failed-attempt fairness update; locked charge authorization for cancellation,
manual payment/reminder, public-link changes and authenticated proof mutations; and
anonymous proof authorization before its charge lock. Verified-email linking begins
its own outer transaction after the email/OAuth user-resolution transaction completes,
before updating the user or any person. Session/device-only and own Pix/profile writes
retain their existing user-first protocol; notification workers retain charge-first
ordering and do not insert cross-account user references.

- Preserve counterparties' amounts, charge states, payment dates and methods. Do not
  transfer ownership to another live account or delete their financial history.
- Keep the old user ID only as an anonymous, non-login FK tombstone (random-ID address
  at deleted.invalid, generic name, no verified email/avatar, UTC, deleted_at).
- Clear BOTH recipient_user_id and matching historical email snapshot, plus the
  deleting recipient's name. Re-registering the same email gets a new account and
  cannot regain retained history. Unlink/archive attributable address-book references;
  remove unnecessary own contacts, and scrub retained address-book identity. Preserve
  unrelated counterparties' immutable charge recipient snapshots.
- Remove the deleting creditor's Pix snapshots. Shared descriptions, amount/status
  facts, charge/source IDs and financial timestamps remain for consistency; free-form
  descriptions supplied by other people are not indiscriminately erased. Ended owned
  recurrence descriptions become generic. Own expenses without charges are removed.
- Preserve revoked public-link tombstones. Suppress affected pending deliveries and
  fail/scrub their outbox events, including unsupported event types. Notifications for
  a deleted creditor cannot create a fresh initial link. Accepted/in-flight delivery
  observations remain; protected render inputs do not.
- Delete only proof/upload-intent objects with sender_user_id matching the erased
  account. Clear payment proof references and preserve the payment fact. Keep anonymous
  capability uploads and counterparty-owned proofs: no authenticated evidence assigns
  those files to the deleting account. Clear the erased reviewer reference/reason.
- File-reference removal and enqueueStorageDeletion(...purpose: account) commit
  together under the charge lock. The Task5 journal survives account erasure and
  retries failed storage operations; it never deletes a still-referenced file. The
  transaction rolls back completely if an object cannot be safely journaled.

No statutory retention period is invented. This is the MVP's technical boundary,
not a promise to recall already delivered provider messages or erase third-party
copies. Legal/operator review remains an external release gate. Configure the real
operator contact via NEXT_PUBLIC_OPERATOR_CONTACT and EXPO_PUBLIC_OPERATOR_CONTACT
before public availability; defaults clearly state that it has not been supplied.
