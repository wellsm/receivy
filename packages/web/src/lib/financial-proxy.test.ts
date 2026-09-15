import { describe, expect, it } from "vitest";
import { isAllowedFinancialRoute } from "./financial-proxy";

describe("financial BFF allowlist", () => {
  it.each([
    ["GET", "billings"], ["POST", "billings"], ["GET", "billings/id"], ["PATCH", "billings/id"],
    ["GET", "billings/id/preview"],
    ["GET", "timeline"],
    ["GET", "payment-methods"], ["POST", "payment-methods"], ["PATCH", "payment-methods/method-id"],
    ["POST", "payment-methods/method-id/default"], ["POST", "payment-methods/method-id/archive"],
    ["GET", "charges/charge-id"], ["POST", "charges/charge-id/cancel"], ["POST", "charges/charge-id/pay"],
    ["POST", "charges/charge-id/public-link"], ["POST", "charges/charge-id/public-link/rotate"], ["DELETE", "charges/charge-id/public-link"],
    ["POST", "charges/charge-id/proof"], ["DELETE", "charges/charge-id/proof"], ["POST", "charges/charge-id/proof/review"], ["GET", "charges/charge-id/proof/download"],
    ["POST", "charges/charge-id/proof/declaration"],
    ["PUT", "billings/id/participants/user-id/silenced"], ["PUT", "charges/charge-id/silenced"],
    ["GET", "contacts/contact-id/ledger"],
  ])("allows %s %s", (method, path) => expect(isAllowedFinancialRoute(method, path)).toBe(true));

  it.each([
    ["POST", "timeline"], ["DELETE", "charges/id"], ["GET", "auth/me"], ["GET", "../auth/me"],
    ["POST", "public/charges/token"], ["PATCH", "billings/id/nested"],
    ["POST", "charges/charge-id/payments"], ["GET", "charges/charge-id/proofs"], ["GET", "charges/charge-id/proof"],
    ["POST", "charges/charge-id/silenced"], ["PUT", "charges/charge-id/silenced/extra"], ["PATCH", "billings/id/participants/user-id/silenced"], ["PUT", "billings/id/participants/user-id"],
  ])("rejects %s %s", (method, path) => expect(isAllowedFinancialRoute(method, path)).toBe(false));
});
