"use client";

import { ArrowDownLeft, ArrowUpRight, Bell, Loader2 } from "lucide-react";
import {
  DEFAULT_FEED_FILTERS,
  calendarDate,
  chargeAction,
  chargeBadges,
  chargeStateLabel,
  feedDayLabel,
  feedFilterQuery,
  formatMoney,
  type ChargeSummary,
  type Direction,
  type FeedFilters,
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

function groupByDay(items: TimelineItem[]): [string, TimelineItem[]][] {
  const groups = new Map<string, TimelineItem[]>();

  for (const item of items) {
    const date = item.charge.dueDate;
    groups.set(date, [...(groups.get(date) ?? []), item]);
  }

  return [...groups];
}

function pluralize(count: number): string {
  return count === 1 ? "1 pendência" : `${count} pendências`;
}

function TotalCard({ label, amount, count, tone }: { label: string; amount: string; count: number; tone: "receivable" | "payable" }) {
  const receivable = tone === "receivable";
  const Arrow = receivable ? ArrowDownLeft : ArrowUpRight;

  return (
    <article className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-outline/40 bg-surface p-4">
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${receivable ? "bg-primary" : "bg-danger-solid"}`} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-widest text-muted">{label}</span>
        <Arrow size={18} aria-hidden="true" className={receivable ? "text-primary" : "text-danger"} />
      </div>
      <strong className={`mt-2 text-xl font-extrabold tracking-tight ${receivable ? "text-primary" : "text-danger"}`}>{amount}</strong>
      <div className="mt-3 flex items-center gap-1.5 border-t border-outline/30 pt-2">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${receivable ? "bg-primary" : "bg-danger-solid"}`} />
        <span className="text-[11px] font-semibold text-muted">{pluralize(count)}</span>
      </div>
    </article>
  );
}

function ChargeCard({
  charge,
  direction,
  today,
  reminded,
  onRemind,
}: {
  charge: ChargeSummary;
  direction: Direction;
  today: string;
  reminded: string | null;
  onRemind: () => void;
}) {
  const [confirmRemind, setConfirmRemind] = useState(false);
  const badges = chargeBadges(charge, today);
  const action = chargeAction(charge, direction);
  const settled = charge.state !== "pending";
  const amountClass = settled ? "text-muted" : direction === "receivable" ? "text-primary" : "text-danger";
  const href = `/charges/${charge.id}`;

  const content = (
    <>
      <div className="flex items-center gap-3">
        <InitialsAvatar name={charge.counterpartName} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="m-0 truncate text-sm text-muted">
            <strong className="font-bold text-ink">{charge.counterpartName}</strong> · {charge.description}
          </p>
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <StatusTag key={badge.label} label={badge.label} tone={badge.tone} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-outline/30 pt-3">
        <div className="flex flex-col">
          <strong className={`text-lg font-extrabold tracking-tight ${amountClass}`}>{formatMoney(charge.amount)}</strong>
          <span className="text-[11px] text-muted">{chargeStateLabel(charge, direction)}</span>
        </div>
        {action?.kind === "remind" && (
          <button
            type="button"
            disabled={reminded !== null}
            onClick={() => setConfirmRemind(true)}
            className="relative flex min-h-10 items-center rounded-lg bg-primary-soft/40 px-3 text-xs font-bold text-primary-strong"
          >
            {reminded ?? action.label}
          </button>
        )}
        {action?.kind === "open" && (
          <Link
            href={href}
            className={`relative flex min-h-10 items-center rounded-lg px-3 text-xs font-bold no-underline ${
              action.label === "Pagar" ? "bg-primary text-on-primary" : "bg-surface-muted text-primary-strong"
            }`}
          >
            {action.label}
          </Link>
        )}
      </div>
      {confirmRemind && (
        <ConfirmDialog
          title="Enviar lembrete?"
          icon={Bell}
          tone="primary"
          explanation={`Avisa ${charge.counterpartName} por notificação no app ou por e-mail, com o link de pagamento e a chave Pix. Só um lembrete a cada 24 horas.`}
          confirmLabel="Enviar lembrete"
          onConfirm={() => {
            setConfirmRemind(false);
            onRemind();
          }}
          onCancel={() => setConfirmRemind(false)}
        />
      )}
    </>
  );

  const cardClass = "flex flex-col gap-3 rounded-2xl border border-outline/40 bg-surface p-4";

  // The whole card opens the charge through one stretched link. Nesting the action inside it would
  // not be accessible, so the link is a sibling overlay and the action is raised above it.
  return (
    <article className={`${cardClass} relative`}>
      <Link
        href={href}
        aria-label={`Abrir cobrança ${charge.description}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline-[3px] focus-visible:outline-primary focus-visible:outline-offset-2"
      />
      {content}
    </article>
  );
}

export function FeedScreen({ onSummary }: { onSummary?: (summary: TimelineSummary) => void } = {}) {
  const [data, setData] = useState<TimelinePage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    async (nextFilters = filters, cursor?: string) => {
      const requestGeneration = cursor ? generation.current : ++generation.current;

      setLoading(true);
      setError("");

      if (!cursor) {
        setData(null);
      }

      const query = feedFilterQuery(nextFilters);

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
    [filters],
  );

  useEffect(() => {
    const requestGeneration = ++generation.current;

    void browserFetch(`/api/financial/timeline?${feedFilterQuery(DEFAULT_FEED_FILTERS)}`)
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

  const summary = data?.summary;
  const counts = { receivable: summary?.receivableCount, payable: summary?.payableCount };
  const groups = groupByDay(data?.items ?? []);

  return (
    <section className="flex flex-col gap-5 pt-2 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
      <div className="flex flex-col gap-5">
        <div className="flex gap-3">
          <TotalCard label="A RECEBER" amount={summary ? formatMoney(summary.receivable) : "—"} count={summary?.receivableCount ?? 0} tone="receivable" />
          <TotalCard label="A PAGAR" amount={summary ? formatMoney(summary.payable) : "—"} count={summary?.payableCount ?? 0} tone="payable" />
        </div>

        <FeedFiltersBar
          value={filters}
          counts={counts}
          onChange={(next) => {
            setFilters(next);
            void load(next);
          }}
        />
      </div>

      <div className="flex flex-col gap-5">
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
          <div className="flex flex-col gap-2 rounded-2xl border border-outline/40 bg-surface p-5">
            <h2 className="m-0 text-2xl font-extrabold text-primary-strong">Sua timeline começa aqui</h2>
            <p className="m-0 text-sm leading-6 text-muted">Crie uma conta na aba Contas ou entre com o e-mail em que recebeu uma.</p>
          </div>
        )}

        {groups.map(([date, items]) => {
          const isToday = date === today;

          return (
            <section key={date} className="flex flex-col gap-3">
              <h2 className="m-0 flex items-center gap-2 px-1">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${isToday ? "bg-primary" : "bg-outline"}`} />
                <span className={`text-sm font-bold tracking-wide ${isToday ? "text-primary" : "text-muted"}`}>{feedDayLabel(date, today)}</span>
              </h2>
              {items.map(item => (
                <ChargeCard
                  key={item.charge.id}
                  charge={item.charge}
                  direction={item.direction}
                  today={today}
                  reminded={reminded[item.charge.id] ?? null}
                  onRemind={() => void remind(item.charge.id)}
                />
              ))}
            </section>
          );
        })}

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
