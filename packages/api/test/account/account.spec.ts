import { equal, ok, rejects, deepEqual, notEqual } from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Service } from "@ez4/common";
import type { ApiProvider } from "../../src/provider";
import { HttpForbiddenError, HttpUnauthorizedError } from "@ez4/gateway";
import { db, createUser, cleanupUsers } from "../fixtures/financial";
import { sessionAuthorizer } from "../../src/authorizers/session";
import { issueAccessToken } from "../../src/auth/session";
import { createAuthRepository } from "../../src/repositories/auth-repository";
import { registerDevice } from "../../src/notifications/repository";
import { savePerson } from "../../src/people/repository";
import { savePaymentMethod } from "../../src/payment-methods/repository";
import { createExpense } from "../../src/expenses/repository";
import { getCharge, recordManualPayment } from "../../src/charges/repository";
import { eraseAccount, updateProfile, listSessions, revokeSession, createExportTicket, downloadExport } from "../../src/account/repository";
import { BucketTester } from "@ez4/local-storage/test";
import type { ProofStorage } from "../../src/proofs/storage";
import { drainStorageDeletions } from "../../src/proofs/cleanup";
import { createOrRotatePublicLink, getPublicCharge } from "../../src/public/repository";

const owner = "61000000-0000-4000-8000-000000000001";
const debtor = "61000000-0000-4000-8000-000000000002";
const secret = "account-tests-only-secret";
const context = { db, variables: { AUTH_JWT_SECRET: secret } } as Service.Context<ApiProvider>;
const repository = createAuthRepository(db);
const ids = [owner, debtor];
const bucket = BucketTester.getClientMock("ProofFiles", { keys: {} });
const storage: ProofStorage = { uploadUrl: (key, mime) => bucket.getWriteUrl(key, { expiresIn: 300, contentType: mime }), downloadUrl: key => bucket.getReadUrl(key, { expiresIn: 60 }), read: key => bucket.read(key), write: (key, bytes) => bucket.write(key, bytes), delete: key => bucket.delete(key) };
async function session(userId: string) {
  const value = await repository.issueSession(userId, "Test installation");
  return { ...value, userId, access: issueAccessToken({ ...value, userId, secret }) };
}
async function authorize(access: string) { return sessionAuthorizer({ headers: { authorization: `Bearer ${access}` } }, context); }

describe("account lifecycle on dedicated PostgreSQL", () => {
  before(async () => {
    const [database] = await db.rawQuery("SELECT current_database() AS name");
    equal(database?.["name"], "receivy_tests");
    await createUser(db, { id: owner, email: "account-owner@example.com", name: "Account Owner" });
    await savePaymentMethod(db, owner, { pixKeyType: "email", pixKey: "account-owner@example.com" });
    await createUser(db, { id: debtor, email: "account-debtor@example.com", name: "Account Debtor" });
  });
  after(async () => {
    const families = await db.session_families.findMany({ select: { id: true }, where: { user_id: { isIn: ids } } });
    if (families.records.length) await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map(x => x.id) } } });
    await db.session_families.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.auth_identities.deleteMany({ where: { user_id: { isIn: ids } } });
    await cleanupUsers(db, ids);
  });
  it("rejects issued access after remote revocation and forbids foreign or missing families", async () => {
    const current = await session(owner);
    equal((await authorize(current.access)).identity.userId, owner);
    await rejects(() => revokeSession(db, debtor, current.familyId), HttpForbiddenError);
    equal((await listSessions(db, owner, current.familyId)).some(x => x.current), true);
    await revokeSession(db, owner, current.familyId);
    await rejects(() => authorize(current.access), HttpUnauthorizedError);
    await rejects(() => authorize(issueAccessToken({ familyId: current.familyId, userId: debtor, secret })), HttpUnauthorizedError);
    await rejects(() => authorize(issueAccessToken({ familyId: crypto.randomUUID(), userId: owner, secret })), HttpUnauthorizedError);
  });
  it("logout and refresh replay remove only corresponding push registrations plus unlinked legacy tokens", async () => {
    const first = await session(owner); const second = await session(owner);
    const a = await registerDevice(db, owner, { token: "ExpoPushToken[account_a]", installationId: "account-a", platform: "ios" }, first.familyId);
    const b = await registerDevice(db, owner, { token: "ExpoPushToken[account_b]", installationId: "account-b", platform: "android" }, second.familyId);
    const legacy = await registerDevice(db, owner, { token: "ExpoPushToken[account_legacy]", installationId: "account-legacy", platform: "ios" });
    await repository.revokeFamilyByRefreshToken(first.refreshToken);
    await rejects(() => authorize(first.access), HttpUnauthorizedError);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: a.id } }))?.active, false);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: b.id } }))?.active, true);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: legacy.id } }))?.active, false);
    equal((await repository.rotateRefreshToken(second.refreshToken)).kind, "rotated");
    const raced = await Promise.allSettled([
      repository.rotateRefreshToken(second.refreshToken),
      registerDevice(db, owner, { token: "ExpoPushToken[account_race]", installationId: "account-race", platform: "ios" }, second.familyId),
    ]);
    ok(raced[0].status === "fulfilled"); equal(raced[0].value.kind, "replayed");
    equal(await db.device_tokens.count({ where: { user_id: owner, session_family_id: second.familyId, active: true } }), 0);
    await rejects(() => authorize(second.access), HttpUnauthorizedError);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: b.id } }))?.active, false);
  });
  it("rolls back all identity and session changes if durable file enqueue fails", async () => {
    const id = crypto.randomUUID(); ids.push(id);
    await createUser(db, { id, email: "rollback-account@example.com", name: "Rollback fixture" });
    const person = await savePerson(db, owner, { name: "Rollback fixture", email: "rollback-account@example.com" });
    const expense = await createExpense(db, owner, "account-rollback", { totalCents: 50, installmentCount: 1, firstDueDate: "2026-10-01", split: { mode: "fixed", parts: [{ kind: "person", personId: person.id, amountCents: 50 }] } });
    const proofId = crypto.randomUUID(); const auth = await session(id);
    await db.payment_proofs.insertOne({ data: { id: proofId, charge: { id: expense.charges[0]!.id }, sender_user: { id }, object_key: "invalid-legacy-key", original_name: "fixture.pdf", mime: "application/pdf", size: 1, sha256: "0".repeat(64), state: "pending", created_at: new Date().toISOString() } });
    await rejects(() => eraseAccount(db, id, "EXCLUIR"), RangeError);
    equal((await authorize(auth.access)).identity.userId, id);
    equal((await getCharge(db, owner, expense.charges[0]!.id)).recipient.email, "rollback-account@example.com");
    equal(await db.payment_proofs.count({ where: { id: proofId } }), 1);
    await db.payment_proofs.deleteOne({ where: { id: proofId } });
  });
  it("validates profile and exports only own data with a short-lived session-bound signature", async () => {
    const auth = await session(owner); const foreign = await session(debtor);
    await updateProfile(db, owner, { name: "  Ana  ", locale: "pt-BR", timezone: "America/Manaus", country: "BR" });
    await rejects(() => updateProfile(db, owner, { name: " ", locale: "pt-BR", timezone: "bad/zone", country: "BR" }));
    await savePerson(db, debtor, { name: "Foreign private contact", email: "private-foreign@example.com" });
    const ticket = await createExportTicket(db, auth, secret, 1000);
    const exported = await downloadExport(db, auth, ticket.token, secret, 1001);
    equal(JSON.parse(exported.json).profile.name, "Ana");
    ok(!exported.json.includes("private-foreign"));
    for (const excluded of ["refreshToken", "token_hash", "code_hash", "ExpoPushToken", "object_key"]) ok(!exported.json.includes(excluded));
    await rejects(() => downloadExport(db, foreign, ticket.token, secret, 1001), HttpUnauthorizedError);
    await rejects(() => downloadExport(db, auth, ticket.token + "x", secret, 1001), HttpUnauthorizedError);
    await rejects(() => downloadExport(db, auth, ticket.token, secret, 1300), HttpUnauthorizedError);
    await revokeSession(db, owner, auth.familyId);
    await rejects(() => downloadExport(db, auth, ticket.token, secret, 1001), HttpUnauthorizedError);
  });
  it("atomically erases identity, preserves other account's payment fact and closes re-registration history access", async () => {
    const person = await savePerson(db, owner, { name: "Account Debtor", email: "account-debtor@example.com" });
    const expense = await createExpense(db, owner, "account-history", { totalCents: 1234, installmentCount: 1, firstDueDate: "2026-10-01", split: { mode: "fixed", parts: [{ kind: "person", personId: person.id, amountCents: 1234 }] } });
    const chargeId = expense.charges[0]!.id;
    const publicLink = await createOrRotatePublicLink(db, owner, chargeId, secret);
    await recordManualPayment(db, owner, chargeId, { method: "pix" });
    const ownedProofId = crypto.randomUUID(); const anonymousId = crypto.randomUUID();
    const ownKey = `proofs/${chargeId}/${ownedProofId}`; const anonymousKey = `proofs/${chargeId}/${anonymousId}`;
    for (const [id, key, sender] of [[ownedProofId, ownKey, debtor], [anonymousId, anonymousKey, null]] as const) {
      await bucket.write(key, Buffer.from("%PDF-1.7\nfixture"));
      await db.payment_proofs.insertOne({ data: { id, charge: { id: chargeId }, ...(sender ? { sender_user: { id: sender } } : {}), object_key: key, original_name: "fixture.pdf", mime: "application/pdf", size: 16, sha256: "0".repeat(64), state: "accepted", created_at: new Date().toISOString() } });
    }
    await db.payments.updateOne({ where: { charge_id: chargeId }, data: { proof: { id: ownedProofId } } });
    const current = await session(debtor);
    equal((await getCharge(db, debtor, chargeId)).direction, "payable");
    const concurrent = await Promise.all([eraseAccount(db, debtor, "EXCLUIR"), eraseAccount(db, debtor, "EXCLUIR")]);
    deepEqual(concurrent.map(result => result.deleted), [true, true]);
    // Exactly one erasure performs the work (no Apple identity => not_required); the loser observes an already-deleted row.
    deepEqual(concurrent.map(result => result.providerRevocation).sort(), ["not_required", "unknown"]);
    deepEqual(await eraseAccount(db, debtor, "EXCLUIR"), { deleted: true, providerRevocation: "unknown" });
    await rejects(() => authorize(current.access), HttpUnauthorizedError);
    const injectedFamily = crypto.randomUUID();
    await db.session_families.insertOne({ data: { id: injectedFamily, user: { id: debtor }, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() } });
    await rejects(() => authorize(issueAccessToken({ familyId: injectedFamily, userId: debtor, secret })), HttpUnauthorizedError, "deleted user is denied even when an old family was not marked revoked");
    await rejects(() => repository.issueSession(debtor), /Account unavailable/);
    equal((await repository.rotateRefreshToken(current.refreshToken)).kind, "invalid");
    const row = await getCharge(db, owner, chargeId);
    equal(row.state, "paid"); equal(row.payment?.amount.amountCents, 1234);
    equal(row.recipient.email, null); equal(row.recipient.name, "Conta excluída");
    await rejects(() => getPublicCharge(db, publicLink.token, secret));
    equal(await db.payment_proofs.count({ where: { id: ownedProofId } }), 0);
    equal(await db.payment_proofs.count({ where: { id: anonymousId } }), 1);
    equal((await db.payments.findOne({ select: { proof_id: true }, where: { charge_id: chargeId } }))?.proof_id, null);
    equal(await db.storage_deletions.count({ where: { object_key: ownKey } }), 1, "idempotent retries enqueue once");
    const stamp = Date.now();
    await drainStorageDeletions(db, { ...storage, delete: async () => { throw new Error("fixture unavailable"); } }, () => stamp);
    equal((await db.storage_deletions.findOne({ select: { state: true }, where: { object_key: ownKey } }))?.state, "pending");
    await drainStorageDeletions(db, storage, () => stamp + 61_000);
    equal((await db.storage_deletions.findOne({ select: { state: true }, where: { object_key: ownKey } }))?.state, "deleted");
    ok(await bucket.read(anonymousKey), "unattributed counterparty file preserved");
    await db.storage_deletions.deleteMany({ where: { charge_id: chargeId } });
    const replacement = await repository.findOrCreateUserByEmail("account-debtor@example.com"); ids.push(replacement.id);
    notEqual(replacement.id, debtor);
    await rejects(() => getCharge(db, replacement.id, chargeId), HttpForbiddenError);
    await rejects(() => savePerson(db, debtor, { name: "Stale request" }), HttpUnauthorizedError, "a pre-authorized request cannot recreate contacts after erasure");
    await rejects(() => savePaymentMethod(db, debtor, { pixKeyType: "email", pixKey: "stale@example.com" }), HttpUnauthorizedError);
  });
});
