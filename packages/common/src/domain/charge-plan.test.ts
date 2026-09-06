import { describe, expect, it } from "vitest";
import { planExpenseCharges } from "./charge-plan";

const input = {
  description: "  Compra compartilhada  ", totalCents: 100, installmentCount: 3,
  firstDueDate: "2028-01-31", split: { mode: "equal" as const, parts: [
    { kind: "person" as const, personId: "ana" },
    { kind: "owner" as const },
  ] },
};

describe("charge plan", () => {
  it("produces only external charges and restores the original day after February", () => {
    expect(planExpenseCharges(input)).toEqual({
      description: "Compra compartilhada", currency: "BRL", totalCents: 100,
      allocations: [
        { kind: "person", personId: "ana", amountCents: 50, installments: [17, 17, 16] },
        { kind: "owner", amountCents: 50, installments: [17, 17, 16] },
      ],
      charges: [
        { personId: "ana", description: "Compra compartilhada", amountCents: 17, currency: "BRL", dueDate: "2028-01-31", installment: 1, installmentCount: 3 },
        { personId: "ana", description: "Compra compartilhada", amountCents: 17, currency: "BRL", dueDate: "2028-02-29", installment: 2, installmentCount: 3 },
        { personId: "ana", description: "Compra compartilhada", amountCents: 16, currency: "BRL", dueDate: "2028-03-31", installment: 3, installmentCount: 3 },
      ],
    });
  });

  it("clamps non-leap February and rolls December into the following year", () => {
    expect(planExpenseCharges({ ...input, firstDueDate: "2026-12-31" }).charges.map(charge => charge.dueDate))
      .toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
  });

  it("does not create zero-cent charges when tiny totals are divided", () => {
    const plan = planExpenseCharges({ ...input, totalCents: 1 });
    expect(plan.charges).toHaveLength(1);
    expect(plan.charges[0]).toMatchObject({ amountCents: 1, installment: 1, installmentCount: 3 });
  });

  it("rejects impossible or non-ISO calendar dates", () => {
    for (const firstDueDate of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "0000-01-01", "2026-01-01T00:00:00Z", "9999-12-01"]) {
      expect(() => planExpenseCharges({ ...input, firstDueDate })).toThrow();
    }
  });

  it("rejects empty and unbounded descriptions", () => {
    for (const description of ["", "   ", "a".repeat(501)]) {
      expect(() => planExpenseCharges({ ...input, description })).toThrow();
    }
  });
});
