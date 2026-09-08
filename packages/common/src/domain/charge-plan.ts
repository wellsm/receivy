import { type ExpenseSplit, type ResolvedAllocation, resolveExpenseSplit } from './split';

export type ExpensePlanInput = {
  description: string;
  totalCents: number;
  installmentCount: number;
  firstDueDate: string;
  split: ExpenseSplit;
};

export type PlannedCharge = {
  personId: string;
  description: string;
  amountCents: number;
  currency: 'BRL';
  dueDate: string;
  installment: number;
  installmentCount: number;
};

export type ExpensePlan = {
  description: string;
  currency: 'BRL';
  totalCents: number;
  allocations: ResolvedAllocation[];
  charges: PlannedCharge[];
};

/** Pure preview; the API must still verify ownership and persist snapshots atomically. */
export function planExpenseCharges(input: ExpensePlanInput): ExpensePlan {
  const description = input.description.normalize('NFC').trim();
  if (!description || description.length > 500) throw new RangeError('Informe uma descrição de até 500 caracteres.');
  const allocations = resolveExpenseSplit(input.totalCents, input.installmentCount, input.split);
  const dueDates = monthlyDueDates(input.firstDueDate, input.installmentCount);
  const charges = allocations.flatMap((allocation) => {
    if (allocation.kind === 'owner') return [];
    return allocation.installments.flatMap((amountCents, index): PlannedCharge[] =>
      amountCents === 0
        ? []
        : [
            {
              personId: allocation.personId,
              description,
              amountCents,
              currency: 'BRL',
              dueDate: dueDates[index]!,
              installment: index + 1,
              installmentCount: input.installmentCount
            }
          ]
    );
  });
  return { description, currency: 'BRL', totalCents: input.totalCents, allocations, charges };
}

function monthlyDueDates(firstDate: string, count: number): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstDate);
  if (!match) throw new RangeError('Data inválida.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError('Data inválida.');
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = month - 1 + index;
    const targetYear = year + Math.floor(offset / 12);
    const targetMonth = (offset % 12) + 1;
    if (targetYear > 9999) throw new RangeError('Vencimento fora do intervalo permitido.');
    const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
    return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  });
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
