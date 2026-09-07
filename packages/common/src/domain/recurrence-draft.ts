import type {
  RecurrenceInput,
  RecurrenceReminder,
  SplitMode,
} from "./contracts";
import { parseBRLCents, parsePercentageBasisPoints } from "./financial-form";
import { normalizeRecurrenceInput } from "./recurrence";

export type ReminderDraft = Omit<RecurrenceReminder, "offsetDays"> & {
  offsetDays: string;
};
export type RecurrenceDraft = {
  selected: string[];
  owner: boolean;
  amount: string;
  description: string;
  frequency: "monthly" | "yearly";
  day: string;
  month: string;
  start: string;
  end: string;
  timezone: string;
  pix: string;
  mode: SplitMode;
  values: Record<string, string>;
  reminders: ReminderDraft[];
};

function integer(value: string): number {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new RangeError("Informe dias inteiros, como -3, 0 ou 2.");
  }
  return Number(value);
}

/** Shared pure review boundary; raw text stays in each platform's local UI. */
export function buildRecurrenceInput(draft: RecurrenceDraft): RecurrenceInput {
  if (!draft.selected.length)
    throw new RangeError("Selecione ao menos um contato.");
  const parties = [
    ...draft.selected.map((personId) => ({
      kind: "person" as const,
      personId,
    })),
    ...(draft.owner ? [{ kind: "owner" as const }] : []),
  ];
  const split =
    draft.mode === "equal"
      ? { mode: draft.mode, parts: parties }
      : draft.mode === "fixed"
        ? {
            mode: draft.mode,
            parts: draft.selected.map((personId) => ({
              kind: "person" as const,
              personId,
              amountCents: parseBRLCents(draft.values[personId] ?? ""),
            })),
          }
        : {
            mode: draft.mode,
            parts: parties.map((party) => ({
              ...party,
              basisPoints: parsePercentageBasisPoints(
                draft.values[
                  party.kind === "owner" ? "owner" : party.personId
                ] ?? "",
              ),
            })),
          };
  return normalizeRecurrenceInput({
    description: draft.description,
    totalCents: parseBRLCents(draft.amount),
    frequency: draft.frequency,
    day: integer(draft.day),
    month: draft.frequency === "yearly" ? integer(draft.month) : undefined,
    startDate: draft.start || undefined,
    endDate: draft.end || undefined,
    timezone: draft.timezone,
    paymentMethodId: draft.pix || undefined,
    split,
    reminders: draft.reminders.map((reminder) => ({
      ...reminder,
      offsetDays: integer(reminder.offsetDays),
    })),
  });
}
