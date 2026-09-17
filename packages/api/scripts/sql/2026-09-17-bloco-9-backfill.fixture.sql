-- Hand-built fixture for the bloco 9 backfill dry run. There is no seed for the old shape (the app can
-- no longer create it), so this fixture inserts D2-shape rows directly against a D2-schema database
-- (packages/api `pnpm test:db:prepare`, database `receivy_tests`).
--
-- Cast of characters (owner = 11111111-1111-1111-1111-111111111101):
--   * Imobiliária (pending user + contact) — already an agenda entry, playing the payee of B1 (a live
--     conta a pagar with a typed Pix key) and, separately, the label on B3 (tests rule 2: the registro
--     must reuse this contact, not invent a second pending "Imobiliária").
--   * Fiado Ltda (pending user + contact) — payee of B6, a conta a pagar whose typed key equals a key
--     the owner already holds under their own scope (tests rule 3).
--   * B1 — payable, kind=live, typed pix, split = owner + Imobiliária (old shape), one pending charge
--     (creditor = Imobiliária, debtor = owner).
--   * B2 — payable registro, counterpart_label='Padaria', no existing contact (tests the plain "invent
--     a pending user" path).
--   * B3 — payable registro, counterpart_label='Imobiliária' (tests rule 2 reuse).
--   * B4 — receivable registro, counterpart_label='Mãe', one charge with debtor_id NULL.
--   * B5 — receivable registro, counterpart_label='' (blank): stays without a payer on purpose
--     (rule 1 — `receivable_registros_without_payer`).
--   * B6 — payable, kind=live, typed pix equal to the owner's own payment_methods row (contact_id IS
--     NULL): must end up pointing payment_method_id at that owner-owned row, not a new contact-scoped
--     one (rule 3 — `keys_pointing_at_owner_key`).
--   * Loja X / Loja Y (pending users + contacts) — payees of B7 and B8, two payables that type the exact
--     same Pix key under two different contacts (tests review finding 1 —
--     `keys_shared_across_contacts` — and that the canonical row is picked by earliest billing
--     `created_at`, not by id or insertion order: B8's id sorts before B7's, but B7's `created_at` is
--     earlier, so B7's contact must win).
--   * João #1 / João #2 (pending users + contacts, same name, same owner) — B9 is a receivable registro
--     labelled "João": ambiguous on `users.name` alone (tests review finding 2 —
--     `ambiguous_registro_labels`). Both contacts share the same `created_at` (both inserted under this
--     one fixture transaction's `now()`), so the tie-break falls to `contacts.id`: João #1's id sorts
--     first and must win.

BEGIN;

-- Owner
INSERT INTO users (id, email, name, status, locale, timezone, country, currency, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111101', 'owner@example.com', 'Owner', 'active', 'pt-BR', 'America/Sao_Paulo', 'BR', 'BRL', now(), now());

-- Pending users behind pre-existing contacts
INSERT INTO users (id, name, status, locale, timezone, country, currency, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111102', 'Imobiliária', 'pending', 'pt-BR', 'America/Sao_Paulo', 'BR', 'BRL', now(), now()),
  ('11111111-1111-1111-1111-111111111104', 'Fiado Ltda', 'pending', 'pt-BR', 'America/Sao_Paulo', 'BR', 'BRL', now(), now());

INSERT INTO contacts (id, owner_id, user_id, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111102', now(), now()),
  ('11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111104', now(), now());

-- The owner's own Pix key (contact_id IS NULL)
INSERT INTO payment_methods (id, owner_id, contact_id, type, pix_key_type, pix_key, label, is_default, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111106', '11111111-1111-1111-1111-111111111101', NULL, 'pix', 'cpf', '52998224725', 'Minha chave', true, now(), now());

-- B1: conta a pagar, typed key, old-shape split (owner + payee), one pending charge
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, pix_key_type, pix_key, pix_label, state, split_mode, idempotency_key, request_hash,
  created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111101', 'once', 'live',
  'Aluguel', 'housing', 150000, '2026-09-05', 'fixed',
  NULL, 'payable', 'email', 'payee@imob.example', 'Chave Imobiliária', 'active', 'fixed',
  'fixture-b1', 'fixture-hash-b1', now(), now()
);

INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at) VALUES
  ('11111111-1111-1111-1111-111111111120', '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111101', 0, true, now()),
  ('11111111-1111-1111-1111-111111111121', '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111102', 1, true, now());

INSERT INTO charges (id, owner_id, creditor_id, debtor_id, billing_id, description, amount_cents, due_date, state, notify, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111130', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111110', 'Aluguel', 150000, '2026-09-05', 'pending', true, now(), now());

-- B2: payable registro, label with no existing contact
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, counterpart_label, state, idempotency_key, request_hash, created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111101', 'once', 'record',
  'Pão da semana', 'groceries', 5000, '2026-09-10', 'fixed',
  NULL, 'payable', 'Padaria', 'active', 'fixture-b2', 'fixture-hash-b2', now(), now()
);

-- B3: payable registro, label matches the pre-existing "Imobiliária" contact (rule 2)
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, counterpart_label, state, idempotency_key, request_hash, created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111101', 'once', 'record',
  'Multa contrato', 'other', 3000, '2026-09-11', 'fixed',
  NULL, 'payable', 'Imobiliária', 'active', 'fixture-b3', 'fixture-hash-b3', now(), now()
);

-- B4: receivable registro, label "Mãe", charge with debtor_id NULL
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, counterpart_label, state, idempotency_key, request_hash, created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111113', '11111111-1111-1111-1111-111111111101', 'once', 'record',
  'Ajuda mensal', 'other', 20000, '2026-09-12', 'fixed',
  NULL, 'receivable', 'Mãe', 'active', 'fixture-b4', 'fixture-hash-b4', now(), now()
);

INSERT INTO charges (id, owner_id, creditor_id, debtor_id, billing_id, description, amount_cents, due_date, state, notify, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111131', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111101', NULL, '11111111-1111-1111-1111-111111111113', 'Ajuda mensal', 20000, '2026-09-12', 'pending', true, now(), now());

-- B5: receivable registro, blank label — stays without a payer on purpose
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, counterpart_label, state, idempotency_key, request_hash, created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111114', '11111111-1111-1111-1111-111111111101', 'once', 'record',
  'Recebimento avulso', 'other', 1000, '2026-09-13', 'fixed',
  NULL, 'receivable', '', 'active', 'fixture-b5', 'fixture-hash-b5', now(), now()
);

-- B6: conta a pagar whose typed key equals the owner's own key (rule 3)
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, pix_key_type, pix_key, pix_label, state, split_mode, idempotency_key, request_hash,
  created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111115', '11111111-1111-1111-1111-111111111101', 'once', 'live',
  'Fiado do mês', 'other', 8000, '2026-09-14', 'fixed',
  NULL, 'payable', 'cpf', '52998224725', 'Chave própria digitada por engano', 'active', 'fixed',
  'fixture-b6', 'fixture-hash-b6', now(), now()
);

INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at) VALUES
  ('11111111-1111-1111-1111-111111111122', '11111111-1111-1111-1111-111111111115', '11111111-1111-1111-1111-111111111101', 0, true, now()),
  ('11111111-1111-1111-1111-111111111123', '11111111-1111-1111-1111-111111111115', '11111111-1111-1111-1111-111111111104', 1, true, now());

INSERT INTO charges (id, owner_id, creditor_id, debtor_id, billing_id, description, amount_cents, due_date, state, notify, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111132', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111115', 'Fiado do mês', 8000, '2026-09-14', 'pending', true, now(), now());

-- Loja X / Loja Y: two more contacts
INSERT INTO users (id, name, status, locale, timezone, country, currency, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111140', 'Loja X', 'pending', 'pt-BR', 'America/Sao_Paulo', 'BR', 'BRL', now(), now()),
  ('11111111-1111-1111-1111-111111111142', 'Loja Y', 'pending', 'pt-BR', 'America/Sao_Paulo', 'BR', 'BRL', now(), now());

INSERT INTO contacts (id, owner_id, user_id, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111141', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111140', now(), now()),
  ('11111111-1111-1111-1111-111111111143', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111142', now(), now());

-- B7: conta a pagar, payee Loja X, typed key shared with B8. Older created_at, larger id — must win
-- the canonical payment_methods row over B8 (older created_at beats a smaller id).
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, pix_key_type, pix_key, pix_label, state, split_mode, idempotency_key, request_hash,
  created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111151', '11111111-1111-1111-1111-111111111101', 'once', 'live',
  'Fornecedor X', 'other', 12000, '2026-09-15', 'fixed',
  NULL, 'payable', 'email', 'mesmachave@example.com', 'Chave compartilhada X', 'active', 'fixed',
  'fixture-b7', 'fixture-hash-b7', '2026-08-01 10:00:00+00', now()
);

INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at) VALUES
  ('11111111-1111-1111-1111-111111111160', '11111111-1111-1111-1111-111111111151', '11111111-1111-1111-1111-111111111101', 0, true, now()),
  ('11111111-1111-1111-1111-111111111161', '11111111-1111-1111-1111-111111111151', '11111111-1111-1111-1111-111111111140', 1, true, now());

INSERT INTO charges (id, owner_id, creditor_id, debtor_id, billing_id, description, amount_cents, due_date, state, notify, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111170', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111140', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111151', 'Fornecedor X', 12000, '2026-09-15', 'pending', true, now(), now());

-- B8: conta a pagar, payee Loja Y, same typed key as B7. Newer created_at, smaller id — must lose.
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, pix_key_type, pix_key, pix_label, state, split_mode, idempotency_key, request_hash,
  created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111150', '11111111-1111-1111-1111-111111111101', 'once', 'live',
  'Fornecedor Y', 'other', 9000, '2026-09-16', 'fixed',
  NULL, 'payable', 'email', 'mesmachave@example.com', 'Chave compartilhada Y', 'active', 'fixed',
  'fixture-b8', 'fixture-hash-b8', '2026-08-01 11:00:00+00', now()
);

INSERT INTO allocations (id, billing_id, user_id, sort_order, notify, created_at) VALUES
  ('11111111-1111-1111-1111-111111111162', '11111111-1111-1111-1111-111111111150', '11111111-1111-1111-1111-111111111101', 0, true, now()),
  ('11111111-1111-1111-1111-111111111163', '11111111-1111-1111-1111-111111111150', '11111111-1111-1111-1111-111111111142', 1, true, now());

INSERT INTO charges (id, owner_id, creditor_id, debtor_id, billing_id, description, amount_cents, due_date, state, notify, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111171', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111142', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111150', 'Fornecedor Y', 9000, '2026-09-16', 'pending', true, now(), now());

-- João #1 / João #2: two contacts sharing a name (same fixture transaction, so same created_at) —
-- exercises the id tie-break in label_contacts.
INSERT INTO users (id, name, status, locale, timezone, country, currency, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111180', 'João', 'pending', 'pt-BR', 'America/Sao_Paulo', 'BR', 'BRL', now(), now()),
  ('11111111-1111-1111-1111-111111111182', 'João', 'pending', 'pt-BR', 'America/Sao_Paulo', 'BR', 'BRL', now(), now());

INSERT INTO contacts (id, owner_id, user_id, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111181', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111180', now(), now()),
  ('11111111-1111-1111-1111-111111111183', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111182', now(), now());

-- B9: receivable registro labelled "João" — ambiguous, must resolve to João #1 (contacts.id tie-break).
INSERT INTO billings (
  id, owner_id, recurrence, kind, description, category, total_cents, start_date, due_rule,
  contact_id, type, counterpart_label, state, idempotency_key, request_hash, created_at, updated_at
) VALUES (
  '11111111-1111-1111-1111-111111111190', '11111111-1111-1111-1111-111111111101', 'once', 'record',
  'Empréstimo de volta', 'other', 4000, '2026-09-17', 'fixed',
  NULL, 'receivable', 'João', 'active', 'fixture-b9', 'fixture-hash-b9', now(), now()
);

COMMIT;
