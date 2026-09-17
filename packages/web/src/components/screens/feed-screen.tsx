"use client";

import { chargeTotals, feedFilterQuery, groupChargesByDay, type FeedFilters, type ListCharge } from "@receivy/common";
import { useRouter } from "next/navigation";
import { FeedDayGroup } from "@/components/app/feed-day-group";
import { FeedFiltersBar } from "@/components/app/feed-filters";
import { FeedMonthTabs } from "@/components/app/feed-month-tabs";
import { FeedSummaryBox } from "@/components/app/feed-summary-box";

type Props = {
  charges: ListCharge;
  /** Who is reading the feed: the same charge is receivable for one side and payable for the other. */
  viewerEmail: string;
  /** Rendered month, owned by the URL: the server reads it and answers with that month's charges. */
  month: string;
  /** Active filters, also owned by the URL: the server narrows the month down before rendering. */
  filters: FeedFilters;
  /** The visitor's calendar day, resolved by the server in their timezone. */
  today: string;
};

export function FeedScreen({ charges, filters, month, today, viewerEmail }: Props) {
  const router = useRouter();
  const groups = groupChargesByDay(charges);
  const totals = chargeTotals(viewerEmail, charges);

  // Every knob of the feed lives in the URL, so changing one re-runs the server render.
  function navigate(next: FeedFilters, nextMonth = month) {
    router.replace(`/feed?${feedFilterQuery(next, today, nextMonth)}`, { scroll: false });
  }

  return (
    <section className="flex flex-col gap-4 pt-2 md:grid md:grid-cols-[minmax(0,352px)_minmax(0,1fr)] md:items-start md:gap-7 md:pt-0">
      <div className="flex flex-col gap-4">
        <FeedMonthTabs month={month} onSelect={(nextMonth) => navigate(filters, nextMonth)} />
        <FeedSummaryBox summary={totals} />

        <div className="flex flex-col gap-3.5 md:rounded-[20px] md:border md:border-outline md:bg-surface md:p-[18px]">
          <span className="hidden text-[11px] font-semibold tracking-[0.08em] text-muted md:block">FILTROS</span>
          <FeedFiltersBar
            value={filters}
            counts={{ receivable: totals.receivable.count, payable: totals.payable.count }}
            onChange={(next) => navigate(next)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 md:gap-5">
        {!groups.length && (
          <div className="flex flex-col gap-2 rounded-[20px] border border-outline bg-surface p-5">
            <h2 className="m-0 font-display text-2xl font-bold text-ink">Sua timeline começa aqui</h2>
            <p className="m-0 text-sm leading-6 text-muted">
              Crie uma conta na aba Contas ou entre com o e-mail em que recebeu uma.
            </p>
          </div>
        )}

        {groups.length > 0 && (
          <div className="-mx-5 flex flex-col md:mx-0 md:gap-5">
            {groups.map(([date, items]) => (
              <FeedDayGroup key={date} date={date} charges={items} today={today} viewerEmail={viewerEmail} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
