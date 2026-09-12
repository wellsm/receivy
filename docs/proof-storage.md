# Private proof storage

A charge holds at most one proof: `proof_state`, `proof_file { key, name, mime,
size, sha256 }`, who sent it (`proof_sender_user_id`, or only `proof_actor_hash`
for the public link), and the review (`proof_reviewed_at`, `proof_reason`). The
history of earlier files lives in `events` (`proof.uploaded`, `proof.invalid`,
`proof.withdrawn`, `proof.rejected`, `proof.accepted`).

## Upload

1. `POST /charges/{id}/proof` (signed-in debtor) or `POST /public/charges/{token}/proof`
   (public link) with `{ filename, mime, size }`. The API reserves the slot
   (`proof_state = uploading`, key `proofs/<chargeId>/<uuid>`, five-minute
   `proof_expires_at`), arms `charge:<id>:upload-expiry` and answers the signed PUT
   URL (`ProofFiles.getWriteUrl`).
2. The client PUTs the bytes straight to the bucket. Nothing passes through the API,
   so the 10 MiB limit is ours (`MAX_PROOF_BYTES`).
3. The bucket event on `proofs/*` (`src/proofs/events/receive-object.ts`) calls
   `receiveProofObject`: it reads the object, checks magic bytes, size and sha256,
   and moves the slot to `pending`. Anything that does not match the slot the charge
   is waiting for is deleted from the bucket; invalid bytes release the slot and log
   `proof.invalid`.
4. The client polls the charge (or `GET /public/charges/{token}/proof`) until the
   state leaves `uploading`.

A slot nobody filled is released by the scheduler, which also drops whatever
bytes landed under that key. Replacing a rejected file or withdrawing a pending one
deletes the previous object right after the transaction commits. There is no
orphan scan: every object is referenced by exactly one slot, or is deleted by the
code path that stopped referencing it.

## Review and settlement

`POST /charges/{id}/proof/review` with `accepted` marks the charge `paid` in the
same transaction; `rejected` keeps the charge pending and stores the reason. A manual
payment or a cancellation leaves a pending proof untouched: the charge state says it
was not reviewed. Reopening a charge settled by an accepted proof puts the proof back
under review.

## Storage

The API talks to one bucket only: the `ProofFiles` service linked through
`ApiProvider.proofFiles` (also given to `UploadExpiryScheduler` and to the bucket's
own event handler). On a deployed stage that is the private S3 bucket EZ4
provisions; under `serve --local` it is the emulator, which serves the same bucket
on the API host (`http://localhost:3735/local-receivy-proof-files`, files under
`.ez4/proof-files`), answers the CORS preflight from the origins declared in
`src/storage.ts` and fires the `proofs/*` event on every PUT. The web only needs
`PROOF_UPLOAD_ORIGIN` for the public page CSP (`http://localhost:3735` locally, the
S3 origin when deployed).

Download links are authenticated, last 60 seconds and come from
`getReadUrl`. The creditor may open the attached file; the debtor only the one they
sent; the public link never downloads.
