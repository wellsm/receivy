import type { ExpenseSplit } from "@receivy/common";
import { createHash } from "node:crypto";

export type ExpenseRequestInput = {
  description?: string;
  totalCents: number;
  installmentCount: number;
  firstDueDate: string;
  split: ExpenseSplit;
  paymentMethodId?: string;
};

export function normalizeExpenseInput(input: ExpenseRequestInput): ExpenseRequestInput & { description: string } {
  const description = input.description?.normalize("NFC").trim() || "Cobrança";
  return { ...input, description };
}

export function expenseRequestFingerprint(input: ExpenseRequestInput): string {
  const normalized = normalizeExpenseInput(input);
  const canonical = JSON.stringify({
    description: normalized.description,
    totalCents: normalized.totalCents,
    installmentCount: normalized.installmentCount,
    firstDueDate: normalized.firstDueDate,
    split: normalized.split,
    paymentMethodId: normalized.paymentMethodId ?? null,
  }, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value);
  return createHash("sha256").update(canonical).digest("base64url");
}
