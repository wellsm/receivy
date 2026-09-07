import { describe, expect, it } from "vitest";
import { recurrenceDates, materializationDate, normalizeRecurrenceInput } from "./recurrence";
import { calendarDate } from "./financial-form";

const rule = { frequency: "monthly" as const, day: 31, startDate: "2026-01-01", timezone: "America/Sao_Paulo" };
describe("recurrence civil calendar", () => {
  it("clamps monthly dates independently without drifting the next month", () => {
    expect(recurrenceDates(rule, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
  it("clamps Feb 29 yearly and restores leap day", () => {
    expect(recurrenceDates({ ...rule, frequency: "yearly", day: 29, month: 2 }, "2027-01-01", "2028-12-31")).toEqual(["2027-02-28", "2028-02-29"]);
  });
  it("uses Gregorian leap rules including years below 100", () => {
    expect(recurrenceDates({ ...rule, frequency: "yearly", day: 29, month: 2, startDate: "0004-01-01" }, "0004-01-01", "0004-12-31")).toEqual(["0004-02-29"]);
  });
  it("honors inclusive start/end and bounds iteration without dropping a backlog", () => {
    expect(recurrenceDates({ ...rule, startDate: "2026-02-01", endDate: "2026-03-31" }, "2026-01-01", "2030-12-31", 1)).toEqual(["2026-02-28"]);
  });
  it("uses enabled reminder offsets and due date only when none are enabled", () => {
    expect(materializationDate("2026-03-09", [{ offsetDays: -3, channel: "auto", enabled: false }, { offsetDays: 2, channel: "auto", enabled: true }])).toBe("2026-03-11");
    expect(materializationDate("2026-03-09", [{ offsetDays: -3, channel: "auto", enabled: true }])).toBe("2026-03-06");
    expect(materializationDate("2026-03-09", [])).toBe("2026-03-09");
  });
  it("keeps civil days across DST and timezone midnight", () => {
    expect(calendarDate(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
    expect(calendarDate(new Date("2026-03-09T04:30:00Z"), "America/New_York")).toBe("2026-03-09");
    expect(materializationDate("2026-03-09", [{ offsetDays: -2, enabled: true, channel: "auto" }])).toBe("2026-03-07");
  });
  it("validates timezone, safe cents, reminders and calendar bounds", () => {
    const input = { ...rule, totalCents: 100, split: { mode: "equal" as const, parts: [{ kind: "owner" as const }] } };
    expect(normalizeRecurrenceInput(input).reminders.map(r => r.offsetDays)).toEqual([-3, 0, 2]);
    expect(() => normalizeRecurrenceInput({ ...input, timezone: "Mars/Olympus" })).toThrow();
    expect(() => normalizeRecurrenceInput({ ...input, totalCents: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => normalizeRecurrenceInput({ ...input, day: 32 })).toThrow();
    expect(() => normalizeRecurrenceInput({ ...input, reminders: [{ offsetDays: -91, channel: "auto", enabled: true }] })).toThrow();
  });
});
