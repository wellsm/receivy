import type { Money } from './contracts';

export function makeMoney(amountCents: number): Money {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError('amountCents must be a non-negative integer');
  }
  if (!Number.isSafeInteger(amountCents)) {
    throw new RangeError('amountCents must be a non-negative safe integer');
  }

  return { amountCents, currency: 'BRL' };
}

export function formatMoney(money: Money, locale = 'pt-BR'): string {
  if (!Number.isSafeInteger(money.amountCents)) {
    throw new RangeError('amountCents must be a safe integer');
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency
  });
  const cents = BigInt(money.amountCents);
  const absolute = cents < 0n ? -cents : cents;
  const units = absolute / 100n;
  // Integer units fit a Number exactly (at most ~9e13). Hermes on Android
  // throws "Cannot convert BigInt to number" when formatToParts receives a
  // bigint, so both paths format a Number; -0 keeps the sign for |x| < R$ 1.
  const signedUnits = cents < 0n ? (units === 0n ? -0 : -Number(units)) : Number(units);
  const fraction = (absolute % 100n).toString().padStart(2, '0');

  if (typeof formatter.formatToParts === 'function') {
    return formatter
      .formatToParts(signedUnits)
      .map((part) => (part.type === 'fraction' ? fraction : part.value))
      .join('');
  }

  // Hermes (React Native) ships Intl.NumberFormat without formatToParts. Format
  // the integer units (safe as a Number: at most ~9e13) so the currency style
  // yields a "00" fraction, then substitute the exact cents. The sign is applied
  // manually because the engine's handling of -0 is not guaranteed.
  const formatted = formatter.format(Number(units)).replace(/00(?=\D*$)/, fraction);
  return cents < 0n ? `-${formatted}` : formatted;
}
