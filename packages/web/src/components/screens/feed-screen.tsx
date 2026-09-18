"use client";

import { chargeTotals, feedFilterQuery, groupChargesByDay, type FeedFilters, type ListCharge, type ListChargeItem } from "@receivy/common";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FeedDayGroup } from "@/components/app/feed-day-group";
import { FeedFiltersBar } from "@/components/app/feed-filters";
import { FeedMonthTabs } from "@/components/app/feed-month-tabs";
import { FeedSummaryBox } from "@/components/app/feed-summary-box";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const REMIND_ERROR = "Não foi possível enviar o lembrete.";
const PAY_ERROR = "Não foi possível atualizar a cobrança.";
const DECLARE_ERROR = "Não foi possível informar o pagamento.";

type Props = {
  charges: ListCharge;
  /** Rendered month, owned by the URL: the server reads it and answers with that month's charges. */
  month: string;
  /** Active filters, also owned by the URL: the server narrows the month down before rendering. */
  filters: FeedFilters;
  /** The visitor's calendar day, resolved by the server in their timezone. */
  today: string;
};

async function post(path: string, fallback: string): Promise<Response> {
  const response = await browserFetch(path, { method: "POST" });

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  return response;
}

export function FeedScreen({ charges, filters, month, today }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const groups = groupChargesByDay(charges);
  const totals = chargeTotals(charges);

  // Every knob of the feed lives in the URL, so changing one re-runs the server render.
  function navigate(next: FeedFilters, nextMonth = month) {
    router.replace(`/feed?${feedFilterQuery(next, today, nextMonth)}`, { scroll: false });
  }

  async function run(fallback: string, action: () => Promise<void>) {
    setError("");
    setNotice("");

    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback);
    }
  }

  function remind(charge: ListChargeItem) {
    void run(REMIND_ERROR, async () => {
      const result = (await (await post(`/api/financial/charges/${charge.id}/reminders`, REMIND_ERROR)).json()) as { queued: boolean };

      if (result.queued) {
        setReminded((current) => ({ ...current, [charge.id]: "Lembrete enviado" }));

        return;
      }

      setNotice("Este contato ainda não recebe lembretes.");
    });
  }

  // The card state and the totals both change: the server render is what knows the new month.
  function markPaid(charge: ListChargeItem) {
    void run(PAY_ERROR, async () => {
      await post(`/api/financial/charges/${charge.id}/pay`, PAY_ERROR);

      router.refresh();
    });
  }

  function declare(charge: ListChargeItem) {
    void run(DECLARE_ERROR, async () => {
      await post(`/api/financial/charges/${charge.id}/proof/declaration`, DECLARE_ERROR);

      router.refresh();
    });
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
        {error && (
          <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="m-0 rounded-xl bg-primary-soft/40 p-3 text-sm text-primary-strong">
            {notice}
          </p>
        )}

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
              <FeedDayGroup
                key={date}
                date={date}
                charges={items}
                today={today}
                reminded={reminded}
                onRemind={remind}
                onMarkPaid={markPaid}
                onDeclare={declare}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
