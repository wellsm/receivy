import type { PlannedCharge } from '@receivy/common';

export type MonthCharge = { id: string; debtorUserId: string | null; dueDate: string };

export type MonthChanges = {
  update: { charge: MonthCharge; planned: PlannedCharge }[];
  cancel: MonthCharge[];
  create: PlannedCharge[];
};

/** Pairs this month's editable charges with the new plan by person: the same person updates, a missing one cancels, a new one creates. */
export function monthChanges(existing: MonthCharge[], planned: PlannedCharge[]): MonthChanges {
  const changes: MonthChanges = { update: [], cancel: [], create: [] };

  for (const charge of existing) {
    const match = planned.find((item) => item.userId === charge.debtorUserId);

    if (!match) {
      changes.cancel.push(charge);

      continue;
    }

    changes.update.push({ charge, planned: match });
  }

  for (const item of planned) {
    if (!existing.some((charge) => charge.debtorUserId === item.userId)) {
      changes.create.push(item);
    }
  }

  return changes;
}
