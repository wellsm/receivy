import { equal } from "node:assert/strict";
import { after, before, it } from "node:test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { db } from "../fixtures/financial";
import { createAuthRepository } from "../../src/repositories/auth-repository";
import { requestEmailCode } from "../../src/auth/email-login";
import { allowEmailCode } from "../../src/security/throttle";

const email = `${randomUUID()}@example.com`, codeHashKey = "otp-policy-fixture-key-with-32-bytes";
const hashes = new Set<string>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4", "203.0.113.5", "203.0.113.44", "192.0.2.144"]) hashes.add(digest(`otp-request-ip:${ip}`));
before(async () => { await db.proof_throttles.deleteMany({ where: { id: { isIn: [...hashes] } } }); });
after(async () => { await db.login_codes.deleteMany({ where: { email } }); await db.proof_throttles.deleteMany({ where: { id: { isIn: [...hashes] } } }); });
it("serializes first-code creation so simultaneous requests retain anti-enumeration/cooldown", async () => {
  let sent = 0;
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => requestEmailCode({ email }, { repo: createAuthRepository(db), codeHashKey, generateCode: () => "123456", transport: { sendLoginCode: async () => { sent++; } } })));
  equal(results.filter(result => result.status === "fulfilled").length, 5); equal(sent, 1);
  equal(await db.login_codes.count({ where: { email } }), 1);
});
it("limits normalized email hashes across IP changes and each IP across distinct emails", async () => {
  const prefix = randomUUID();
  for (const address of [`${prefix}@example.com`, ...Array.from({ length: 30 }, (_, index) => `${prefix}-${index}@example.com`), `${prefix}-extra@example.com`]) hashes.add(digest(`otp-request-email:${createHmac("sha256", codeHashKey).update(address).digest("hex")}`));
  for (let index = 0; index < 5; index++) equal(await allowEmailCode(db, `${prefix}@example.com`, codeHashKey, { sourceIp: `203.0.113.${index + 1}` }), true);
  equal(await allowEmailCode(db, ` ${prefix.toUpperCase()}@EXAMPLE.COM `, codeHashKey, { sourceIp: "203.0.113.44" }), false);
  for (let index = 0; index < 30; index++) equal(await allowEmailCode(db, `${prefix}-${index}@example.com`, codeHashKey, { sourceIp: "192.0.2.144" }), true);
  equal(await allowEmailCode(db, `${prefix}-extra@example.com`, codeHashKey, { sourceIp: "192.0.2.144" }), false);
});
