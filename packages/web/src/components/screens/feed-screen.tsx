"use client";

import { Bell, Check, Loader2 } from "lucide-react";
import {
  ChargeActionKind,
  DEFAULT_FEED_FILTERS,
  calendarDate,
  chargeAction,
  chargeBadges,
  chargeStateLabel,
  currentMonth,
  feedDayLabel,
  feedFilterQuery,
  formatMoney,
  monthTabs,
  type ChargeSummary,
  type Direction,
  type FeedFilters,
  type MonthTab,
  type TimelineItem,
  type TimelinePage,
  type TimelineSummary,
  REMINDER_QUOTA_MESSAGE,
} from "@receivy/common";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { FeedFiltersBar } from "@/components/app/feed-filters";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { StatusTag } from "@/components/ui/status-tag";

const FEED_ERROR = "Não foi possível carregar seu feed.";
const REMIND_ERROR = "Não foi possível enviar o lembrete.";
const PAY_ERROR = "Não foi possível atualizar a cobrança.";

function groupByDay(items: TimelineItem[]): [string, TimelineItem[]][] {
  const groups = new Map<string, TimelineItem[]>();

  for (const item of items) {
    const date = item.charge.dueDate;
    groups.set(date, [...(groups.get(date) ?? []), item]);
  }

  return [...groups];
}

/** What is still open on a day; null once every charge of the day is closed. */
function openTotal(items: TimelineItem[]): string | null {
  const open = items.filter(item => item.charge.state === "pending");

  if (!open.length) {
    return null;
  }

  const amountCents = open.reduce((sum, item) => sum + item.charge.amount.amountCents, 0);

  return formatMoney({ amountCents, currency: open[0]!.charge.amount.currency });
}

/** `+ R$ 1.620,10` / `− R$ 40,00`: the Previsto and Realizado figures carry their own sign. */
function signedMoney(amountCents: number): string {
  const sign = amountCents > 0 ? "+ " : amountCents < 0 ? "− " : "";

  return `${sign}${formatMoney({ amountCents: Math.abs(amountCents), currency: "BRL" })}`;
}

type TotalCardProps = {
  tone: "receivable" | "payable";
  open?: TimelineSummary["receivable"];
  settled?: TimelineSummary["receivedTotal"];
  count: number;
};

/** One side of the month: a column of the narrow box (design 1b) or a solid card on wide screens (design 2a). */
function TotalCard({ tone, open, settled, count }: TotalCardProps) {
  const receivable = tone === "receivable";
  const done = receivable ? "recebido" : "pago";
  const openCents = open?.amountCents ?? 0;
  const settledCents = settled?.amountCents ?? 0;
  const progress = openCents + settledCents ? Math.round((settledCents / (openCents + settledCents)) * 100) : 0;

  return (
    <article className={`flex flex-1 flex-col px-3.5 py-[11px] md:rounded-[20px] md:p-5 ${receivable ? "border-r border-outline md:border-r-0 md:bg-primary" : "md:bg-payable"}`}>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-[10.5px] font-bold tracking-[0.1em] text-muted md:text-[11px] md:font-semibold md:text-on-primary/75">{receivable ? "A RECEBER" : "A PAGAR"}</span>
        <span className="hidden text-[11.5px] font-semibold text-on-primary/75 md:inline">{count === 1 ? "1 cobrança" : `${count} cobranças`}</span>
      </div>

      <strong className={`mt-1 font-display text-[20px] font-bold tracking-[-0.02em] tabular-nums md:mt-2.5 md:text-[34px] md:leading-none md:text-on-primary ${receivable ? "text-primary" : "text-payable"}`}>
        {open ? formatMoney(open) : "—"}
      </strong>
    </article>
  );
}

/**
 * Narrow: one bordered box (design 1b) whose footer reads Previsto and Realizado. Wide: two solid cards
 * (design 2a) and the same figures as a card of their own. Previsto is everything due this month, open
 * or settled; Realizado only what was settled.
 */
function SummaryBox({ summary }: { summary?: TimelineSummary }) {
  const receivable = summary?.receivable.amountCents ?? 0;
  const payable = summary?.payable.amountCents ?? 0;
  const received = summary?.receivedTotal.amountCents ?? 0;
  const paid = summary?.paidTotal.amountCents ?? 0;
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
        <TotalCard tone="receivable" open={summary?.receivable} settled={summary?.receivedTotal} count={summary?.receivableCount ?? 0} />
        <TotalCard tone="payable" open={summary?.payable} settled={summary?.paidTotal} count={summary?.payableCount ?? 0} />
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
            <strong className={`font-bold tabular-nums md:font-display md:text-[17px] ${tone}`}>{summary ? signedMoney(cents) : "—"}</strong>
          </p>
        ))}
      </div>
    </section>
  );
}

function ChargeCard({
  charge,
  direction,
  today,
  reminded,
  onRemind,
  onMarkPaid,
  onDeclare,
}: {
  charge: ChargeSummary;
  direction: Direction;
  today: string;
  reminded: string | null;
  onRemind: () => void;
  onMarkPaid: () => void;
  onDeclare: () => void;
}) {
  const [confirmRemind, setConfirmRemind] = useState(false);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [confirmDeclare, setConfirmDeclare] = useState(false);
  const badges = chargeBadges(charge, today);
  const action = chargeAction(charge, direction);
  const settled = charge.state !== "pending";
  const amountClass = settled ? "text-muted" : direction === "receivable" ? "text-ink" : "text-payable";

  // The whole row opens the charge through one stretched link. Nesting the action inside it would
  // not be accessible, so the link is a sibling overlay and the action is raised above it.
  return (
    <article
      className={`relative flex items-center gap-3 border-b border-outline/60 bg-surface px-[18px] py-3 md:gap-4 md:rounded-[18px] md:border md:border-outline md:py-4 ${settled ? "opacity-60 md:opacity-100" : ""}`}
    >
      <Link
        href={`/charges/${charge.id}`}
        aria-label={`Abrir cobrança ${charge.description}`}
        className="absolute inset-0 focus-visible:outline-[3px] focus-visible:outline-primary focus-visible:-outline-offset-2 md:rounded-[18px]"
      />

      <span className="hidden md:block">
        <InitialsAvatar name={charge.counterpartName} size={44} avatar={charge.counterpartAvatar} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 truncate text-[13.5px] font-bold text-ink md:text-[15.5px] md:font-semibold">
          {charge.description} · <span className="font-semibold text-muted md:font-normal">{charge.counterpartName}</span>
        </p>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map(badge => (
              <StatusTag key={badge.label} label={badge.label} tone={badge.tone} />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end md:w-[120px]">
        <strong className={`font-display text-sm font-bold tabular-nums md:text-[19px] ${amountClass}`}>{formatMoney(charge.amount)}</strong>
        <span className="text-[11px] text-muted md:text-[11.5px]">{chargeStateLabel(charge, direction)}</span>
      </div>

      {action?.kind === ChargeActionKind.Remind && (
        <button
          type="button"
          disabled={reminded !== null}
          onClick={() => setConfirmRemind(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-primary-soft px-2.5 text-[11.5px] font-extrabold text-primary-strong disabled:opacity-60 md:h-10 md:rounded-xl md:bg-primary md:px-3.5 md:text-[13px] md:font-bold md:text-on-primary"
        >
          <Bell size={15} aria-hidden="true" className="hidden md:block" />
          {reminded ?? action.label}
        </button>
      )}
      {action?.kind === ChargeActionKind.MarkPaid && (
        <button
          type="button"
          onClick={() => setConfirmPaid(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-success-soft px-2.5 text-[11.5px] font-extrabold text-success md:h-10 md:rounded-xl md:px-3.5 md:text-[13px] md:font-bold"
        >
          <Check size={15} aria-hidden="true" className="hidden md:block" />
          {action.label}
        </button>
      )}
      {action?.kind === ChargeActionKind.DeclarePayment && (
        <button
          type="button"
          onClick={() => setConfirmDeclare(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-success-soft px-2.5 text-[11.5px] font-extrabold text-success md:h-10 md:rounded-xl md:px-3.5 md:text-[13px] md:font-bold"
        >
          <Check size={15} aria-hidden="true" className="hidden md:block" />
          {action.label}
        </button>
      )}

      {confirmRemind && (
        <ConfirmDialog
          title="Enviar lembrete?"
          icon={Bell}
          tone="primary"
          detail={
            <>
              <span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted">PRÉVIA</span>
              <strong className="text-[13.5px] font-semibold text-ink">{charge.description}</strong>
              <span className="text-xs text-muted">
                {formatMoney(charge.amount)} · vence {feedDayLabel(charge.dueDate, today).toLowerCase()}
              </span>
            </>
          }
          explanation={`Avisa ${charge.counterpartName} por notificação no app ou por e-mail, com o link de pagamento e a chave Pix. Só um lembrete a cada 24 horas.`}
          confirmLabel="Enviar lembrete"
          onConfirm={() => {
            setConfirmRemind(false);
            onRemind();
          }}
          onCancel={() => setConfirmRemind(false)}
        />
      )}
      {confirmPaid && (
        <ConfirmDialog
          title="Marcar como paga?"
          icon={Check}
          tone="primary"
          explanation="Isso registra um pagamento integral e encerra a cobrança. Dá para reabrir depois."
          confirmLabel="Marcar paga"
          onConfirm={() => {
            setConfirmPaid(false);
            onMarkPaid();
          }}
          onCancel={() => setConfirmPaid(false)}
        />
      )}
      {confirmDeclare && (
        <ConfirmDialog
          title="Marcar como pago?"
          icon={Check}
          tone="primary"
          explanation={`${charge.counterpartName} vai receber um aviso para confirmar o recebimento.`}
          confirmLabel="Marcar pago"
          onConfirm={() => {
            setConfirmDeclare(false);
            onDeclare();
          }}
          onCancel={() => setConfirmDeclare(false)}
        />
      )}
    </article>
  );
}

/** The Feed's month carousel: previous, selected and next, the selected one centered and highlighted. */
function MonthTabBar({ month, onSelect }: { month: string; onSelect: (month: string) => void }) {
  const tabs: MonthTab[] = monthTabs(month);

  return (
    <div role="group" aria-label="Mês" className="flex border-b border-outline -mx-5
    ">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={tab.selected}
          aria-current={tab.selected ? "true" : undefined}
          onClick={() => onSelect(tab.value)}
          className={`flex-1 border-b-[2.5px] py-2 text-center font-display text-[13.5px] tabular-nums ${
            tab.selected ? "border-primary font-extrabold text-ink" : "border-transparent font-semibold text-muted"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function FeedScreen({ onSummary }: { onSummary?: (summary: TimelineSummary) => void } = {}) {
  const [data, setData] = useState<TimelinePage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const [month, setMonth] = useState(() => currentMonth(new Date()));
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    async (nextFilters = filters, cursor?: string, nextMonth = month) => {
      const requestGeneration = cursor ? generation.current : ++generation.current;

      setLoading(true);
      setError("");

      if (!cursor) {
        setData(null);
      }

      const query = feedFilterQuery(nextFilters, today, nextMonth);

      if (cursor) {
        query.set("cursor", cursor);
      }

      try {
        const response = await browserFetch(`/api/financial/timeline${query.size ? `?${query}` : ""}`);

        if (!response.ok) {
          throw new Error(await responseMessage(response, FEED_ERROR));
        }

        const page = (await response.json()) as TimelinePage;

        if (requestGeneration !== generation.current) {
          return;
        }

        setData((previous) => (cursor && previous ? { ...page, items: [...previous.items, ...page.items] } : page));
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setError(reason instanceof Error ? reason.message : FEED_ERROR);
        }
      } finally {
        if (requestGeneration === generation.current) {
          setLoading(false);
        }
      }
    },
    [filters, month, today],
  );

  useEffect(() => {
    const requestGeneration = ++generation.current;

    void browserFetch(`/api/financial/timeline?${feedFilterQuery(DEFAULT_FEED_FILTERS, today, month)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await responseMessage(response, FEED_ERROR));
        }

        return response.json() as Promise<TimelinePage>;
      })
      .then((page) => {
        if (requestGeneration === generation.current) {
          setData(page);
        }
      })
      .catch((reason) => {
        if (requestGeneration === generation.current) {
          setError(reason instanceof Error ? reason.message : FEED_ERROR);
        }
      })
      .finally(() => {
        if (requestGeneration === generation.current) {
          setLoading(false);
        }
      });
    // Mount-only: runs once with the initial filters and month, independent from `load`'s identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (data) {
      onSummary?.(data.summary);
    }
  }, [data, onSummary]);

  async function remind(chargeId: string) {
    try {
      const response = await browserFetch(`/api/financial/charges/${chargeId}/reminders`, { method: "POST" });

      if (response.status === 429) {
        throw new Error(REMINDER_QUOTA_MESSAGE);
      }

      if (!response.ok) {
        throw new Error(await responseMessage(response, REMIND_ERROR));
      }

      setReminded((current) => ({ ...current, [chargeId]: "Lembrete enviado" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : REMIND_ERROR);
    }
  }

  async function markPaid(chargeId: string) {
    try {
      const response = await browserFetch(`/api/financial/charges/${chargeId}/pay`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, PAY_ERROR));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : PAY_ERROR);
      return;
    }

    // Totals and the card state both change, so the feed reloads on the current filters.
    await load();
  }

  async function declare(chargeId: string) {
    try {
      const response = await browserFetch(`/api/financial/charges/${chargeId}/proof/declaration`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, PAY_ERROR));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : PAY_ERROR);
      return;
    }

    // The card turns Em análise, so the feed reloads on the current filters.
    await load();
  }

  function selectMonth(nextMonth: string) {
    setMonth(nextMonth);
    void load(filters, undefined, nextMonth);
  }

  const summary = data?.summary;
  const counts = { receivable: summary?.receivableCount, payable: summary?.payableCount };
  const groups = groupByDay(data?.items ?? []);

  return (
    <section className="flex flex-col gap-4 pt-2 md:grid md:grid-cols-[minmax(0,352px)_minmax(0,1fr)] md:items-start md:gap-7 md:pt-0">
      <div className="flex flex-col gap-4">
        <MonthTabBar month={month} onSelect={selectMonth} />
        <SummaryBox summary={summary} />

        <div className="flex flex-col gap-3.5 md:rounded-[20px] md:border md:border-outline md:bg-surface md:p-[18px]">
          <span className="hidden text-[11px] font-semibold tracking-[0.08em] text-muted md:block">FILTROS</span>
          <FeedFiltersBar
            value={filters}
            counts={counts}
            onChange={(next) => {
              setFilters(next);
              void load(next);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 md:gap-5">
        {loading && (
          <div role="status" aria-label="Carregando feed" className="my-6 flex justify-center">
            <Loader2 size={28} aria-hidden="true" className="animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="flex flex-col gap-2 rounded-xl bg-danger-soft p-4">
            <p role="alert" className="m-0 text-danger">
              {error}
            </p>
            <button type="button" className="flex min-h-12 items-center self-start font-bold text-danger" onClick={() => void load()}>
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && data?.items.length === 0 && (
          <div className="flex flex-col gap-2 rounded-[20px] border border-outline bg-surface p-5">
            <h2 className="m-0 font-display text-2xl font-bold text-ink">Sua timeline começa aqui</h2>
            <p className="m-0 text-sm leading-6 text-muted">Crie uma conta na aba Contas ou entre com o e-mail em que recebeu uma.</p>
          </div>
        )}

        {groups.length > 0 && (
          <div className="-mx-5 flex flex-col md:mx-0 md:gap-5">
            {groups.map(([date, items]) => {
              const isToday = date === today;
              const total = openTotal(items);
              const paid = items.every(item => item.charge.state === "paid");

              return (
                <section key={date} className="flex flex-col md:gap-3.5">
                  <h2 className={`m-0 flex items-center gap-3 px-[18px] py-2 md:bg-transparent md:px-0 md:py-0 ${isToday ? "bg-primary" : "bg-surface-muted"}`}>
                    <span
                      className={`text-xs font-extrabold tracking-[0.02em] uppercase md:font-display md:text-sm md:font-bold md:tracking-normal md:normal-case ${isToday ? "text-on-primary md:text-primary" : "text-muted md:text-ink"}`}
                    >
                      {feedDayLabel(date, today)}
                    </span>
                    <span aria-hidden="true" className="flex-1 md:h-px md:bg-outline" />
                    {total && <span className={`font-display text-xs font-bold tabular-nums md:text-[13px] ${isToday ? "text-on-primary/85 md:text-ink" : "text-muted md:text-ink"}`}>{total}</span>}
                    {!total && paid && <span className={`text-xs font-bold ${isToday ? "text-on-primary md:text-success" : "text-success"}`}>liquidado</span>}
                  </h2>
                  {items.map(item => (
                    <ChargeCard
                      key={item.charge.id}
                      charge={item.charge}
                      direction={item.direction}
                      today={today}
                      reminded={reminded[item.charge.id] ?? null}
                      onRemind={() => void remind(item.charge.id)}
                      onMarkPaid={() => void markPaid(item.charge.id)}
                      onDeclare={() => void declare(item.charge.id)}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        )}

        {data?.nextCursor && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(filters, data.nextCursor ?? undefined)}
            className="flex min-h-12 items-center justify-center rounded-xl border border-outline font-bold text-primary"
          >
            Carregar mais
          </button>
        )}
      </div>
    </section>
  );
}
