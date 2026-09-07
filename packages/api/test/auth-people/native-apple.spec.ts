import { equal, ok, rejects } from "node:assert/strict";
import { after, it } from "node:test";
import { randomUUID } from "node:crypto";
import { db, cleanupUsers } from "../fixtures/financial";
import { beginNativeApple, exchangeNativeApple } from "../../src/auth/apple-native";
import { hashOauthValue } from "../../src/auth/oauth";
import { journalAppleCredential, bindAppleCredential } from "../../src/auth/apple-credentials";
import type { OauthProviderClient } from "../../src/auth/oauth-flow";
import { createAuthRepository } from "../../src/repositories/auth-repository";

const key = Buffer.alloc(32, 8).toString("base64"), verifier = "a".repeat(43), secret = "native-apple-fixture-only-secret";
const users: string[] = [], journals: string[] = [], states: string[] = [];
after(async () => {
  await db.apple_credentials.deleteMany({ where: { id: { isIn: journals } } });
  await db.oauth_attempts.deleteMany({ where: { state_hash: { isIn: states } } });
  const families = await db.session_families.findMany({ select: { id: true }, where: { user_id: { isIn: users } } });
  if (families.records.length) await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map(row => row.id) } } });
  await db.session_families.deleteMany({ where: { user_id: { isIn: users } } });
  await db.auth_identities.deleteMany({ where: { user_id: { isIn: users } } });
  await cleanupUsers(db, users);
});
it("binds native challenge/verifier/state, exchanges once concurrently, and commits identity/session/credential together", async () => {
  const challenge = await beginNativeApple(db, hashOauthValue(verifier)); states.push(hashOauthValue(challenge.state));
  const subject = randomUUID(), email = `${subject}@example.com`; let calls = 0;
  const client: OauthProviderClient = { authorizationUrl: () => "unused", verifyAuthorizationCode: async input => {
    calls++; equal(input.nonce, challenge.nonce); equal(input.code, "native-code");
    const id = await journalAppleCredential(db, key, "native-client", "fixture-refresh"); journals.push(id); await bindAppleCredential(db, key, id, subject);
    return { subject, email, emailAuthoritative: true, appleCredentialId: id };
  } };
  await rejects(() => exchangeNativeApple(db, { state: challenge.state, codeVerifier: "wrong".repeat(10), authorizationCode: "native-code" }, client, secret)); equal(calls, 0);
  const results = await Promise.allSettled([1, 2].map(() => exchangeNativeApple(db, { state: challenge.state, codeVerifier: verifier, authorizationCode: "native-code" }, client, secret)));
  equal(results.filter(row => row.status === "fulfilled").length, 1); equal(calls, 1);
  const winner = results.find(row => row.status === "fulfilled"); ok(winner?.status === "fulfilled"); users.push(winner.value.user.id);
  equal(await db.session_families.count({ where: { user_id: winner.value.user.id } }), 1);
  equal(await db.apple_credentials.count({ where: { user_id: winner.value.user.id, state: "active" } }), 1);
  await rejects(() => exchangeNativeApple(db, { state: challenge.state, codeVerifier: verifier, authorizationCode: "native-code" }, client, secret)); equal(calls, 1);
});
it("rejects browser/native challenge substitution before provider I/O", async () => {
  const state = randomUUID(); states.push(hashOauthValue(state));
  await createAuthRepository(db).createAttempt({ provider: "apple", clientChallenge: hashOauthValue(verifier), stateHash: hashOauthValue(state), destination: "receivy://auth/callback", nonce: "web-nonce", codeVerifier: verifier, expiresAt: new Date(Date.now() + 60_000) });
  const client: OauthProviderClient = { authorizationUrl: () => "unused", verifyAuthorizationCode: async () => { throw new Error("must not call provider"); } };
  await rejects(() => exchangeNativeApple(db, { state, codeVerifier: verifier, authorizationCode: "web-code" }, client, secret));
  equal((await db.oauth_attempts.findOne({ select: { consumed_at: true }, where: { provider: "apple", state_hash: hashOauthValue(state) } }))?.consumed_at, null);
});
