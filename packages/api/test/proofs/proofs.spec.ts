import { equal, ok, rejects } from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { HttpConflictError, HttpForbiddenError, HttpNotFoundError } from "@ez4/gateway";
import { savePerson } from "../../src/people/repository";
import { createExpense } from "../../src/expenses/repository";
import { cancelCharge, recordManualPayment } from "../../src/charges/repository";
import { createOrRotatePublicLink, revokePublicLink } from "../../src/public/repository";
import { createUploadIntent, finalizeProof, listProofs, reviewProof, downloadProof, publicProofStatus } from "../../src/proofs/repository";
import { throttleProof } from "../../src/proofs/throttle";
import type { ProofStorage } from "../../src/proofs/storage";
import { getTimeline } from "../../src/timeline/repository";
import { cleanupUsers, createUser, db } from "../fixtures/financial";

const OWNER = "a1111111-1111-4111-8111-111111111111";
const DEBTOR = "a2222222-2222-4222-8222-222222222222";
const OTHER = "a3333333-3333-4333-8333-333333333333";
const SECRET = "proof-native-test-secret-with-enough-entropy";
const objects = new Map<string, Buffer>();
const storage: ProofStorage = {
  uploadUrl: async key => `https://storage.test/${key}`,
  read: async key => { const value = objects.get(key); if (!value) throw new Error("missing"); return Buffer.from(value); },
  write: async (key, bytes) => { objects.set(key, Buffer.from(bytes)); },
  delete: async key => { objects.delete(key); },
  downloadUrl: async key => `https://storage.test/${key}?attachment=1`,
};
const actor = { userId: DEBTOR };
const input = { filename: "proof.pdf", mime: "application/pdf" as const, size: 14 };
let counter = 0;
let personId: string;
async function charge() {
  if (!personId) personId = (await savePerson(db, OWNER, { name: "Proof debtor", email: "proof-debtor@example.com" })).id;
  const expense = await createExpense(db, OWNER, `proof-${++counter}`, { totalCents: 1234, installmentCount: 1,
    firstDueDate: "2027-01-01", split: { mode: "fixed", parts: [{ kind: "person", personId, amountCents: 1234 }] } });
  return expense.charges[0]!.id;
}
async function upload(id: string) {
  const intent = await createUploadIntent(db, storage, id, actor, input);
  objects.set(new URL(intent.uploadUrl).pathname.slice(1), Buffer.from("%PDF-1.7\nproof"));
  return { intent, proof: await finalizeProof(db, storage, id, actor, intent.id) };
}
describe("private proof transactions on PostgreSQL", () => {
  before(async () => {
    const [row] = await db.rawQuery("SELECT current_database() AS name"); equal(row?.["name"], "receivy_tests");
    await createUser(db, { id: OWNER, email: "proof-owner@example.com", name: "Proof Owner" });
    await createUser(db, { id: DEBTOR, email: "proof-debtor@example.com", name: "Proof Debtor" });
    await createUser(db, { id: OTHER, email: "proof-other@example.com", name: "Other" });
  });
  after(async () => cleanupUsers(db, [OWNER, DEBTOR, OTHER]));
  it("allows one pending proof, immutable finalized bytes and no replay", async () => {
    const id = await charge(); const { intent, proof } = await upload(id);
    await rejects(() => createUploadIntent(db, storage, id, actor, input), HttpConflictError);
    await rejects(() => finalizeProof(db, storage, id, actor, intent.id), HttpConflictError);
    const row = await db.payment_proofs.findOne({ select: { object_key: true, sha256: true }, where: { id: proof.id } }); ok(row);
    objects.set(new URL(intent.uploadUrl).pathname.slice(1), Buffer.from("evil replacement"));
    equal(objects.get(row.object_key)?.toString(), "%PDF-1.7\nproof");
    equal(row.sha256.length, 64);
    await rejects(() => listProofs(db, id, OTHER), HttpForbiddenError);
    await rejects(() => reviewProof(db, id, DEBTOR, proof.id, { decision: "accepted" }), HttpForbiddenError);
    await rejects(() => downloadProof(db, storage, id, OTHER, proof.id), HttpForbiddenError);
    equal((await listProofs(db, id, DEBTOR)).length, 1);
    await reviewProof(db, id, OWNER, proof.id, { decision: "rejected", reason: "Confira o valor" });
    const retry = await upload(id); ok(retry.proof.id !== proof.id);
  });
  it("serializes concurrent acceptance and writes integral payment/outbox/timeline", async () => {
    const id = await charge(); const { proof } = await upload(id);
    const results = await Promise.allSettled([reviewProof(db, id, OWNER, proof.id, { decision: "accepted" }), reviewProof(db, id, OWNER, proof.id, { decision: "accepted" })]);
    equal(results.filter(x => x.status === "fulfilled").length, 1);
    equal(await db.payments.count({ where: { charge_id: id } }), 1);
    const payment = await db.payments.findOne({ select: { amount_cents: true, proof_id: true }, where: { charge_id: id } });
    equal(payment?.amount_cents, 1234); equal(payment?.proof_id, proof.id);
    equal(await db.outbox_events.count({ where: { aggregate_id: id, type: "proof.accepted" } }), 1);
    const timeline = await getTimeline(db, OWNER, {});
    ok(timeline.items.some(x => x.kind === "proof" && x.proof.id === proof.id));
    ok(timeline.items.some(x => x.kind === "payment" && x.payment.chargeId === id));
  });
  it("closes pending proofs when manual payment/cancellation wins and retains history", async () => {
    for (const action of ["paid", "cancelled"] as const) {
      const id = await charge(); const { proof } = await upload(id);
      if (action === "paid") await recordManualPayment(db, OWNER, id, { method: "cash" }); else await cancelCharge(db, OWNER, id);
      const [closed] = await listProofs(db, id, OWNER); equal(closed?.state, "rejected"); equal(closed?.closureReason, action);
      await rejects(() => reviewProof(db, id, OWNER, proof.id, { decision: "accepted" }), HttpConflictError);
      await rejects(() => createUploadIntent(db, storage, id, actor, input), HttpConflictError);
      ok(await downloadProof(db, storage, id, OWNER, proof.id));
    }
  });
  it("rechecks revoked capability and rejects foreign intent finalization", async () => {
    const id = await charge(); const link = await createOrRotatePublicLink(db, OWNER, id, SECRET);
    const publicActor = { token: link.token, secret: SECRET };
    const intent = await createUploadIntent(db, storage, id, publicActor, input);
    await rejects(() => finalizeProof(db, storage, id, actor, intent.id), HttpNotFoundError);
    await revokePublicLink(db, OWNER, id);
    await rejects(() => finalizeProof(db, storage, id, publicActor, intent.id), HttpNotFoundError);
  });
  it("rejects invalid bytes without creating a proof, and checks state again after storage I/O", async () => {
    const id = await charge(); const intent = await createUploadIntent(db, storage, id, actor, input);
    objects.set(new URL(intent.uploadUrl).pathname.slice(1), Buffer.from("<html>bad</html>"));
    await rejects(() => finalizeProof(db, storage, id, actor, intent.id));
    equal(await db.payment_proofs.count({ where: { charge_id: id } }), 0);
    objects.set(new URL(intent.uploadUrl).pathname.slice(1), Buffer.from("%PDF-1.7\nproof"));
    const racing: ProofStorage = { ...storage, async write(key, bytes, mime) { await storage.write(key, bytes, mime); await cancelCharge(db, OWNER, id); } };
    await rejects(() => finalizeProof(db, racing, id, actor, intent.id), HttpConflictError);
    equal(await db.payment_proofs.count({ where: { charge_id: id } }), 0);
    equal(await db.upload_intents.count({ where: { charge_id: id, state: "pending" } }), 0);
  });
  it("keeps public proof history private and exposes only the submitting intent's status", async () => {
    const id = await charge(); const link = await createOrRotatePublicLink(db, OWNER, id, SECRET);
    const publicActor = { token: link.token, secret: SECRET };
    const intent = await createUploadIntent(db, storage, id, publicActor, input);
    objects.set(new URL(intent.uploadUrl).pathname.slice(1), Buffer.from("%PDF-1.7\nproof"));
    const proof = await finalizeProof(db, storage, id, publicActor, intent.id);
    equal((await listProofs(db, id, DEBTOR)).length, 0);
    await rejects(() => downloadProof(db, storage, id, DEBTOR, proof.id), HttpNotFoundError);
    const status = await publicProofStatus(db, link.token, SECRET, intent.id);
    equal(Object.keys(status).sort().join(","), "closureReason,reason,state");
    await reviewProof(db, id, OWNER, proof.id, { decision: "rejected", reason: "Confira a data" });
    equal((await publicProofStatus(db, link.token, SECRET, intent.id)).reason, "Confira a data");
  });
  it("serializes proof acceptance with manual payment and never produces two payments", async () => {
    const id = await charge(); const { proof } = await upload(id);
    const outcomes = await Promise.allSettled([reviewProof(db, id, OWNER, proof.id, { decision: "accepted" }), recordManualPayment(db, OWNER, id, { method: "cash" })]);
    equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    equal(await db.payments.count({ where: { charge_id: id } }), 1);
    equal(await db.payment_proofs.count({ where: { charge_id: id, state: "pending" } }), 0);
  });
  it("persists quota across invocations and uses a shared unknown-client bucket", async () => {
    const now = Date.now() + 600_000;
    for (let attempt = 0; attempt < 12; attempt++) await throttleProof(db, "quota-native-proof", now);
    await rejects(() => throttleProof(db, "quota-native-proof", now), error => (error as { status: number }).status === 429);
    // Rotating capability does not reset the shared client quota; no forwarded header enters this API.
    for (let attempt = 13; attempt < 120; attempt++) await throttleProof(db, `quota-${attempt}`, now);
    await rejects(() => throttleProof(db, "quota-another", now), error => (error as { status: number }).status === 429);
    await throttleProof(db, "quota-native-proof", now + 600_001);
    await db.proof_throttles.deleteMany({});
  });
});
