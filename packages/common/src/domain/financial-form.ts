const BRL_INPUT = /^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;

export function parseBRLCents(input: string): number {
  const value = input.trim();
  const match = BRL_INPUT.exec(value);
  if (!match) {
    throw new RangeError('Informe um valor em reais, como 125,90.');
  }

  const [whole = '0', fraction = ''] = value.replaceAll('.', '').split(',');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('O valor ultrapassa o limite permitido.');
  }
  return Number(cents);
}

/** Strips everything but digits, then drops leading zeros (keeps `''` when nothing is left). */
export function amountInputToDigits(input: string): string {
  const digits = input.replaceAll(/\D/g, '');

  return digits.replace(/^0+/, '');
}

/** Bank-style keypad rendering of raw amount digits: the last two digits are always the cents. */
export function amountDigitsToInput(digits: string): string {
  const clean = amountInputToDigits(digits) || '0';
  const padded = clean.padStart(3, '0');
  const whole = String(Number(padded.slice(0, -2)));
  const cents = padded.slice(-2);

  return `${whole},${cents}`;
}

/** Same as `amountDigitsToInput`, with pt-BR thousand separators on the whole part. */
export function formatAmountDigits(digits: string): string {
  const [whole, cents] = amountDigitsToInput(digits).split(',') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${grouped},${cents}`;
}

/** Adds `cents` to a bank-style amount string, tolerant of an empty or unparsable amount. */
export function addCentsToAmount(input: string, cents: number): string {
  let currentCents = 0;

  try {
    currentCents = parseBRLCents(input);
  } catch {
    currentCents = 0;
  }

  return amountDigitsToInput(String(currentCents + cents));
}

const PERCENTAGE_INPUT = /^(\d{1,3})(?:[,.](\d{1,2}))?$/;

export function parsePercentageBasisPoints(input: string): number {
  const match = PERCENTAGE_INPUT.exec(input);
  if (!match) {
    throw new RangeError('Informe um percentual entre 0 e 100, com até duas casas decimais.');
  }

  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (basisPoints > 10_000) {
    throw new RangeError('Informe um percentual entre 0 e 100, com até duas casas decimais.');
  }
  return basisPoints;
}

export function calendarDate(date = new Date(), timeZone?: string): string {
  if (!timeZone) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}
