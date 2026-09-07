import { createFinancialClient, FinancialRequestError } from "./client";

describe("native financial client", () => {
  it("keeps the caller idempotency key on expense requests", async () => {
    const authenticatedFetch = jest.fn().mockResolvedValue(Response.json({ id: "expense", charges: [] }, { status: 201 }));
    const client = createFinancialClient({ authenticatedFetch, publicWebBaseUrl: "https://receivy.example" });
    await client.createExpense({ totalCents: 100, installmentCount: 1, firstDueDate: "2026-09-10", split: { mode: "equal", parts: [{ kind: "owner" }] } }, "same-key");
    expect(authenticatedFetch).toHaveBeenCalledWith("expenses", expect.objectContaining({ headers: expect.objectContaining({ "idempotency-key": "same-key" }) }));
  });

  it("builds public links only from the explicit web base", () => {
    const client = createFinancialClient({ authenticatedFetch: jest.fn(), publicWebBaseUrl: "https://receivy.example/app" });
    expect(client.publicChargeUrl("token.with.parts")).toBe("https://receivy.example/pay/token.with.parts");
  });

  it("reports actionable configuration when the web base is absent", () => {
    const client = createFinancialClient({ authenticatedFetch: jest.fn() });
    expect(() => client.publicChargeUrl("token")).toThrow("EXPO_PUBLIC_WEB_URL");
  });

  it("preserves a typed API message for financial overflow", async () => {
    const authenticatedFetch = jest.fn().mockResolvedValue(Response.json({ message: "O total financeiro ultrapassa o limite exato." }, { status: 422 }));
    const client = createFinancialClient({ authenticatedFetch });
    await expect(client.timeline()).rejects.toMatchObject<Partial<FinancialRequestError>>({ message: "O total financeiro ultrapassa o limite exato.", status: 422 });
  });
});
