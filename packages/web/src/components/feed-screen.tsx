"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import {
  calendarDate,
  chargeAction,
  chargeBadges,
  chargeStateLabel,
  feedDayLabel,
  formatMoney,
  type ChargeSummary,
  type Direction,
  type TimelineItem,
  type TimelinePage,
  type TimelineSummary,
} from "@receivy/common";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

type FeedFilter = {
  label: string;
  value: string;
  badge?: (data: TimelinePage | null) => number;
};

const filters: FeedFilter[] = [
  { label: "Todos", value: "", badge: (data) => (data ? data.summary.receivableCount + data.summary.payableCount : 0) },
  { label: "A receber", value: "direction=receivable", badge: (data) => (data ? data.summary.receivableCount : 0) },
  { label: "A pagar", value: "direction=payable", badge: (data) => (data ? data.summary.payableCount : 0) },
  { label: "Hoje", value: "today" },
  { label: "Esta semana", value: "week" },
  { label: "Sem fim", value: "type=indefinite" },
  { label: "Pendentes", value: "status=pending" },
];

function dateQuery(value: string): string {
  const today = new Date();

  if (value === "today") {
    return `from=${calendarDate(today)}&to=${calendarDate(today)}`;
  }

  if (value === "week") {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    return `from=${calendarDate(today)}&to=${calendarDate(end)}`;
  }

  return value;
}

function itemDate(item: TimelineItem): string {
  if (item.kind === "charge") {
    return item.charge.dueDate;
  }

  if (item.kind === "billing_preview") {
    return item.preview.occurrenceDate;
  }

  if (item.kind === "proof") {
    return item.proof.createdAt.slice(0, 10);
  }

  return item.payment.paidAt.slice(0, 10);
}

function ReminderAction({ chargeId }: { chargeId: string }) {
  const [status, setStatus] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function remind() {
    setStatus("busy");

    try {
      const response = await browserFetch(`/api/financial/charges/${chargeId}/reminders`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível enviar o lembrete."));
      }

      setStatus("sent");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível enviar o lembrete.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return <span className="feed-action feed-action-done">Lembrete enviado</span>;
  }

  if (status === "error") {
    return (
      <span className="feed-action feed-action-error" role="alert">
        {message}
      </span>
    );
  }

  return (
    <button type="button" className="feed-action" disabled={status === "busy"} onClick={() => void remind()}>
      Lembrar
    </button>
  );
}

function ChargeCard({ charge, direction, today }: { charge: ChargeSummary; direction: Direction; today: string }) {
  const badges = chargeBadges(charge, today);
  const stateLabel = chargeStateLabel(charge, direction);
  const action = chargeAction(charge, direction);
  const amountClass = charge.state === "pending" ? direction : "settled";
  const initial = charge.counterpartName.slice(0, 1).toUpperCase();

  const content = (
    <>
      <div className="feed-card-top">
        <span className="feed-avatar" aria-hidden="true">{initial}</span>
        <div className="feed-card-lines">
          <p className="feed-card-title">
            <strong>{charge.counterpartName}</strong> · {charge.description}
          </p>
          {badges.length > 0 && (
            <div className="feed-card-badges">
              {badges.map((badge) => (
                <span className={`feed-badge ${badge.tone}`} key={badge.label}>
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="feed-card-divider" aria-hidden="true" />
      <div className="feed-card-bottom">
        <div className="feed-card-amount">
          <strong className={`feed-amount ${amountClass}`}>{formatMoney(charge.amount)}</strong>
          <span className="feed-card-state">{stateLabel}</span>
        </div>
        {action?.kind === "open" && (
          <Link className="feed-action" href={`/charges/${charge.id}`}>
            {action.label}
          </Link>
        )}
        {action?.kind === "remind" && <ReminderAction chargeId={charge.id} />}
      </div>
    </>
  );

  if (action) {
    return <article className="feed-card">{content}</article>;
  }

  return (
    <Link className="feed-card feed-card-link" href={`/charges/${charge.id}`} aria-label={`Abrir cobrança ${charge.description}`}>
      {content}
    </Link>
  );
}

function PreviewCard({ item }: { item: Extract<TimelineItem, { kind: "billing_preview" }> }) {
  return (
    <div className="feed-card feed-card-muted">
      <p className="feed-card-title">Previsto · {item.preview.description}</p>
      <strong className="feed-amount settled">{formatMoney(item.preview.amount)}</strong>
    </div>
  );
}

function EventRow({ item }: { item: Extract<TimelineItem, { kind: "proof" | "payment" }> }) {
  return <div className="feed-event-row">{item.kind === "payment" ? "Pagamento registrado" : "Comprovante"}</div>;
}

export function FeedScreen({ onSummary }: { onSummary?: (summary: TimelineSummary) => void } = {}) {
  const [data, setData] = useState<TimelinePage | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    async (nextFilter = filter, cursor?: string) => {
      const requestGeneration = cursor ? generation.current : ++generation.current;
      setLoading(true);
      setError("");
      if (!cursor) {
        setData(null);
      }

      const query = new URLSearchParams(dateQuery(nextFilter));
      if (cursor) {
        query.set("cursor", cursor);
      }

      try {
        const response = await browserFetch(`/api/financial/timeline${query.size ? `?${query}` : ""}`);

        if (!response.ok) {
          throw new Error(await responseMessage(response, "Não foi possível carregar sua timeline."));
        }

        const page = (await response.json()) as TimelinePage;

        if (requestGeneration !== generation.current) {
          return;
        }

        setData((previous) => (cursor && previous ? { ...page, items: [...previous.items, ...page.items] } : page));
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setError(reason instanceof Error ? reason.message : "Não foi possível carregar sua timeline.");
        }
      } finally {
        if (requestGeneration === generation.current) {
          setLoading(false);
        }
      }
    },
    [filter],
  );

  useEffect(() => {
    const requestGeneration = ++generation.current;

    void browserFetch("/api/financial/timeline")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await responseMessage(response, "Não foi possível carregar sua timeline."));
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
          setError(reason instanceof Error ? reason.message : "Não foi possível carregar sua timeline.");
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

  const groups = new Map<string, TimelineItem[]>();

  for (const item of data?.items ?? []) {
    const date = itemDate(item);
    groups.set(date, [...(groups.get(date) ?? []), item]);
  }

  return (
    <div className="feed-page financial-page">
      <p className="date-line">Sua visão de hoje</p>

      <div className="feed-totals">
        <article className="feed-total receivable">
          <ArrowDownLeft aria-hidden="true" size={20} />
          <span>A RECEBER</span>
          <strong>{data ? formatMoney(data.summary.receivable) : "—"}</strong>
          <p>
            <span className="feed-total-dot" aria-hidden="true" />
            {data ? data.summary.receivableCount : 0} pendências
          </p>
        </article>
        <article className="feed-total payable">
          <ArrowUpRight aria-hidden="true" size={20} />
          <span>A PAGAR</span>
          <strong>{data ? formatMoney(data.summary.payable) : "—"}</strong>
          <p>
            <span className="feed-total-dot" aria-hidden="true" />
            {data ? data.summary.payableCount : 0} pendências
          </p>
        </article>
      </div>

      <div className="feed-chip-strip" role="group" aria-label="Filtrar feed">
        {filters.map((option) => (
          <button
            key={option.label}
            type="button"
            className={filter === option.value ? "feed-chip is-active" : "feed-chip"}
            onClick={() => {
              setFilter(option.value);
              void load(option.value);
            }}
          >
            {option.label}
            {option.badge && (
              <span className="feed-chip-badge" aria-hidden="true">
                {option.badge(data)}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="login-error" role="alert">
          {error} <button type="button" onClick={() => void load()}>Tentar novamente</button>
        </p>
      )}

      {loading && <p role="status">Carregando timeline…</p>}

      {!loading && !error && data?.items.length === 0 && (
        <section className="empty-timeline">
          <div className="timeline-rail">
            <span />
          </div>
          <div className="empty-copy">
            <h2>Sua timeline começa aqui</h2>
            <p>Crie uma cobrança ou entre com o e-mail em que recebeu uma.</p>
            <Link className="primary-link" href="/charges/new">
              Criar cobrança
            </Link>
          </div>
        </section>
      )}

      {[...groups].map(([date, items]) => (
        <section className="feed-day" key={date}>
          <h2 className="feed-day-heading">
            <span className="feed-day-dot" aria-hidden="true" />
            {feedDayLabel(date, today)}
          </h2>
          <div className="feed-day-items">
            {items.map((item, index) => {
              if (item.kind === "charge") {
                return <ChargeCard charge={item.charge} direction={item.direction} today={today} key={item.charge.id} />;
              }

              if (item.kind === "billing_preview") {
                return <PreviewCard item={item} key={`preview-${index}`} />;
              }

              return <EventRow item={item} key={`${item.kind}-${index}`} />;
            })}
          </div>
        </section>
      ))}

      {data?.nextCursor && (
        <button className="secondary-button" disabled={loading} onClick={() => void load(filter, data.nextCursor ?? undefined)}>
          Carregar mais
        </button>
      )}
    </div>
  );
}
