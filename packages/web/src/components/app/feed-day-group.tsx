import { ChargeState, feedDayLabel, formatMoney, openChargesTotal, type ListCharge, type ListChargeItem } from "@receivy/common";
import { FeedChargeCard } from "./feed-charge-card";

type FeedDayGroupProps = {
  date: string;
  charges: ListCharge;
  today: string;
  /** "Lembrete enviado" per charge id once a reminder went out; the button stays disabled with that label. */
  reminded: Record<string, string>;
  onRemind: (charge: ListChargeItem) => void;
  onMarkPaid: (charge: ListChargeItem) => void;
  onDeclare: (charge: ListChargeItem) => void;
};

/** One due date of the feed: the day heading with what it still owes, then its charges. */
export function FeedDayGroup({ date, charges, today, reminded, onRemind, onMarkPaid, onDeclare }: FeedDayGroupProps) {
  const isToday = date === today;
  const open = openChargesTotal(charges);
  const settled = charges.every((charge) => charge.state === ChargeState.Paid);

  return (
    <section className="flex flex-col md:gap-3.5">
      <h2 className={`m-0 flex items-center gap-3 px-[18px] py-2 md:bg-transparent md:px-0 md:py-0 ${isToday ? "bg-primary" : "bg-surface-muted"}`}>
        <span
          className={`text-xs font-extrabold uppercase tracking-[0.02em] md:font-display md:text-sm md:font-bold md:normal-case md:tracking-normal ${isToday ? "text-on-primary md:text-primary" : "text-muted md:text-ink"}`}
        >
          {feedDayLabel(date, today)}
        </span>

        <span aria-hidden="true" className="flex-1 md:h-px md:bg-outline" />

        {open && (
          <span className={`font-display text-xs font-bold tabular-nums md:text-[13px] ${isToday ? "text-on-primary/85 md:text-ink" : "text-muted md:text-ink"}`}>
            {formatMoney(open)}
          </span>
        )}

        {!open && settled && (
          <span className={`text-xs font-bold ${isToday ? "text-on-primary md:text-success" : "text-success"}`}>liquidado</span>
        )}
      </h2>

      {charges.map((charge) => (
        <FeedChargeCard
          key={charge.id}
          charge={charge}
          direction={charge.type}
          today={today}
          reminded={reminded[charge.id] ?? null}
          onRemind={() => onRemind(charge)}
          onMarkPaid={() => onMarkPaid(charge)}
          onDeclare={() => onDeclare(charge)}
        />
      ))}
    </section>
  );
}
