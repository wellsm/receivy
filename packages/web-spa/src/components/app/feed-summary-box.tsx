import { Direction, signedMoney, type ChargeTotals } from "@receivy/common";
import { FeedTotalCard } from "./feed-total-card";

export function FeedSummaryBox({ summary }: { summary: ChargeTotals }) {
  const receivable = summary.receivable.pending.amountCents;
  const payable = summary.payable.pending.amountCents;
  const received = summary.receivable.paid.amountCents;
  const paid = summary.payable.paid.amountCents;
  const total = receivable + payable;
  const realized = received - paid;

  // Subtracting before adding keeps the sum exact near the largest safe integer.
  const figures = [
    { label: "Previsto", cents: receivable - payable + received - paid, tone: "text-ink" },
    { label: "Realizado", cents: realized, tone: realized < 0 ? "text-payable" : "text-success" },
  ];

  return (
    <section
      aria-label="Resumo do mês"
      className="overflow-hidden rounded-[18px] border border-outline bg-surface md:flex md:flex-col md:gap-4 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent"
    >
      <div className="flex md:flex-col md:gap-4">
        <FeedTotalCard type={Direction.Receivable} value={summary.receivable.pending} count={summary.receivable.count} />
        <FeedTotalCard type={Direction.Payable} value={summary.payable.pending} count={summary.payable.count} />
      </div>

      <div aria-hidden="true" className={`flex h-[5px] md:hidden ${total ? "bg-payable" : "bg-outline"}`}>
        {total > 0 && <span className="bg-primary" style={{ width: `${Math.round((receivable / total) * 100)}%` }} />}
      </div>

      <div className="flex items-center justify-between gap-2.5 bg-surface-muted/60 px-3.5 py-2 md:items-stretch md:gap-0 md:overflow-hidden md:rounded-2xl md:border md:border-outline md:bg-surface md:p-0">
        {figures.map(({ label, cents, tone }, index) => (
          <p
            key={label}
            className={`m-0 flex items-baseline gap-1 text-[11px] font-semibold text-muted md:flex-1 md:flex-col md:gap-1 md:px-4 md:py-[13px] ${index === 0 ? "md:border-r md:border-outline/50" : ""}`}
          >
            <span className="md:text-[10.5px] md:uppercase md:tracking-[0.09em]">{label}</span>
            <strong className={`font-bold tabular-nums md:font-display md:text-[17px] ${tone}`}>{signedMoney(cents)}</strong>
          </p>
        ))}
      </div>
    </section>
  );
}

