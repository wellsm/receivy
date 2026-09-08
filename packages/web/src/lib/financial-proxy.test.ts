import { describe, expect, it } from "vitest";
import { isAllowedFinancialRoute } from "./financial-proxy";

describe("financial BFF allowlist", () => {
  it.each([
    ["GET", "billings"], ["POST", "billings"], ["GET", "billings/id"], ["PATCH", "billings/id"],
    ["GET", "billings/id/preview"],
    ["GET", "timeline"],
    ["GET", "payment-methods"], ["POST", "payment-methods"], ["PATCH", "payment-methods/method-id"],
    ["POST", "payment-methods/method-id/default"], ["POST", "payment-methods/method-id/archive"],
    ["GET", "charges/charge-id"], ["POST", "charges/charge-id/cancel"], ["POST", "charges/charge-id/payments"],
    ["POST", "charges/charge-id/public-link"], ["POST", "charges/charge-id/public-link/rotate"], ["DELETE", "charges/charge-id/public-link"],
    ["GET", "people/person-id/ledger"],
  ])("allows %s %s", (method, path) => expect(isAllowedFinancialRoute(method, path)).toBe(true));

  it.each([
    ["POST", "timeline"], ["DELETE", "charges/id"], ["GET", "auth/me"], ["GET", "../auth/me"],
    ["POST", "public/charges/token"], ["PATCH", "billings/id/nested"],
  ])("rejects %s %s", (method, path) => expect(isAllowedFinancialRoute(method, path)).toBe(false));
});
