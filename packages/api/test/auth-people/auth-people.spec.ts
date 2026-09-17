import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import type { BillingSplit } from '@receivy/common';
import { BillingRecurrence, ChargeState, normalizeContact, SplitMode, SplitPartKind, UserStatus } from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ApiError } from '../../src/common/errors';
import { DUPLICATE_CONTACT_MESSAGE, EMAIL_TAKEN_MESSAGE, LINKED_CONTACT_MESSAGE } from '../../src/contacts/errors';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { AccountRepository } from '../../src/users/repositories/account';
import { AuthRepository } from '../../src/users/repositories/auth';
import { confirmEmailCode } from '../../src/users/services/email-login';
import { hashOauthValue } from '../../src/users/services/oauth';
import { exchangeOauthGrant, OauthFlowError } from '../../src/users/services/oauth-flow';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const owner = randomUUID(),
  stranger = randomUUID(),
  joining = randomUUID(),
  paged = randomUUID(),
  contacts = randomUUID();
const ids = [owner, stranger, joining, paged, contacts];
const emails = ids.map((id) => `auth-people-${id}@example.com`);
const repo = AuthRepository.create(db);
const codeHashKey = 'auth-people-test-code-secret-only';
const accessTokenSecret = 'auth-people-test-session-secret-only';
const email = (label: string) => `auth-people-${label}-${randomUUID()}@example.com`;

describe('auth and contacts repositories on dedicated PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');
    equal(database?.['name'], 'receivy_tests');
    await createUser(db, { id: owner, email: emails[0]!, name: 'Owner' });
    await createUser(db, { id: stranger, email: emails[1]!, name: 'Stranger' });
    await createUser(db, { id: paged, email: emails[3]!, name: 'Paged' });
    await createUser(db, { id: contacts, email: emails[4]!, name: 'Contacts' });
    const now = new Date().toISOString();
    await db.users.insertOne({
      data: {
        id: joining,
        email: emails[2]!,
        status: UserStatus.Pending,
        locale: 'pt-BR',
        timezone: 'America/Sao_Paulo',
        country: 'BR',
        currency: 'BRL',
        created_at: now,
        updated_at: now
      }
    });
  });
  after(async () => {
    const families = await db.session_families.findMany({ select: { id: true }, where: { user_id: { isIn: ids } } });
    if (families.records.length)
      await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map((row) => row.id) } } });
    await db.session_families.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.oauth_grants.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.auth_identities.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.login_codes.deleteMany({ where: { email: { isIn: emails } } });
    await cleanupUsers(db, ids);
  });

  it('normalizes owned contacts, locks name and e-mail once the account is active, and archives cleanly', async () => {
    const input = normalizeContact({ name: '  Ana  Silva ', email: emails[2]!.toUpperCase() });
    const contact = await ContactRepository.save(db, owner, input);
    equal(contact.name, 'Ana Silva');
    equal(contact.email, emails[2]);
    equal(contact.userId, joining, 'a contact for an existing e-mail points at that account');
    equal(contact.status, 'pending');
    equal(contact.phone, null);
    deepEqual((await ContactRepository.list(db, stranger)).contacts, []);
    await rejects(() => ContactRepository.save(db, stranger, input, contact.id), HttpNotFoundError);
    await rejects(() => ContactRepository.archive(db, stranger, contact.id), HttpNotFoundError);
    await rejects(
      () => ContactRepository.save(db, owner, input),
      (error: ApiError) => error.message === DUPLICATE_CONTACT_MESSAGE
    );
    await rejects(() => ContactRepository.save(db, owner, { name: 'Eu', email: emails[0]! }), ApiError);
    // While the account is pending, the agenda may still fix the name, but never onto an e-mail someone else holds.
    await rejects(
      () => ContactRepository.save(db, owner, { ...input, email: emails[1]! }, contact.id),
      (error: ApiError) => error.message === EMAIL_TAKEN_MESSAGE
    );
    equal((await ContactRepository.save(db, owner, { ...input, name: 'Ana S.' }, contact.id)).name, 'Ana S.');
    equal((await db.users.findOne({ select: { name: true }, where: { id: joining } }))?.name, 'Ana S.');
    await ContactRepository.save(db, owner, input, contact.id);
    await repo.replaceLoginCode({ email: emails[2]!, code: '123456', codeHashKey });
    const session = await confirmEmailCode({ email: emails[2]!, code: '123456' }, { repo, codeHashKey, accessTokenSecret });
    equal(session.user.id, joining);
    await AccountRepository.updateProfile(db, joining, {
      name: 'Ana Silva',
      phone: '(11) 99999-1234',
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      country: 'BR'
    });
    const active = (await ContactRepository.list(db, owner)).contacts.find((row) => row.id === contact.id);
    equal(active?.status, 'active');
    equal(active?.phone, '+5511999991234');
    // An active contact mirrors an account: only the nickname is the owner's to change.
    await rejects(
      () => ContactRepository.save(db, owner, { ...input, name: 'Ana' }, contact.id),
      (error: ApiError) => error.message === LINKED_CONTACT_MESSAGE
    );
    await rejects(() => ContactRepository.save(db, owner, { ...input, email: email('moved') }, contact.id), ApiError);
    const nicknamed = await ContactRepository.save(db, owner, normalizeContact({ ...input, nickname: '  Aninha  da  Silva ' }), contact.id);
    equal(nicknamed.nickname, 'Aninha da Silva');
    equal(nicknamed.displayName, 'Aninha da Silva');
    equal(nicknamed.name, 'Ana Silva');
    equal(nicknamed.userId, joining);
    await ContactRepository.archive(db, owner, contact.id);
    await ContactRepository.archive(db, owner, contact.id);
    equal((await ContactRepository.list(db, owner, undefined, true)).contacts[0]?.email, emails[2]);
    const again = await ContactRepository.save(db, owner, input);
    ok(again.id !== contact.id);
    equal(again.userId, joining);
  });

  it('keeps a contact without e-mail as a private placeholder until an address is typed', async () => {
    const saved = await ContactRepository.save(db, contacts, normalizeContact({ name: 'Sem Endereço', nickname: 'Vizinho' }));

    equal(saved.email, '');
    equal(saved.status, 'pending');
    equal(saved.displayName, 'Vizinho');

    const user = await db.users.findOne({ select: { email: true }, where: { id: saved.userId } });

    equal(user?.email ?? null, null);

    // A second placeholder for the same name never collides: without an e-mail there is nothing to match.
    const twin = await ContactRepository.save(db, contacts, normalizeContact({ name: 'Sem Endereço' }));

    notEqual(twin.userId, saved.userId);

    const typed = email('placeholder');
    const filled = await ContactRepository.save(db, contacts, normalizeContact({ name: 'Sem Endereço', email: typed }), saved.id);

    equal(filled.email, typed);
    equal(filled.userId, saved.userId);

    // Once typed, the address can be corrected but never blanked, and never point at another account.
    await rejects(ContactRepository.save(db, contacts, normalizeContact({ name: 'Sem Endereço' }), saved.id), HttpBadRequestError);
    await rejects(ContactRepository.save(db, contacts, normalizeContact({ name: 'Sem Endereço', email: emails[1]! }), saved.id), ApiError);

    // Search reads the name; an empty e-mail never breaks the comparison.
    const listed = await ContactRepository.list(db, contacts, undefined, false, 'sem endere');

    deepEqual(listed.contacts.map((contact) => contact.id).sort(), [saved.id, twin.id].sort());
  });

  it('keeps the nickname, derives displayName and counts only pending charges', async () => {
    const plain = await ContactRepository.save(db, contacts, { name: 'Camila Soares', email: email('camila') });
    equal(plain.nickname, null);
    equal(plain.displayName, 'Camila Soares');
    equal(plain.activeCharges, 0);

    const saved = await ContactRepository.save(
      db,
      contacts,
      normalizeContact({ name: 'Camila Soares', email: plain.email, nickname: '  Mila  ' }),
      plain.id
    );
    equal(saved.nickname, 'Mila');
    equal(saved.displayName, 'Mila');

    const split = { mode: SplitMode.Equal as const, parts: [{ kind: SplitPartKind.User as const, userId: plain.userId }] };
    for (const suffix of ['a', 'b', 'c']) {
      await BillingRepository.create(
        db,
        contacts,
        `nickname-charge-${suffix}`,
        { recurrence: BillingRecurrence.Once, description: 'Rateio', totalCents: 3000, startDate: '2026-12-20', timezone: 'America/Sao_Paulo', split },
        new Date('2026-03-10T12:00:00Z')
      );
    }

    const charges = await db.charges.findMany({ select: { id: true }, where: { debtor_id: plain.userId } });
    equal(charges.records.length, 3);
    await db.charges.updateOne({
      select: { id: true },
      where: { id: charges.records[0]!.id },
      data: { state: ChargeState.Paid, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    });
    await db.charges.updateOne({
      select: { id: true },
      where: { id: charges.records[1]!.id },
      data: { state: ChargeState.Cancelled, cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    });

    const listed = (await ContactRepository.list(db, contacts)).contacts.find((row) => row.id === plain.id);
    equal(listed?.activeCharges, 1);
    equal(listed?.displayName, 'Mila');

    const recent = (await ContactRepository.list(db, contacts, undefined, false, '', 'recent')).contacts.find((row) => row.id === plain.id);
    equal(recent?.activeCharges, 1);
    equal(recent?.nickname, 'Mila');

    // An empty nickname clears it and the full name takes the display slot back.
    const cleared = await ContactRepository.save(
      db,
      contacts,
      normalizeContact({ name: 'Camila Soares', email: plain.email, nickname: '   ' }),
      plain.id
    );
    equal(cleared.nickname, null);
    equal(cleared.displayName, 'Camila Soares');
  });

  it('serializes duplicate email creation and pages 52 owned records without repetition', async () => {
    const outcomes = await Promise.allSettled(
      [1, 2].map(() => ContactRepository.save(db, owner, { name: 'Race', email: `race-${owner}@example.com` }))
    );
    equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    equal(outcomes.filter((x) => x.status === 'rejected' && x.reason instanceof ApiError).length, 1);
    for (let index = 0; index < 52; index++)
      await ContactRepository.save(db, stranger, { name: `Contact ${index}`, email: email(`page-${index}`) });
    const first = await ContactRepository.list(db, stranger);
    const second = await ContactRepository.list(db, stranger, first.nextCursor!);
    equal(first.contacts.length, 50);
    equal(second.contacts.length, 2);
    equal(second.nextCursor, null);
    equal(new Set([...first.contacts, ...second.contacts].map((x) => x.id)).size, 52);
  });

  it('exchanges the real OAuth grant once with its correct PKCE verifier', async () => {
    const code = 'native-oauth-grant-' + randomUUID();
    const verifier = 'v'.repeat(43);
    await repo.createGrant({
      userId: owner,
      grantHash: hashOauthValue(code),
      clientChallenge: hashOauthValue(verifier),
      expiresAt: new Date(Date.now() + 120_000)
    });
    const exchange = (codeVerifier: string) => exchangeOauthGrant({ code, codeVerifier }, { repo, accessTokenSecret });
    await rejects(() => exchange('w'.repeat(43)), OauthFlowError);
    const session = await exchange(verifier);
    equal(session.user.id, owner);
    equal(session.expiresIn, 900);
    equal(session.accessToken.split('.').length, 3);
    equal(session.refreshToken.length, 43);
    await rejects(() => exchange(verifier), OauthFlowError);
    equal(await db.oauth_grants.count({ where: { grant_hash: hashOauthValue(code), consumed_at: { isNull: false } } }), 1);
  });

  it('searches the full owned agenda by literal name or email before pagination', async () => {
    const target = await ContactRepository.save(db, stranger, { name: 'Search target 100%', email: 'needle@example.com' });
    for (const search of ['TARGET', 'needle@', '100%']) {
      deepEqual(
        (await ContactRepository.list(db, stranger, undefined, false, search)).contacts.map((x) => x.id),
        [target.id]
      );
      equal((await ContactRepository.list(db, owner, undefined, false, search)).contacts.length, 0);
    }
    equal((await ContactRepository.list(db, stranger, undefined, false, 'no-match')).contacts.length, 0);
    // UUID/date-like terms must stay text parameters or the driver types them as uuid/date.
    for (const search of [randomUUID(), '2026-10-31', '12:30:00'])
      equal((await ContactRepository.list(db, stranger, undefined, false, search)).contacts.length, 0);
  });

  it('pages the recent order across the NULLS LAST boundary without repeating a contact', async () => {
    // 45 contacts billed last, 10 billed earlier and 50 never billed: the null boundary falls
    // inside the second page, so both cursor branches are exercised.
    const agenda: { id: string; userId: string; name: string }[] = [];

    for (let index = 0; index < 105; index++) {
      const label = String(index).padStart(3, '0');
      agenda.push(await ContactRepository.save(db, paged, { name: `Recent ${label}`, email: email(`recent-${label}`) }));
    }

    const splitOf = (from: number, to: number) => ({
      mode: SplitMode.Equal as const,
      parts: agenda.slice(from, to).map((contact) => ({ kind: SplitPartKind.User as const, userId: contact.userId }))
    });
    const billing = (key: string, split: BillingSplit, when: Date) =>
      BillingRepository.create(
        db,
        paged,
        key,
        {
          recurrence: BillingRecurrence.Once,
          description: 'Rateio',
          totalCents: 11_000,
          startDate: '2026-12-20',
          timezone: 'America/Sao_Paulo',
          split
        },
        when
      );

    await billing('recent-older-page', splitOf(45, 55), new Date('2026-01-10T12:00:00Z'));
    await billing('recent-newer-page', splitOf(0, 45), new Date('2026-02-10T12:00:00Z'));

    const first = await ContactRepository.list(db, paged, undefined, false, '', 'recent');
    const second = await ContactRepository.list(db, paged, first.nextCursor!, false, '', 'recent');
    const third = await ContactRepository.list(db, paged, second.nextCursor!, false, '', 'recent');

    equal(first.contacts.length, 50);
    equal(second.contacts.length, 50);
    equal(third.contacts.length, 5);
    equal(third.nextCursor, null);
    ok(first.nextCursor);
    ok(second.nextCursor);

    const listed = [...first.contacts, ...second.contacts, ...third.contacts];

    equal(new Set(listed.map((contact) => contact.id)).size, 105);
    deepEqual(
      listed.map((contact) => contact.name),
      agenda.map((contact) => contact.name)
    );
    // The last billed group leads, the earlier one follows and never-billed contacts close the order.
    ok(listed.slice(0, 45).every((contact) => contact.lastBilledAt?.startsWith('2026-02-10')));
    ok(listed.slice(45, 55).every((contact) => contact.lastBilledAt?.startsWith('2026-01-10')));
    ok(listed.slice(55).every((contact) => contact.lastBilledAt === null));
  });
  it('refuses a cursor the requested order cannot read instead of failing on the comparison', async () => {
    const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url');
    const keyset = encode({ last: null, name: 'Recent 049', id: randomUUID() });

    // Both default-order paths compare the cursor as an id: the paged read and the searched one.
    for (const search of ['', 'recent 0']) {
      await rejects(() => ContactRepository.list(db, paged, 'abc', false, search), HttpBadRequestError);
      // A keyset cursor replayed without `sort=recent` is not an id either.
      await rejects(() => ContactRepository.list(db, paged, keyset, false, search), HttpBadRequestError);
    }

    // The `recent` order refuses a bare id, an unreadable payload and an empty `last` the same way.
    await rejects(() => ContactRepository.list(db, paged, 'abc', false, '', 'recent'), HttpBadRequestError);
    await rejects(() => ContactRepository.list(db, paged, randomUUID(), false, '', 'recent'), HttpBadRequestError);
    await rejects(
      () => ContactRepository.list(db, paged, encode({ last: '', name: 'Recent 049', id: randomUUID() }), false, '', 'recent'),
      HttpBadRequestError
    );

    // The cursors each order does issue keep working.
    const byId = await ContactRepository.list(db, paged);
    const byRecent = await ContactRepository.list(db, paged, undefined, false, '', 'recent');

    equal((await ContactRepository.list(db, paged, byId.nextCursor!)).contacts.length, 50);
    equal((await ContactRepository.list(db, paged, byRecent.nextCursor!, false, '', 'recent')).contacts.length, 50);
  });
});
