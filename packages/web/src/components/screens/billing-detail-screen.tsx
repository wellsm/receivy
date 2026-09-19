"use client";

import { billingCategoryLabel, BillingKind, calendarDate, chargeShareText, chargeStateTag, formatMoney, paymentMethodCopyValue, paymentMethodText, PaymentProvider, pendingChargesOf, PendingChargesAction, SplitPartKind, type BillingAllocation, type BillingDetail, type BillingGuest, type BillingGuestAction, type BillingInvite, type ChargeDetail, type Money, type PaymentMethod } from "@receivy/common";
import { Bell, BellOff, Check, CircleDashed, CirclePause, CirclePlay, CircleStop, KeyRound, Pencil, Receipt, RotateCcw, Share2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { ScopeDialog } from "@/components/app/scope-dialog";
import { Toast } from "@/components/app/toast";
import { ActionTile } from "@/components/ui/action-tile";
import { CategoryIcon } from "@/components/ui/category-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { StatusTag } from "@/components/ui/status-tag";

/** One due date of the billing: the charges generated for it, oldest cycle first. */
type Cycle = {
  dueDate: string;
  index: number;
  charges: ChargeDetail[];
};

const LOAD_ERROR = "Não foi possível carregar a cobrança.";

const STATE_LABELS = {
  active: "Ativa",
  paused: "Pausada",
  ended: "Encerrada",
} as const;

async function request<T>(path: string, init: RequestInit = {}, fallback = LOAD_ERROR): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function jsonInit(method: string, body: object): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function dayMonth(value: string): string {
  return dateText(value).slice(0, 5);
}

function paidAtText(iso: string, timezone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return `Pago em ${day} às ${time}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function money(amountCents: number, currency: Money["currency"] = "BRL"): string {
  return formatMoney({ amountCents, currency });
}

/** A billing without generated charges still points at its key; the wallet turns the id into something readable. */
function methodFromWallet(methods: PaymentMethod[], paymentMethodId: string | undefined): PaymentMethod | undefined {
  return methods.find((candidate) => candidate.id === paymentMethodId);
}

function cyclesOf(billing: BillingDetail): Cycle[] {
  const groups = new Map<string, ChargeDetail[]>();

  for (const charge of billing.charges) {
    groups.set(charge.dueDate, [...(groups.get(charge.dueDate) ?? []), charge]);
  }

  return [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dueDate, charges], index) => ({
      dueDate,
      index: index + 1,
      charges,
    }))
    .reverse();
}

/** The cycle the owner is collecting now: the latest one with something pending, else the last one. */
function currentCycle(cycles: Cycle[]): Cycle | null {
  return [...cycles].reverse().find((cycle) => cycle.charges.some((charge) => charge.state === "pending")) ?? cycles.at(-1) ?? null;
}

/** The first row of each debtor in the list: the participant action shows there, once per person. */
function firstRowIds(charges: ChargeDetail[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();

  for (const charge of charges) {
    if (!charge.debtorId || seen.has(charge.debtorId)) {
      continue;
    }

    seen.add(charge.debtorId);
    ids.add(charge.id);
  }

  return ids;
}

function cycleTotals(cycle: Cycle): {
  paid: number;
  goal: number;
  paidCount: number;
  open: number;
} {
  const open = cycle.charges.filter((charge) => charge.state !== "cancelled");
  const paidCharges = open.filter((charge) => charge.state === "paid");

  return {
    paid: paidCharges.reduce((sum, charge) => sum + charge.amount.amountCents, 0),
    goal: open.reduce((sum, charge) => sum + charge.amount.amountCents, 0),
    paidCount: paidCharges.length,
    open: open.length,
  };
}

function cycleTitle(billing: BillingDetail, cycle: Cycle): string {
  if (billing.recurrence === "until") {
    const installment = cycle.charges[0]?.installment ?? cycle.index;
    const count = billing.installmentCount ?? cycle.charges[0]?.installmentCount ?? cycle.index;

    return `Parcela ${installment} de ${count}`;
  }

  if (billing.recurrence === "indefinite") {
    return `Ocorrência ${dateText(cycle.dueDate)}`;
  }

  return "Cobrança única";
}

function cycleState(cycle: Cycle): "open" | "done" | "cancelled" {
  const { open, paidCount } = cycleTotals(cycle);

  if (!open) {
    return "cancelled";
  }

  return paidCount === open ? "done" : "open";
}

function typeTag(billing: BillingDetail, current: Cycle | null): string {
  const monthEnd = billing.dueRule === "end_of_month" ? " · final do mês" : "";

  if (billing.recurrence === "until") {
    const installment = current?.charges[0]?.installment ?? current?.index ?? 1;

    return `Parcelado (${installment}/${billing.installmentCount ?? "?"})${monthEnd}`;
  }

  if (billing.recurrence === "indefinite") {
    return billing.frequency === "yearly" ? "Recorrente anual" : `Recorrente mensal${monthEnd}`;
  }

  return "À vista";
}

/** The one person on the other side of a registro, as the owner knows them: the API names them either way. */
function counterpartName(billing: BillingDetail): string {
  return billing.counterpart?.name ?? "";
}

/** "De Ana" on a registro a receber, "Para Ana" on one a pagar, just "Registro" when nobody is named. */
function counterpartHeadline(billing: BillingDetail): string {
  const name = counterpartName(billing);

  if (!name) {
    return "Registro";
  }

  return `${billing.type === "payable" ? "Para" : "De"} ${name}`;
}

type BillingDetailScreenProps = {
  id: string;
};

export function BillingDetailScreen({ id }: BillingDetailScreenProps) {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingDetail | null>(null);
  const [invite, setInvite] = useState<BillingInvite | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [scope, setScope] = useState<"paused" | "ended" | null>(null);
  // The row being settled by hand, with the name the notice will use.
  const [confirmPaid, setConfirmPaid] = useState<{ charge: ChargeDetail; name: string } | null>(null);
  const [confirmReopen, setConfirmReopen] = useState<ChargeDetail | null>(null);
  const [chooser, setChooser] = useState(false);
  // The participant whose notices wait for the owner's confirmation before going quiet.
  const [confirmStopNotify, setConfirmStopNotify] = useState<{ userId: string; name: string } | null>(null);

  const load = useCallback(() => {
    let live = true;

    // The wallet only names the key of a billing that has no charge yet; losing it must not hide the billing.
    Promise.all([request<BillingDetail>(`/api/financial/billings/${id}`), request<{ paymentMethods: PaymentMethod[] }>("/api/financial/payment-methods").catch(() => ({ paymentMethods: [] }))])
      .then(([detail, wallet]) => {
        if (!live) {
          return;
        }

        setBilling(detail);
        setInvite(detail.invite);
        setMethods(wallet.paymentMethods);
        setError("");
      })
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : LOAD_ERROR));

    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => load(), [load]);

  async function run<T>(action: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      return await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback);

      return undefined;
    } finally {
      setBusy(false);
    }
  }

  /** The web has no share sheet by default: the system share when the browser offers one, the clipboard otherwise. */
  async function shareUrl(url: string, title: string, text?: string) {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, url, ...(text ? { text } : {}) });

      return;
    }

    await navigator.clipboard.writeText(text ? `${text}` : url);

    setNotice("Link copiado");
  }

  async function shareInvite(link: BillingInvite, description: string) {
    await shareUrl(link.url, "Convite Receivy", `Entre na cobrança ${description} no Receivy: ${link.url}`);
  }

  async function inviteSomeone(detail: BillingDetail) {
    if (invite) {
      await run(() => shareInvite(invite, detail.description), "Não foi possível compartilhar o convite.");

      return;
    }

    await run(async () => {
      const created = await request<BillingInvite>(`/api/financial/billings/${detail.id}/invite`, { method: "POST" }, "Não foi possível criar o convite.");

      setInvite(created);

      await shareInvite(created, detail.description);
    }, "Não foi possível criar o convite.");
  }

  async function revokeInvite(detail: BillingDetail) {
    await run(async () => {
      await request<void>(`/api/financial/billings/${detail.id}/invite`, { method: "DELETE" }, "Não foi possível revogar o convite.");

      setInvite(null);
    }, "Não foi possível revogar o convite.");
  }

  async function transition(detail: BillingDetail, state: "active" | "paused" | "ended", pendingCharges?: PendingChargesAction) {
    await run(async () => {
      const body = pendingCharges ? { state, pendingCharges } : { state };
      const updated = await request<BillingDetail>(`/api/financial/billings/${detail.id}`, jsonInit("PATCH", body), "Não foi possível atualizar a cobrança.");

      setBilling(updated);
      setConfirmEnd(false);
      setScope(null);

      // The server keeps the invite alive after the billing ends, so drop it here; a failure must not block the transition.
      if (state === "ended" && invite) {
        await request<void>(`/api/financial/billings/${detail.id}/invite`, {
          method: "DELETE",
        }).catch(() => undefined);

        setInvite(null);
      }
    }, "Não foi possível atualizar a cobrança.");
  }

  /** The owner says who a guest is: an existing contact without e-mail, a brand-new participant, or nobody. */
  async function resolveGuest(detail: BillingDetail, guest: BillingGuest, action: BillingGuestAction) {
    await run(async () => {
      const updated = await request<BillingDetail>(`/api/financial/billings/${detail.id}/guests/${guest.id}`, jsonInit("POST", action), "Não foi possível confirmar a pessoa.");

      setBilling(updated);
    }, "Não foi possível confirmar a pessoa.");
  }

  async function shareCharge(charge: ChargeDetail) {
    setChooser(false);

    await run(async () => {
      const link = await request<{ token: string }>(`/api/financial/charges/${charge.id}/public-link`, { method: "POST" }, "Não foi possível compartilhar o link.");

      const url = `${window.location.origin}/pay/${encodeURIComponent(link.token)}`;

      await shareUrl(url, "Cobrança Receivy", chargeShareText(charge, url));
    }, "Não foi possível compartilhar o link.");
  }

  /** The owner settles one participant by hand; the billing reloads so the cycle totals follow. */
  async function markPaid(charge: ChargeDetail, name: string) {
    await run(async () => {
      // A file under review is what the owner is answering: accepting it registers the payment.
      if (charge.proofState === "pending") {
        await request<ChargeDetail>(`/api/financial/charges/${charge.id}/proof/review`, jsonInit("POST", { decision: "accepted" }), "Não foi possível revisar o comprovante.");
      } else {
        await request<ChargeDetail>(`/api/financial/charges/${charge.id}/pay`, { method: "POST" }, "Não foi possível atualizar a cobrança.");
      }

      setConfirmPaid(null);
      load();
      setNotice(`Pagamento de ${name} registrado.`);
    }, "Não foi possível atualizar a cobrança.");
  }

  async function reopen(charge: ChargeDetail) {
    await run(async () => {
      await request<ChargeDetail>(`/api/financial/charges/${charge.id}/reopen`, { method: "POST" }, "Não foi possível reabrir a cobrança.");

      setConfirmReopen(null);
      load();
    }, "Não foi possível reabrir a cobrança.");
  }

  /** "Não notificar" / "Voltar a notificar" for one participant; the answer is the billing with its pending charges updated. */
  async function notifyParticipant(detail: BillingDetail, userId: string, name: string, notify: boolean) {
    await run(async () => {
      const updated = await request<BillingDetail>(`/api/financial/billings/${detail.id}/participants/${userId}/notify`, jsonInit("PUT", { notify }), "Não foi possível atualizar os avisos.");

      setBilling(updated);
      setConfirmStopNotify(null);

      if (!notify) {
        return;
      }

      setNotice(`Avisos reativados para ${name}.`);
    }, "Não foi possível atualizar os avisos.");
  }

  function pause(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      void transition(detail, "paused");

      return;
    }

    setScope("paused");
  }

  function end(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      setConfirmEnd(true);

      return;
    }

    setScope("ended");
  }

  if (!billing) {
    return (
      <section className="flex min-h-[40vh] items-center justify-center">
        {error ? (
          <div className="flex flex-col gap-3 px-5">
            <p role="alert" className="m-0 text-center text-danger">
              {error}
            </p>
            <button type="button" className="min-h-12 font-bold text-primary" onClick={load}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <p role="status" className="m-0 text-sm text-muted">
            Carregando cobrança…
          </p>
        )}
      </section>
    );
  }

  const today = calendarDate(new Date(), billing.timezone);
  const cycles = cyclesOf(billing);
  const current = currentCycle(cycles);
  const firstRows = firstRowIds(current?.charges ?? []);
  const totals = current ? cycleTotals(current) : { paid: 0, goal: billing.total.amountCents, paidCount: 0, open: 0 };
  const goal = totals.goal || billing.total.amountCents;
  const progress = goal ? Math.min(100, Math.floor((totals.paid / goal) * 100)) : 0;
  const pending = current?.charges.filter((charge) => charge.state === "pending") ?? [];
  // A conta a pagar carries its own key; a conta a receber points at the wallet.
  const payable = billing.type === "payable";
  // A registro: the owner alone, already settled, with the other side named by the API.
  const settled = billing.kind === BillingKind.Record;
  const payment = payable
    ? billing.pix
      ? { provider: PaymentProvider.Pix, kind: billing.pix.keyType, value: billing.pix.key }
      : null
    : (billing.charges.find((charge) => charge.payment)?.payment ?? methodFromWallet(methods, billing.paymentMethodId) ?? null);
  const ended = billing.state === "ended";
  const currency = billing.total.currency;
  const stateTone = billing.state === "active" ? "success" : billing.state === "paused" ? "warning" : "neutral";

  function statusLine(charge: ChargeDetail): {
    text: string;
    tone: "success" | "warning" | "danger" | "neutral";
  } {
    if (charge.state === "paid") {
      return {
        text: charge.paidAt ? paidAtText(charge.paidAt, billing!.timezone) : "Pago",
        tone: "success",
      };
    }

    if (charge.state === "cancelled") {
      return { text: "Cancelada", tone: "neutral" };
    }

    const late = daysBetween(charge.dueDate, today);

    if (late > 0) {
      return {
        text: `Atrasada há ${late} dia${late === 1 ? "" : "s"}`,
        tone: "danger",
      };
    }

    return {
      text: late === 0 ? "Vence hoje" : `Vence em ${dayMonth(charge.dueDate)}`,
      tone: "warning",
    };
  }

  /** The participant behind a row while the billing still splits with them; a conta a pagar has none. */
  function participantOf(detail: BillingDetail, charge: ChargeDetail): BillingAllocation | undefined {
    if (detail.type === "payable") {
      return undefined;
    }

    return detail.allocations.find((allocation) => allocation.kind === SplitPartKind.User && allocation.userId === charge.debtorId);
  }

  /** Silencing asks first; turning the notices back on does not. */
  function toggleNotify(detail: BillingDetail, participant: BillingAllocation, name: string) {
    const userId = participant.userId;

    if (!userId) {
      return;
    }

    if (!participant.notify) {
      void notifyParticipant(detail, userId, name, true);

      return;
    }

    setConfirmStopNotify({ userId, name });
  }

  return (
    <section className="flex flex-col gap-5 pb-10">
      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <Toast message={notice} onDismiss={() => setNotice("")} />}

      <div className="grid gap-5 md:grid-cols-2 md:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {/* Hero */}
          <article className="flex flex-col gap-3 overflow-hidden rounded-2xl border border-outline/30 bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-medium text-muted">
                  <CategoryIcon category={billing.category} size={14} />
                  {billingCategoryLabel(billing.category)}
                </span>
                <span className="rounded-full bg-info-soft px-2.5 py-1 text-[11px] font-semibold text-info">{typeTag(billing, current)}</span>
                {payable && <span className="rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-semibold text-warning">A pagar</span>}
                {settled && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted">Registro</span>}
              </div>
              <StatusTag label={STATE_LABELS[billing.state]} tone={stateTone} compact />
            </div>

            <h2 className="m-0 text-[22px] font-bold tracking-tight text-primary-strong">{billing.description}</h2>
            {settled && <p className="m-0 text-sm font-semibold text-ink">{counterpartHeadline(billing)}</p>}

            <p className="m-0 text-xs text-muted">
              {ended ? "Sem próximos vencimentos" : "Próx. vencimento: "}
              {!ended && <strong className="font-semibold text-ink">{billing.nextDueDate ? dateText(billing.nextDueDate) : "sem data"}</strong>}
            </p>

            <div className="flex flex-col gap-2 rounded-xl border border-outline/20 bg-surface-muted/70 p-3.5">
              <div className="flex items-end justify-between">
                <div>
                  <span className="block text-[11px] text-muted">{payable ? "Total pago" : "Total Recebido"}</span>
                  <strong className="text-lg font-bold text-primary-strong">{money(totals.paid, currency)}</strong>
                </div>
                <div className="text-right">
                  <span className="block text-[11px] text-muted">{payable ? "Meta da rodada" : "Meta da Rodada"}</span>
                  <strong className="text-sm font-semibold text-ink">{money(goal, currency)}</strong>
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-outline/30" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Liquidado no ciclo">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-primary">{progress}% liquidado</span>
                <span className="text-[11px] text-muted">Falta {money(Math.max(0, goal - totals.paid), currency)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-outline/20 pt-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <KeyRound size={14} aria-hidden="true" className="shrink-0 text-primary-strong" />
                {/* Only the owner reaches this screen, so the key itself is safe to show here. */}
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                  {payment ? (
                    <>
                      {`${paymentMethodText(payment).title}: `}
                      <span className="font-medium text-ink">{paymentMethodText(payment).value}</span>
                    </>
                  ) : payable ? (
                    "Sem chave Pix"
                  ) : (
                    "Sem meio de pagamento vinculado"
                  )}
                </span>
              </div>
              {payment && (
                <CopyButton
                  value={paymentMethodCopyValue(payment)}
                  ariaLabel="Copiar valor"
                  onRefused={() => setError("Não foi possível copiar a chave.")}
                />
              )}
            </div>
          </article>

          {/* Ações rápidas */}
          {!ended && (
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2">
                <ActionTile
                  label="Editar"
                  icon={Pencil}
                  hint={payable ? "Categoria, Pix e lembretes" : billing.recurrence === "indefinite" ? "Valor e pessoas do próximo ciclo" : "Categoria e Pix"}
                  disabled={busy}
                  onClick={() => router.push(`/billings/${billing.id}/edit`)}
                />
                {billing.state === "active" && !payable && !settled && (
                  <ActionTile label="Convidar" icon={UserPlus} hint="Compartilha um convite para entrar na cobrança" disabled={busy} onClick={() => void inviteSomeone(billing)} />
                )}
                {billing.recurrence === "indefinite" && (
                  <ActionTile
                    label={billing.state === "active" ? "Pausar" : "Retomar"}
                    icon={billing.state === "active" ? CirclePause : CirclePlay}
                    hint={billing.state === "active" ? "Suspende as próximas ocorrências" : "Volta a gerar ocorrências"}
                    disabled={busy}
                    onClick={() => (billing.state === "active" ? pause(billing) : void transition(billing, "active"))}
                  />
                )}
                <ActionTile label="Encerrar" icon={CircleStop} tone="danger" hint="Cancela as pendentes e impede novas ocorrências" disabled={busy} onClick={() => end(billing)} />
              </div>
              {invite && billing.state === "active" && !payable && !settled && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] text-muted">Convite ativo até {dayMonth(invite.expiresAt.slice(0, 10))}</span>
                  <button type="button" disabled={busy} onClick={() => void revokeInvite(billing)} className="min-h-8 text-[11px] font-semibold text-danger">
                    Revogar convite
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {/* Convidados — people who joined by the link and wait for the owner to say who they are */}
          {billing.guests.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-lg font-semibold text-primary-strong">Aguardando você</h2>

              {billing.guests.map((guest) => (
                <article key={guest.id} className="flex flex-col gap-2.5 rounded-xl border border-outline/30 border-l-4 border-l-primary bg-surface p-3.5">
                  <div className="flex items-center gap-3">
                    <InitialsAvatar name={guest.name} size={40} avatar={guest.avatar} />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{guest.name}</span>
                      <span className="block truncate text-[11px] text-muted">{guest.email}</span>
                    </div>
                  </div>
                  <p className="m-0 text-xs text-muted">Entrou pelo link. Quem é essa pessoa?</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {billing.linkableContacts.map((contact) => (
                      <button
                        key={contact.contactId}
                        type="button"
                        disabled={busy}
                        onClick={() => void resolveGuest(billing, guest, { action: "link", contactId: contact.contactId })}
                        className="inline-flex min-h-8 items-center rounded-full border border-primary/40 bg-primary-soft/40 px-3 text-[11px] font-semibold text-primary-strong disabled:opacity-50"
                      >
                        {`É ${contact.displayName}`}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resolveGuest(billing, guest, { action: "add" })}
                      className="inline-flex min-h-8 items-center rounded-lg bg-primary px-3 text-[11px] font-semibold text-on-primary disabled:opacity-50"
                    >
                      Novo participante
                    </button>
                    <button type="button" disabled={busy} onClick={() => void resolveGuest(billing, guest, { action: "dismiss" })} className="min-h-8 px-2 text-[11px] font-semibold text-muted disabled:opacity-50">
                      Ignorar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Participantes — a conta a pagar has a single charge per cycle, owed to the payee or to nobody */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="m-0 text-lg font-semibold text-primary-strong">{payable || settled ? "Cobranças" : "Participantes"}</h2>
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-primary-strong">{current?.charges.length ?? 0}</span>
              </div>
              {current && billing.recurrence !== "once" && (
                <span className="text-[11px] text-muted">
                  {billing.recurrence === "until" ? `Ciclo ${current.charges[0]?.installment ?? current.index} de ${billing.installmentCount ?? "?"}` : `Ciclo ${current.index}`}
                </span>
              )}
            </div>

            {!current && <p className="m-0 text-sm text-muted">Nenhuma cobrança gerada ainda.</p>}

            {current?.charges.map((charge) => {
              const status = statusLine(charge);
              const isPending = charge.state === "pending";
              // A file under review changes what the row asks of the owner: review it, never nag.
              const reviewing = isPending && charge.proofState === "pending";
              // A registro's rows carry its counterpart; a conta a pagar names the contact who receives.
              const name = payable && !settled ? (billing.counterpart?.name ?? "Só comigo") : charge.recipient.name;
              const avatar = payable && !settled ? (billing.counterpart?.avatar ?? null) : charge.recipient.avatar;
              const participant = participantOf(billing, charge);
              // The badge is this charge's own switch; the participant's switch drives their action.
              const quiet = charge.notify === false;
              const participantQuiet = participant?.notify === false;
              const statusColor = {
                success: "text-primary",
                warning: "text-warning",
                danger: "text-danger",
                neutral: "text-muted",
              }[status.tone];
              // The corner tag's own urgency wording matches the feed's badges; only "Em revisão" overrides it.
              const tag = reviewing ? { label: "Em revisão", tone: "info" as const } : chargeStateTag(charge, today);

              return (
                <article key={charge.id} className={`flex flex-col gap-2.5 rounded-xl border border-outline/30 bg-surface p-3.5 ${isPending ? "border-l-4 border-l-warning" : ""}`}>
                  <button
                    type="button"
                    aria-label={`Abrir cobrança de ${name}`}
                    onClick={() => router.push(`/charges/${charge.id}`)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <InitialsAvatar name={name} size={40} avatar={avatar} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-ink">{name}</span>
                          {quiet && <StatusTag label="Sem avisos" tone="neutral" compact />}
                        </span>
                        <span className={`block text-[11px] font-medium ${statusColor}`}>{status.text}</span>
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-sm font-semibold text-ink">{formatMoney(charge.amount)}</span>
                      <StatusTag label={tag.label} tone={tag.tone} compact />
                    </span>
                  </button>

                  {reviewing && !ended && (
                    <div className="flex items-center justify-between border-t border-outline/20 pt-2.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-strong">
                        <Receipt size={13} aria-hidden="true" />
                        Comprovante em revisão
                      </span>
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Marcar ${name} como pago`}
                          disabled={busy}
                          onClick={() => setConfirmPaid({ charge, name })}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-outline/50 bg-surface px-3 text-[11px] font-semibold text-ink disabled:opacity-50"
                        >
                          Marcar pago
                        </button>
                        <button
                          type="button"
                          aria-label={`Revisar comprovante de ${name}`}
                          onClick={() => router.push(`/charges/${charge.id}`)}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[11px] font-semibold text-on-primary"
                        >
                          Revisar
                        </button>
                      </span>
                    </div>
                  )}

                  {isPending && !reviewing && !ended && (
                    <div className="flex items-center justify-between border-t border-outline/20 pt-2.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                        <Bell size={13} aria-hidden="true" />
                        Aguardando pagamento
                      </span>
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Marcar ${name} como pago`}
                          disabled={busy}
                          onClick={() => setConfirmPaid({ charge, name })}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-outline/50 bg-surface px-3 text-[11px] font-semibold text-ink disabled:opacity-50"
                        >
                          Marcar pago
                        </button>
                        {!payable && !settled && (
                          <button
                            type="button"
                            aria-label={`Compartilhar link de ${name}`}
                            disabled={busy}
                            onClick={() => void shareCharge(charge)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary disabled:opacity-50"
                          >
                            <Share2 size={14} aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    </div>
                  )}

                  {charge.state === "paid" && !ended && (
                    <div className="flex justify-end border-t border-outline/20 pt-2.5">
                      <button
                        type="button"
                        aria-label={`Reabrir cobrança de ${name}`}
                        disabled={busy}
                        onClick={() => setConfirmReopen(charge)}
                        className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted disabled:opacity-50"
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                        Reabrir
                      </button>
                    </div>
                  )}

                  {participant && !ended && firstRows.has(charge.id) && (
                    <div className="flex justify-end border-t border-outline/20 pt-2.5">
                      <button
                        type="button"
                        aria-label={participantQuiet ? `Voltar a notificar ${name}` : `Não notificar ${name}`}
                        disabled={busy}
                        onClick={() => toggleNotify(billing, participant, name)}
                        className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] font-semibold text-muted disabled:opacity-50"
                      >
                        {participantQuiet ? <Bell size={12} aria-hidden="true" /> : <BellOff size={12} aria-hidden="true" />}
                        {participantQuiet ? "Voltar a notificar" : "Não notificar"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Histórico */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-lg font-semibold text-primary-strong">Histórico de cobranças</h2>
              <span className="text-[11px] text-muted">
                Total: {cycles.length} ciclo{cycles.length === 1 ? "" : "s"}
              </span>
            </div>

            {billing.recurrence === "indefinite" &&
              billing.previews.map((preview) => (
                <div key={preview.occurrenceDate} className="flex items-center justify-between rounded-xl border border-dashed border-outline/40 bg-surface/70 p-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-muted">
                      <CircleDashed size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <span className="block text-xs font-semibold text-ink">Próxima • {dateText(preview.occurrenceDate)}</span>
                      <span className="block text-[11px] text-muted">
                        {formatMoney(preview.amount)} {payable ? "a pagar" : "a receber"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-ink">{formatMoney(billing.total)}</span>
                    <StatusTag label="Projeção" tone="neutral" compact />
                  </div>
                </div>
              ))}

            {!cycles.length && <p className="m-0 text-sm text-muted">Nenhum ciclo gerado ainda.</p>}

            {[...cycles].reverse().map((cycle) => {
              const state = cycleState(cycle);
              const { paidCount, open } = cycleTotals(cycle);
              const amount = cycle.charges.filter((charge) => charge.state !== "cancelled").reduce((sum, charge) => sum + charge.amount.amountCents, 0);
              const subtitle = state === "cancelled" ? "Cancelada" : state === "done" ? `Todos os ${open} pagaram` : `${paidCount} de ${open} participantes pagos`;
              const Icon = state === "done" ? Check : CircleDashed;

              return (
                <div key={cycle.dueDate} className={`flex items-center justify-between rounded-xl border bg-surface p-3.5 ${state === "open" ? "border-primary/20" : "border-outline/30 opacity-90"}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        state === "done" ? "bg-success-soft text-success" : state === "open" ? "bg-info-soft text-info" : "bg-surface-muted text-muted"
                      }`}
                    >
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink">
                        {cycleTitle(billing, cycle)} <span className="font-medium text-muted">• {dateText(cycle.dueDate)}</span>
                      </span>
                      <span className="block text-[11px] text-muted">{subtitle}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-ink">{money(amount, currency)}</span>
                    <StatusTag
                      label={state === "done" ? "Concluída" : state === "open" ? "Em andamento" : "Cancelada"}
                      tone={state === "done" ? "success" : state === "open" ? "info" : "neutral"}
                      compact
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {pending.length > 0 && !ended && !payable && !settled && (
        <div className="relative">
          <button
            type="button"
            aria-label="Compartilhar link de pagamento"
            disabled={busy}
            onClick={() => (pending.length === 1 ? void shareCharge(pending[0]!) : setChooser((open) => !open))}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-on-primary disabled:opacity-50"
          >
            <Share2 size={18} aria-hidden="true" />
            Compartilhar Link de Pagamento
          </button>
          {chooser && (
            <div role="dialog" aria-label="Compartilhar link de quem?" className="mt-2 flex flex-col gap-2 rounded-2xl border border-outline/40 bg-canvas p-4">
              <h3 className="m-0 text-base font-semibold text-primary-strong">Compartilhar link de quem?</h3>
              {pending.map((charge) => (
                <button
                  key={charge.id}
                  type="button"
                  aria-label={`Link de ${charge.recipient.name}`}
                  onClick={() => void shareCharge(charge)}
                  className="flex min-h-14 items-center gap-3 rounded-2xl border border-outline/40 bg-surface px-4 text-left"
                >
                  <InitialsAvatar name={charge.recipient.name} size={36} avatar={charge.recipient.avatar} />
                  <span className="flex-1 font-semibold text-ink">{charge.recipient.name}</span>
                  <span className="text-sm font-semibold text-primary">{formatMoney(charge.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmEnd && (
        <ConfirmDialog
          title="Encerrar conta?"
          subtitle="Esta ação não pode ser desfeita."
          icon={CircleStop}
          explanation={`Encerrar cancela as cobranças pendentes de “${billing.description}” e impede novas ocorrências.`}
          confirmLabel="Encerrar"
          busy={busy}
          onConfirm={() => void transition(billing, "ended")}
          onCancel={() => setConfirmEnd(false)}
        />
      )}

      {scope && (
        <ScopeDialog
          title={scope === "paused" ? "Pausar conta?" : "Encerrar conta?"}
          subtitle={scope === "ended" ? "Esta ação não pode ser desfeita." : undefined}
          icon={scope === "paused" ? CirclePause : CircleStop}
          explanation={scope === "paused" ? `Novas cobranças deixam de ser geradas. E as pendentes de “${billing.description}”?` : `Encerrar impede novas ocorrências de “${billing.description}”. E as pendentes?`}
          primaryLabel="Manter as deste mês"
          secondaryLabel={`Cancelar pendentes (${pendingChargesOf(billing).length})`}
          secondaryTone="danger"
          busy={busy}
          onPrimary={() => void transition(billing, scope, PendingChargesAction.Keep)}
          onSecondary={() => void transition(billing, scope, PendingChargesAction.Cancel)}
          onCancel={() => setScope(null)}
        />
      )}

      {confirmPaid && (
        <ConfirmDialog
          title="Marcar como paga?"
          icon={Check}
          tone="primary"
          explanation="Isso registra um pagamento integral e encerra a cobrança. Dá para reabrir depois."
          confirmLabel="Marcar paga"
          busy={busy}
          onConfirm={() => void markPaid(confirmPaid.charge, confirmPaid.name)}
          onCancel={() => setConfirmPaid(null)}
        />
      )}

      {confirmReopen && (
        <ConfirmDialog
          title="Reabrir cobrança?"
          icon={RotateCcw}
          explanation="O pagamento registrado é removido e a cobrança volta a ficar pendente. Um comprovante aceito volta para revisão."
          confirmLabel="Reabrir"
          busy={busy}
          onConfirm={() => void reopen(confirmReopen)}
          onCancel={() => setConfirmReopen(null)}
        />
      )}

      {confirmStopNotify && (
        <ConfirmDialog
          title={`Não notificar ${confirmStopNotify.name}?`}
          icon={BellOff}
          tone="primary"
          explanation={`Os lembretes automáticos das cobranças pendentes e futuras de ${confirmStopNotify.name} nesta conta param.`}
          confirmLabel="Não notificar"
          busy={busy}
          onConfirm={() => void notifyParticipant(billing, confirmStopNotify.userId, confirmStopNotify.name, false)}
          onCancel={() => setConfirmStopNotify(null)}
        />
      )}
    </section>
  );
}
