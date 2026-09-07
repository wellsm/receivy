import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { HttpConflictError, HttpNotFoundError } from "@ez4/gateway";
import { normalizePerson } from "@receivy/common";
import { db, createUser, cleanupUsers } from "../fixtures/financial";
import { archivePerson, listPeople, savePerson } from "../../src/people/repository";
import { createAuthRepository } from "../../src/repositories/auth-repository";
import { confirmEmailCode } from "../../src/auth/email-login";
import { exchangeOauthGrant, OauthFlowError } from "../../src/auth/oauth-flow";
import { hashOauthValue } from "../../src/auth/oauth";

const owner = randomUUID(), stranger = randomUUID(), joining = randomUUID();
const ids = [owner, stranger, joining];
const emails = ids.map(id => `auth-people-${id}@example.com`);
const repo = createAuthRepository(db);
const codeHashKey = "auth-people-test-code-secret-only";
const accessTokenSecret = "auth-people-test-session-secret-only";

describe("auth and people repositories on dedicated PostgreSQL", () => {
  before(async () => {
    const [database] = await db.rawQuery("SELECT current_database() AS name");
    equal(database?.["name"], "receivy_tests");
    await createUser(db, { id: owner, email: emails[0]!, name: "Owner" });
    await createUser(db, { id: stranger, email: emails[1]!, name: "Stranger" });
    const now = new Date().toISOString();
    await db.users.insertOne({ data: { id: joining, email: emails[2]!, locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL", created_at: now, updated_at: now } });
  });
  after(async () => {
    const families = await db.session_families.findMany({ select: { id: true }, where: { user_id: { isIn: ids } } });
    if (families.records.length) await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map(row => row.id) } } });
    await db.session_families.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.oauth_grants.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.auth_identities.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.login_codes.deleteMany({ where: { email: { isIn: emails } } });
    await cleanupUsers(db, ids);
  });

  it("normalizes owned contacts, links only after verified login, and archives without losing channels", async () => {
    const input = normalizePerson({ name: "  Ana  Silva ", email: emails[2]!.toUpperCase(), phone: "(11) 99999-1234" });
    const person = await savePerson(db, owner, input);
    equal(person.name, "Ana Silva"); equal(person.email, emails[2]); equal(person.phone, "+5511999991234");
    equal("linkedUserId" in person, false);
    equal(person.hasAccount, false);
    deepEqual((await listPeople(db, stranger)).people, []);
    await rejects(() => savePerson(db, stranger, input, person.id), HttpNotFoundError);
    await rejects(() => archivePerson(db, stranger, person.id), HttpNotFoundError);
    await rejects(() => savePerson(db, owner, input), HttpConflictError);
    equal((await db.people.findOne({ select: { linked_user_id: true }, where: { id: person.id } }))?.linked_user_id, null);
    await repo.replaceLoginCode({ email: emails[2]!, code: "123456", codeHashKey });
    const session = await confirmEmailCode({ email: emails[2]!, code: "123456" }, { repo, codeHashKey, accessTokenSecret });
    equal(session.user.id, joining);
    equal((await listPeople(db, owner)).people.find(row => row.id === person.id)?.hasAccount, true);
    equal((await db.people.findOne({ select: { linked_user_id: true }, where: { id: person.id } }))?.linked_user_id, joining);
    await savePerson(db, owner, { name: "Ana" }, person.id);
    equal((await db.people.findOne({ select: { linked_user_id: true }, where: { id: person.id } }))?.linked_user_id, null);
    await savePerson(db, owner, input, person.id);
    equal((await db.people.findOne({ select: { linked_user_id: true }, where: { id: person.id } }))?.linked_user_id, joining);
    await archivePerson(db, owner, person.id); await archivePerson(db, owner, person.id);
    equal((await listPeople(db, owner, undefined, true)).people[0]?.email, emails[2]);
    ok((await savePerson(db, owner, input)).id !== person.id);
  });

  it("serializes duplicate email creation and pages 52 owned records without repetition", async () => {
    const outcomes = await Promise.allSettled([1, 2].map(() => savePerson(db, owner, { name: "Race", email: `race-${owner}@example.com` })));
    equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
    equal(outcomes.filter(x => x.status === "rejected" && x.reason instanceof HttpConflictError).length, 1);
    for (let index = 0; index < 52; index++) await savePerson(db, stranger, { name: `Contact ${index}` });
    const first = await listPeople(db, stranger);
    const second = await listPeople(db, stranger, first.nextCursor!);
    equal(first.people.length, 50); equal(second.people.length, 2); equal(second.nextCursor, null);
    equal(new Set([...first.people, ...second.people].map(x => x.id)).size, 52);
  });

  it("exchanges the real OAuth grant once with its correct PKCE verifier", async () => {
    const code = "native-oauth-grant-" + randomUUID(); const verifier = "v".repeat(43);
    await repo.createGrant({ userId: owner, grantHash: hashOauthValue(code), clientChallenge: hashOauthValue(verifier), expiresAt: new Date(Date.now() + 120_000) });
    const exchange = (codeVerifier: string) => exchangeOauthGrant({ code, codeVerifier }, { repo, accessTokenSecret });
    await rejects(() => exchange("w".repeat(43)), OauthFlowError);
    const session = await exchange(verifier);
    equal(session.user.id, owner); equal(session.expiresIn, 900); equal(session.accessToken.split(".").length, 3); equal(session.refreshToken.length, 43);
    await rejects(() => exchange(verifier), OauthFlowError);
    equal(await db.oauth_grants.count({ where: { grant_hash: hashOauthValue(code), consumed_at: { isNull: false } } }), 1);
  });

  it("searches the full owned agenda by literal name, email or phone before pagination", async () => {
    const target = await savePerson(db, stranger, { name: "Search target 100%", email: "needle@example.com", phone: "+5511999988776" });
    for (const search of ["TARGET", "needle@", "9988776", "100%"]) {
      deepEqual((await listPeople(db, stranger, undefined, false, search)).people.map(x => x.id), [target.id]);
      equal((await listPeople(db, owner, undefined, false, search)).people.length, 0);
    }
    equal((await listPeople(db, stranger, undefined, false, "no-match")).people.length, 0);
  });
});
