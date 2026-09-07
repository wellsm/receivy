import type { Money } from "./contracts";

export function makeMoney(amountCents: number): Money {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError("amountCents must be a non-negative integer");
  }
  if (!Number.isSafeInteger(amountCents)) {
    throw new RangeError("amountCents must be a non-negative safe integer");
  }

  return { amountCents, currency: "BRL" };
}

export function formatMoney(money: Money, locale = "pt-BR"): string {
  if (!Number.isSafeInteger(money.amountCents)) {
    throw new RangeError("amountCents must be a safe integer");
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  });
  const cents = BigInt(money.amountCents);
  const absolute = cents < 0n ? -cents : cents;
  const units = absolute / 100n;
  const signedUnits: bigint | number = cents < 0n
    ? units === 0n ? -0 : -units
    : units;
  const fraction = (absolute % 100n).toString().padStart(2, "0");

  return formatter.formatToParts(signedUnits).map(part =>
    part.type === "fraction" ? fraction : part.value
  ).join("");
}
