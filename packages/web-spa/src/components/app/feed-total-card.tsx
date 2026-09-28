import { formatMoney, type Direction, type Money } from "@receivy/common";

type TotalCardProps = {
  type: Direction;
  value: Money;
  count: number;
};

/** One side of the month: a column of the narrow box (design 1b) or a solid card on wide screens (design 2a). */
export function FeedTotalCard({ type, value, count }: TotalCardProps) {
  const receivable = type === "receivable";

  return (
    <article className={`flex flex-1 flex-col px-3.5 py-[11px] md:rounded-[20px] md:p-5 ${receivable ? "border-r border-outline md:border-r-0 md:bg-primary" : "md:bg-payable"}`}>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-[10.5px] font-bold tracking-[0.1em] text-muted md:text-[11px] md:font-semibold md:text-on-primary/75">{receivable ? "A RECEBER" : "A PAGAR"}</span>
        <span className="hidden text-[11.5px] font-semibold text-on-primary/75 md:inline">{count === 1 ? "1 cobrança" : `${count} cobranças`}</span>
      </div>

      <strong className={`mt-1 font-display text-[20px] font-bold tracking-[-0.02em] tabular-nums md:mt-2.5 md:text-[34px] md:leading-none md:text-on-primary ${receivable ? "text-primary" : "text-payable"}`}>
        {value ? formatMoney(value) : "—"}
      </strong>
    </article>
  );
}