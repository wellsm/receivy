import { BillingType, SplitMode, SplitPartKind } from "@receivy/common";
import { createFinancialClient, FinancialRequestError } from "./client";

describe("native financial client", () => {
  it("keeps the caller idempotency key on billing requests", async () => {
    const authenticatedFetch = jest.fn().mockResolvedValue(Response.json({ id: "billing", charges: [] }, { status: 201 }));
    const client = createFinancialClient({ authenticatedFetch, publicWebBaseUrl: "https://receivy.example" });
    await client.createBilling({ type: BillingType.Once, totalCents: 100, startDate: "2026-09-10", timezone: "America/Sao_Paulo", split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] } }, "same-key");
    expect(authenticatedFetch).toHaveBeenCalledWith("billings", expect.objectContaining({ headers: expect.objectContaining({ "idempotency-key": "same-key" }) }));
  });

  it("builds public links only from the explicit web base", () => {
    const client = createFinancialClient({ authenticatedFetch: jest.fn(), publicWebBaseUrl: "https://receivy.example/app" });
    expect(client.publicChargeUrl("token.with.parts")).toBe("https://receivy.example/pay/token.with.parts");
  });

  it("reports actionable configuration when the web base is absent", () => {
    const client = createFinancialClient({ authenticatedFetch: jest.fn() });
    expect(() => client.publicChargeUrl("token")).toThrow("EXPO_PUBLIC_WEB_URL");
  });

  it("translates the stable code without displaying arbitrary backend text", async () => {
    const authenticatedFetch = jest.fn().mockResolvedValue(Response.json({ code: "INVALID_REQUEST", message: "private SQL parameter" }, { status: 400 }));
    const client = createFinancialClient({ authenticatedFetch });
    await expect(client.timeline()).rejects.toMatchObject<Partial<FinancialRequestError>>({ message: "Confira os dados informados.", status: 400 });
  });

  it("switches the notices of a participant and of a charge with PUT", async () => {
    const authenticatedFetch = jest.fn().mockImplementation(() => Promise.resolve(Response.json({ id: "x" })));
    const client = createFinancialClient({ authenticatedFetch });

    await client.silenceParticipant("billing", "user", true);
    await client.silenceCharge("charge", false);

    expect(authenticatedFetch).toHaveBeenNthCalledWith(1, "billings/billing/participants/user/silenced", { method: "PUT", body: JSON.stringify({ silenced: true }) });
    expect(authenticatedFetch).toHaveBeenNthCalledWith(2, "charges/charge/silenced", { method: "PUT", body: JSON.stringify({ silenced: false }) });
  });
});
