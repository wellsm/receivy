"use client";

import { calendarDate, EMPTY_BILLING_DRAFT, formatMoney, formatPhoneBR, initialsOf, type ChargeDetail, type ContactLedger, type PublicLink } from "@receivy/common";
import { Bell, Check, Mail, Pencil, Plus, Share2, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";
import { ActionTile } from "@/components/ui/action-tile";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { StatusTag } from "@/components/ui/status-tag";

const LEDGER_ERROR = "Não foi possível carregar o histórico.";
const ARCHIVE_ERROR = "Não foi possível remover o contato.";
const LINK_ERROR = "Não foi possível compartilhar o link.";
const REMIND_ERROR = "Não foi possível enviar o lembrete.";
/** The billing form reads the parked draft on mount; this is the route it belongs to. */
const NEW_BILLING = "/billings/new";

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function dueLabel(charge: ChargeDetail, today: string): { text: string; late: boolean } {
  const days = daysBetween(today, charge.dueDate);

  if (days < 0) {
    return {
      text: `Atrasada há ${-days} dia${days === -1 ? "" : "s"}`,
      late: true,
    };
  }

  if (days === 0) {
    return { text: "Vence hoje", late: false };
  }

  return {
    text: days === 1 ? "Vence amanhã" : `Vence em ${days} dias`,
    late: false,
  };
}

function scheduleLine(charge: ChargeDetail): string {
  const due = `Vencimento em ${dateText(charge.dueDate)}`;

  if (charge.installmentCount && charge.installmentCount > 1) {
    return `Parcela ${charge.installment} de ${charge.installmentCount} • ${due}`;
  }

  return due;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function ContactLedgerScreen({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<ContactLedger | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  // Starts in the loading state; "Tentar novamente" and "Carregar mais" raise the flag themselves.
  const load = useCallback(
    async (cursor?: string) => {
      try {
        const response = await browserFetch(`/api/financial/contacts/${id}/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);

        if (!response.ok) {
          throw new Error(await responseMessage(response, LEDGER_ERROR));
        }

        const page = (await response.json()) as ContactLedger;

        setData((old) => (cursor && old ? { ...page, charges: [...old.charges, ...page.charges] } : page));
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : LEDGER_ERROR);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    // Deferred to a microtask: the lint rule reads a direct `load()` as a synchronous setState.
    void Promise.resolve().then(() => load());
  }, [load]);

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

  async function archive() {
    const done = await run(async () => {
      const response = await browserFetch(`/api/contacts/${id}/archive`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await responseMessage(response, ARCHIVE_ERROR));
      }

      await load();

      return true;
    }, ARCHIVE_ERROR);

    setConfirmRemoval(false);

    if (done) {
      setNotice("Contato removido; o histórico fica preservado.");
    }
  }

  // The web has no share sheet, so the link goes to the clipboard; the notice says so.
  async function shareLink(charge: ChargeDetail) {
    await run(async () => {
      const response = await browserFetch(`/api/financial/charges/${charge.id}/public-link`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, LINK_ERROR));
      }

      const link = (await response.json()) as PublicLink;
      const url = `${window.location.origin}/pay/${encodeURIComponent(link.token)}`;

      await navigator.clipboard?.writeText(url);

      setNotice("Link de pagamento copiado.");
    }, LINK_ERROR);
  }

  async function remind(charge: ChargeDetail) {
    const result = await run(async () => {
      const response = await browserFetch(`/api/financial/charges/${charge.id}/reminders`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, REMIND_ERROR));
      }

      return (await response.json()) as { queued: boolean };
    }, REMIND_ERROR);

    if (result) {
      setNotice(result.queued ? "Lembrete enviado." : "Este contato ainda não recebe lembretes.");
    }
  }

  function charge(userId: string) {
    // The contact arrives already selected by account: the form picks the parked draft up on mount.
    saveDraft(
      {
        ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", calendarDate()),
        selected: [userId],
      },
      NEW_BILLING,
    );
    router.push(NEW_BILLING);
  }

  if (!data) {
    return (
      <section className="flex flex-col gap-3">
        {error ? (
          <>
            <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError("");
                void load();
              }}
              className="min-h-12 self-start font-bold text-primary"
            >
              Tentar novamente
            </button>
          </>
        ) : (
          <p role="status" className="m-0 text-sm text-muted">
            Carregando histórico…
          </p>
        )}
      </section>
    );
  }

  const { contact } = data;
  const today = calendarDate();
  const archived = Boolean(contact.archivedAt);
  const active = data.charges.filter((item) => item.state === "pending");
  const history = data.charges.filter((item) => item.state !== "pending");
  const settled = history.filter((item) => item.state === "paid" && item.direction === "receivable");
  const settledCents = settled.reduce((sum, item) => sum + item.amount.amountCents, 0);
  const activeCents = active.reduce((sum, item) => sum + (item.direction === "receivable" ? item.amount.amountCents : 0), 0);
  const pendingCount = active.filter((item) => item.direction === "receivable").length;
  const first = firstName(contact.displayName);
  const currency = data.receivable.currency;

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-5 md:max-w-none">
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

      <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-start">
        <div className="flex flex-col gap-5">
          {/* Perfil */}
          <header className="relative flex flex-col items-center overflow-hidden rounded-xl border border-outline/30 bg-surface p-5 text-center">
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-primary" />
            {contact.avatar ? (
              <span className="mb-3 rounded-full border-2 border-surface">
                <InitialsAvatar name={contact.displayName} size={80} avatar={contact.avatar} />
              </span>
            ) : (
              <span aria-hidden="true" className="mb-3 flex h-20 w-20 items-center justify-center rounded-full border-2 border-surface bg-primary-soft/60 text-[22px] font-bold text-primary-strong">
                {initialsOf(contact.displayName)}
              </span>
            )}
            <h2 className="m-0 text-[22px] font-bold text-ink">{contact.displayName}</h2>
            {contact.nickname && <p className="m-0 text-xs text-muted">{contact.name}</p>}
            <div className="mt-1 flex flex-col items-center gap-0.5">
              {contact.phone && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <Smartphone size={15} aria-hidden="true" className="text-primary-strong" />
                  {formatPhoneBR(contact.phone)}
                </span>
              )}
              {(contact.email || !contact.phone) && (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Mail size={15} aria-hidden="true" />
                  {contact.email || "Só por link"}
                </span>
              )}
            </div>
            <div className="mt-3.5">
              {archived ? (
                <StatusTag label="Contato removido" tone="neutral" />
              ) : active.length ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warning" />
                  {active.length} cobrança{active.length === 1 ? "" : "s"} ativa
                  {active.length === 1 ? "" : "s"}
                </span>
              ) : (
                <StatusTag label="Sem cobranças ativas" tone="neutral" />
              )}
            </div>
          </header>

          {/* Ações rápidas */}
          {!archived && (
            <div className="flex gap-2">
              <ActionTile label="Editar" icon={Pencil} hint="Abre o formulário do contato" disabled={busy} onClick={() => router.push(`/contacts/${id}/edit`)} />
              <ActionTile label="Cobrar" icon={Plus} tone="primary" hint={`Nova cobrança para ${first}`} disabled={busy} onClick={() => charge(contact.userId)} />
              <ActionTile label="Remover" icon={Trash2} tone="danger" hint="Arquiva o contato e preserva o histórico" disabled={busy} onClick={() => setConfirmRemoval(true)} />
            </div>
          )}

          {/* Balanço */}
          <section className="flex flex-col gap-3 rounded-xl border border-outline/30 bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-sm font-bold text-ink">Balanço com {first}</h2>
              <span className="text-[11px] text-muted">
                {data.charges.length} cobrança
                {data.charges.length === 1 ? "" : "s"} no total
              </span>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1 rounded-lg border border-outline/20 bg-surface-muted/80 p-3">
                <span className="text-[11px] text-muted">A receber</span>
                <strong className="text-2xl font-extrabold text-primary tabular-nums">{formatMoney(data.receivable)}</strong>
                <span className="text-[11px] text-warning">
                  {pendingCount} pendência{pendingCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1 rounded-lg border border-outline/20 bg-surface-muted/80 p-3">
                <span className="text-[11px] text-muted">Já liquidado</span>
                <strong className="text-2xl font-extrabold text-ink tabular-nums">{formatMoney({ amountCents: settledCents, currency })}</strong>
                <span className="text-[11px] text-primary">
                  {settled.length} quitada{settled.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            {data.payable.amountCents > 0 && (
              <p className="m-0 text-xs text-muted">
                Você deve <strong className="text-ink">{formatMoney(data.payable)}</strong> para {first}.
              </p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {/* Cobranças ativas */}
          <section className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-0.5">
              <h2 className="m-0 flex items-center gap-2 text-lg font-bold text-ink">
                Cobranças Ativas
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-on-primary">{active.length}</span>
              </h2>
              <span className="text-[11px] text-muted">Total: {formatMoney({ amountCents: activeCents, currency })}</span>
            </div>

            {!active.length && <p className="m-0 text-sm text-muted">Nada pendente com {first}.</p>}

            {active.map((item) => {
              const due = dueLabel(item, today);
              const waitingProof = item.proofState === "pending";
              const receivable = item.direction === "receivable";

              return (
                <article
                  key={item.id}
                  aria-label={`Cobrança ${item.description}`}
                  className={`flex flex-col gap-3 rounded-xl border border-outline/30 bg-surface p-4 ${due.late ? "border-l-4 border-l-danger" : receivable ? "border-l-4 border-l-warning" : ""}`}
                >
                  <Link href={`/charges/${item.id}`} className="flex items-start justify-between gap-2 text-inherit no-underline">
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-base font-bold text-ink">{item.description}</strong>
                        {waitingProof ? (
                          <StatusTag label="Aguardando comprovante" tone="info" />
                        ) : receivable ? (
                          <StatusTag label="Pendente" tone="warning" />
                        ) : (
                          <StatusTag label="A pagar" tone="neutral" />
                        )}
                      </span>
                      <span className="text-xs text-muted">{scheduleLine(item)}</span>
                    </span>
                    <strong className="whitespace-nowrap text-lg font-bold text-ink tabular-nums">{formatMoney(item.amount)}</strong>
                  </Link>

                  <div className="flex items-center justify-between gap-2 border-t border-outline/20 pt-3">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${due.late ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>{due.text}</span>
                    {receivable && (
                      <div className="flex items-center gap-2">
                        {item.sharingState === "ready" && (
                          <button
                            type="button"
                            aria-label={`Link de ${item.description}`}
                            disabled={busy}
                            onClick={() => void shareLink(item)}
                            className="flex h-9 items-center gap-1 rounded-lg bg-surface-muted px-3 text-xs font-semibold text-ink disabled:opacity-50"
                          >
                            <Share2 size={14} aria-hidden="true" className="text-primary-strong" />
                            Link
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Lembrar ${item.description}`}
                          disabled={busy}
                          onClick={() => void remind(item)}
                          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-on-primary disabled:opacity-50"
                        >
                          <Bell size={14} aria-hidden="true" />
                          Lembrar Pix
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          {/* Histórico */}
          <section className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-0.5">
              <h2 className="m-0 text-lg font-bold text-ink">Histórico / Concluídas</h2>
              <span className="text-[11px] font-semibold text-primary">
                {settled.length} liquidada{settled.length === 1 ? "" : "s"}
              </span>
            </div>

            {!history.length && <p className="m-0 text-sm text-muted">Nenhuma cobrança concluída ainda.</p>}

            {history.map((item) => {
              const paid = item.state === "paid";

              return (
                <Link
                  key={item.id}
                  href={`/charges/${item.id}`}
                  aria-label={`Abrir cobrança ${item.description}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-outline/20 bg-surface p-4 text-inherit no-underline"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${paid ? "bg-success-soft text-primary" : "bg-surface-muted text-muted"}`}>
                      {paid ? <Check size={18} /> : <Trash2 size={18} />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <strong className="truncate text-sm font-bold text-ink">{item.description}</strong>
                      <span className="text-xs text-muted">
                        {paid ? `Pago em ${dateText((item.paidAt ?? item.dueDate).slice(0, 10))}` : "Cancelada"}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <strong className="text-base font-bold text-ink tabular-nums">{formatMoney(item.amount)}</strong>
                    <StatusTag label={paid ? "Pago" : "Cancelada"} tone={paid ? "success" : "neutral"} compact />
                  </span>
                </Link>
              );
            })}
          </section>

          {loading && (
            <p role="status" className="m-0 text-sm text-muted">
              Carregando histórico…
            </p>
          )}
          {data.nextCursor && (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load(data.nextCursor ?? undefined);
              }}
              className="min-h-12 self-center font-bold text-primary"
            >
              Carregar mais
            </button>
          )}
        </div>
      </div>

      {confirmRemoval && (
        <ConfirmDialog
          title="Remover contato?"
          subtitle="O histórico de cobranças fica preservado."
          icon={Trash2}
          explanation={`${contact.displayName} sai da sua agenda e não entra em novas cobranças.`}
          confirmLabel="Remover"
          busy={busy}
          onConfirm={() => void archive()}
          onCancel={() => setConfirmRemoval(false)}
        />
      )}
    </section>
  );
}
