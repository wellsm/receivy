import { equal, rejects, deepEqual } from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { HttpConflictError, HttpNotFoundError } from "@ez4/gateway";
import { db, createUser, cleanupUsers } from "../fixtures/financial";
import { savePerson } from "../../src/people/repository";
import { savePaymentMethod } from "../../src/payment-methods/repository";
import { createExpense } from "../../src/expenses/repository";
import { getCharge } from "../../src/charges/repository";
import { createOrRotatePublicLink, revokePublicLink } from "../../src/public/repository";
import { runNotifications } from "../../src/notifications/worker";
import type { NotificationTransport } from "../../src/notifications/transport";

const owner = randomUUID(), other = randomUUID(); const secret = "first-publication-tests-only-secret";
const config = { publicOrigin: "https://receivy.example", secret };
const sent: string[] = [];
const transport: NotificationTransport = { email: async x => { sent.push(x.key); return { status: "accepted", id: "fixture" }; }, push: async () => ({ status: "disabled" }), receipt: async () => ({ status: "delivered" }) };
let chargeId: string;
describe("explicit first Pix publication", () => {
  before(async () => {
    await createUser(db, { id: owner, name: "Owner", email: `${owner}@example.com` });
    await createUser(db, { id: other, name: "Other", email: `${other}@example.com` });
    const person = await savePerson(db, owner, { name: "Debtor", email: "publication-debtor@example.com" });
    chargeId = (await createExpense(db, owner, "first-pix", { totalCents: 100, installmentCount: 1, firstDueDate: "2030-01-01", split: { mode: "fixed", parts: [{ kind: "person", personId: person.id, amountCents: 100 }] } })).charges[0]!.id;
  });
  after(async () => cleanupUsers(db, [owner, other]));
  it("keeps no-Pix creation possible but refuses first sharing and makes initial notice visibly wait", async () => {
    equal((await getCharge(db, owner, chargeId)).pix, null);
    equal((await getCharge(db, owner, chargeId)).sharingState, "pix_required");
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret), HttpConflictError);
    await runNotifications(db, transport, config);
    equal(await db.public_links.count({ where: { charge_id: chargeId } }), 0);
    equal(sent.length, 0);
    equal(await db.notification_deliveries.count({ where: { charge_id: chargeId, state: "suppressed", reason: "pix_required" } }), 1);
  });
  it("assigns only an owned selected Pix snapshot once, releases notice once and preserves published history", async () => {
    const foreign = await savePaymentMethod(db, other, { pixKeyType: "email", pixKey: "foreign@example.com" });
    const first = await savePaymentMethod(db, owner, { pixKeyType: "email", pixKey: "first@example.com" });
    const second = await savePaymentMethod(db, owner, { pixKeyType: "email", pixKey: "second@example.com" });
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret, false, undefined, foreign.id), HttpNotFoundError);
    const [a,b] = await Promise.all([1,2].map(() => createOrRotatePublicLink(db, owner, chargeId, secret, false, undefined, first.id)));
    deepEqual(a,b); equal((await getCharge(db, owner, chargeId)).pix?.key, "first@example.com");
    equal((await getCharge(db, owner, chargeId)).sharingState, "ready");
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret, false, undefined, second.id), HttpConflictError);
    await runNotifications(db, transport, config); await runNotifications(db, transport, config);
    equal(sent.length, 1); equal(new Set(sent).size, 1);
    await savePaymentMethod(db, owner, { pixKeyType: "email", pixKey: "edited@example.com" }, first.id);
    equal((await getCharge(db, owner, chargeId)).pix?.key, "first@example.com");
    equal(await db.activity_events.count({ where: { aggregate_id: chargeId, type: "charge.pix_published" } }), 1);
  });
  it("never fills a previously published null-Pix record, including a revoked tombstone", async () => {
    await db.charges.updateOne({ where: { id: chargeId }, data: { pix_key_snapshot: null as unknown as undefined, pix_key_type_snapshot: null as unknown as undefined } });
    await revokePublicLink(db, owner, chargeId);
    equal((await getCharge(db, owner, chargeId)).sharingState, "legacy_without_pix");
    const method = await savePaymentMethod(db, owner, { pixKeyType: "email", pixKey: "legacy@example.com" });
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret, true, undefined, method.id), HttpConflictError);
    equal((await getCharge(db, owner, chargeId)).pix, null);
  });
});
