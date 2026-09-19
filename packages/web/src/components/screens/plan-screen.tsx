"use client";

import { formatMoney, momentText, type PlanInvoice, type PlanSummary, PlanTier, planName } from "@receivy/common";
import { CreditCard, Crown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { PLAN_BASIC_PRICE_CENTS, stripeConfigured } from "@/lib/stripe";
import { PlanCheckout } from "@/components/app/plan-checkout";
import { Toast } from "@/components/app/toast";

const LOAD_ERROR = "Não foi possível carregar seu plano.";
const ACTION_ERROR = "Não foi possível atualizar seu plano.";
const UNAVAILABLE = "Assinaturas indisponíveis neste ambiente.";
const POLL_TIMEOUT_MESSAGE = "Ainda confirmando o pagamento. Recarregue a página em instantes ou confira seu e-mail.";
const POLL_MS = 2_000;
const POLL_LIMIT = 15;

type Checkout = { mode: "subscribe" | "setup"; clientSecret: string } | null;

async function request<T>(path: string, init?: RequestInit, fallback = ACTION_ERROR): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;

  return (
    <div>
      <p className="m-0 text-sm text-ink">{`${used} de ${limit} cobranças indefinidas`}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
        <div className={`h-full rounded-full ${ratio >= 0.8 ? "bg-warning" : "bg-primary"}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function PlanScreen() {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [invoices, setInvoices] = useState<PlanInvoice[]>([]);
  const [checkout, setCheckout] = useState<Checkout>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const polls = useRef(0);

  const load = useCallback(() => {
    return Promise.all([request<PlanSummary>("/api/financial/plan", undefined, LOAD_ERROR), request<{ invoices: PlanInvoice[] }>("/api/financial/plan/invoices", undefined, LOAD_ERROR)])
      .then(([plan, page]) => {
        setSummary(plan);
        setInvoices(page.invoices);
        setError("");

        if (plan.plan === PlanTier.Basic) {
          setPollTimedOut(false);
        }

        return plan;
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : LOAD_ERROR);

        return null;
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The webhook is the writer: after the Payment Element confirms, the page waits for the row to turn basic.
  useEffect(() => {
    if (!confirming) {
      return;
    }

    const timer = window.setInterval(async () => {
      polls.current += 1;

      const plan = await load();

      if (plan?.plan === PlanTier.Basic || polls.current >= POLL_LIMIT) {
        window.clearInterval(timer);
        setConfirming(false);
        polls.current = 0;

        if (plan?.plan === PlanTier.Basic) {
          setToast("Plano Básico ativo");
        } else {
          setPollTimedOut(true);
        }
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [confirming, load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");

    try {
      await fn();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function subscribe() {
    return act(async () => {
      const { clientSecret } = await request<{ clientSecret: string }>("/api/financial/plan/subscribe", { method: "POST" });

      setCheckout({ mode: "subscribe", clientSecret });
    });
  }

  function changeCard() {
    return act(async () => {
      const { clientSecret } = await request<{ clientSecret: string }>("/api/financial/plan/payment-method", { method: "POST" });

      setCheckout({ mode: "setup", clientSecret });
    });
  }

  function onCheckoutDone(paymentMethodId?: string) {
    const mode = checkout?.mode;

    setCheckout(null);

    if (mode === "subscribe") {
      setConfirming(true);

      return;
    }

    if (paymentMethodId) {
      void act(async () => {
        await request<void>("/api/financial/plan/payment-method/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentMethodId }) });
        setToast("Cartão atualizado");
      });
    }
  }

  if (!summary) {
    return <p className="p-4 text-sm text-muted">{error || "Carregando…"}</p>;
  }

  const paid = summary.plan === PlanTier.Basic;
  const stripeOn = stripeConfigured();
  const when = summary.currentPeriodEnd ? momentText(summary.currentPeriodEnd) : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="rounded-[20px] border border-outline bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="m-0 font-display text-lg font-bold text-ink">Plano</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${paid ? "bg-primary-soft text-primary-strong" : "bg-surface-muted text-muted"}`}>{planName(summary.plan)}</span>
        </div>
        <div className="mt-4">
          <UsageBar used={summary.usage.indefinite.used} limit={summary.usage.indefinite.limit} />
        </div>
        {paid && when ? <p className="mt-3 text-sm text-muted">{summary.cancelAtPeriodEnd ? `Cancela em ${when}` : `Renova em ${when}`}</p> : null}
        {paid && summary.card ? (
          <p className="mt-1 flex items-center gap-2 text-sm text-ink">
            <CreditCard size={16} aria-hidden="true" />
            {`${summary.card.brand} •••• ${summary.card.last4}`}
          </p>
        ) : null}
        {!paid && PLAN_BASIC_PRICE_CENTS > 0 ? <p className="mt-3 text-sm text-muted">{`${formatMoney({ amountCents: PLAN_BASIC_PRICE_CENTS, currency: "BRL" })}/mês`}</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
        {confirming ? <p role="status" className="mt-3 text-sm text-muted">Confirmando pagamento…</p> : null}
        {checkout ? (
          <div className="mt-4">
            <PlanCheckout mode={checkout.mode} clientSecret={checkout.clientSecret} onDone={onCheckoutDone} onCancel={() => setCheckout(null)} />
          </div>
        ) : null}
        {!checkout && !confirming ? (
          <div className="mt-4 flex flex-col gap-2">
            {!stripeOn ? <p className="m-0 text-sm text-muted">{UNAVAILABLE}</p> : null}
            {pollTimedOut ? <p role="status" className="m-0 text-sm text-muted">{POLL_TIMEOUT_MESSAGE}</p> : null}
            {!paid && stripeOn && !pollTimedOut ? (
              <button type="button" onClick={() => void subscribe()} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-on-primary disabled:opacity-60">
                <Crown size={18} aria-hidden="true" />
                Assinar o Básico
              </button>
            ) : null}
            {paid ? (
              <>
                <button type="button" onClick={() => void act(() => request<void>(summary.cancelAtPeriodEnd ? "/api/financial/plan/resume" : "/api/financial/plan/cancel", { method: "POST" }))} disabled={busy} className="min-h-12 rounded-xl border border-outline font-semibold text-ink">
                  {summary.cancelAtPeriodEnd ? "Retomar" : "Cancelar ao fim do período"}
                </button>
                {stripeOn ? <button type="button" onClick={() => void changeCard()} disabled={busy} className="min-h-12 rounded-xl border border-outline font-semibold text-ink">Trocar cartão</button> : null}
              </>
            ) : null}
          </div>
        ) : null}
      </section>
      {invoices.length ? (
        <section className="rounded-[20px] border border-outline bg-surface p-5">
          <h3 className="m-0 text-base font-bold text-ink">Faturas</h3>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {invoices.map(invoice => (
              <li key={invoice.id} className="flex items-center justify-between text-sm">
                <span className="text-muted">{invoice.paidAt ? momentText(invoice.paidAt) : invoice.status}</span>
                <span className="font-semibold text-ink">{formatMoney({ amountCents: invoice.amountCents, currency: "BRL" })}</span>
                {invoice.pdfUrl ? <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary">PDF</a> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {toast ? <Toast message={toast} onDismiss={() => setToast("")} /> : null}
    </div>
  );
}
