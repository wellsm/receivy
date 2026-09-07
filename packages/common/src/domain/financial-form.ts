const BRL_INPUT = /^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;

export function parseBRLCents(input: string): number {
  const value = input.trim();
  const match = BRL_INPUT.exec(value);
  if (!match) {
    throw new RangeError("Informe um valor em reais, como 125,90.");
  }

  const [whole = "0", fraction = ""] = value.replaceAll(".", "").split(",");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("O valor ultrapassa o limite permitido.");
  }
  return Number(cents);
}

export function calendarDate(date = new Date(), timeZone?: string): string {
  if (!timeZone) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }
  const values = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
