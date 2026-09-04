import type { Money } from "./contracts";

export function makeMoney(amountCents: number): Money {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError("amountCents must be a non-negative integer");
  }

  return { amountCents, currency: "BRL" };
}

export function formatMoney(money: Money, locale = "pt-BR"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  }).format(money.amountCents / 100);
}
