# Bloco 9.1 — the Pix key lives on the contact

Decisions taken on 2026-09-17 by the owner, after Bloco 9 landed.

## Model (unchanged from Bloco 9)

- `payment_methods.contact_id` files a key under a contact of the owner; one default per `(owner_id, contact_id)`.
- A conta a pagar pays through the receiving contact's key: an explicit `paymentMethodId` of that contact, else the contact's default. `charges.payment_snapshot` freezes it.

## What changes

- **One endpoint per contact operation.** `POST /contacts` and `PATCH /contacts/{id}` accept an optional `paymentMethod` (`{ pixKeyType, pixKey, label? }` — the shape `POST /payment-methods` already takes, so a second kind later extends one type). Inside the same transaction the repository saves the contact and files the key under it (`upsertContactKey`), and **a key typed on the contact form becomes that contact's default** — that is what the owner means when they type it. Editing a contact may add a key without touching anything else (the key is optional both on create and on edit).
- **The billing form stops typing keys.** On a conta a pagar, picking the receiving contact loads that contact's keys (`GET /payment-methods?contactId=`) and shows a selector: the default preselected, the others selectable, and — when the contact has none — a hint that the key is registered on the contact, with a way there. The form sends `paymentMethodId`; `pix` leaves `BillingInput`/`BillingPatch`, the API bodies and the OAS.
- **Contact edit lists the contact's keys** with "definir padrão" and "arquivar" — the removal path Bloco 9 left open. `PaymentMethodRepository.archive` re-elects the default inside the scope; the billing keeps paying through the contact's effective key (a billing pointing at the archived key reads `pix: null` until re-pointed).
- The contact DTO does not embed keys (the list endpoint would pay one query per contact); the clients fetch keys for the one contact they are looking at.

## Out of scope

- Several keys typed at once on the contact form (one per save; more via repeated edits).
- A conta a receber keeps the owner's own keys exactly as today.
- Registros: no Pix anywhere, as before.
