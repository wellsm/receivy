"use client";

import {
  calendarDate,
  canAcceptProof,
  canCancelCharge,
  canMarkPaid,
  canRemind,
  canReopenCharge,
  canShare,
  canUploadProof,
  chargeDateText,
  chargeShareText,
  chargeStateTag,
  chargeStatusLine,
  chargeTypeLabel,
  counterpartRoleLabel,
  formatMoney,
  type ChargeDetail,
  type PublicLink,
  REMINDER_QUOTA_MESSAGE,
} from "@receivy/common";
import { Bell, CalendarDays, Check, CircleStop, CloudUpload, Copy, Eye, RotateCcw, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { uploadProofFile } from "@/lib/proof-upload";
import { FirstSharePix } from "@/components/app/first-share-pix";
import { ProofCard } from "@/components/app/proof-card";
import { Toast } from "@/components/app/toast";
import { ActionTile } from "@/components/ui/action-tile";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { ScreenFooter } from "@/components/ui/screen-footer";
import { StatusTag } from "@/components/ui/status-tag";

const LOAD_ERROR = "Não foi possível carregar a cobrança.";

const STATUS_COLOR = {
  success: "text-primary",
  warning: "text-amber-700",
  danger: "text-red-700",
  neutral: "text-muted",
  info: "text-blue-800",
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

/** What a debtor sees instead of actions once the charge no longer accepts a payment. */
function payableGuidance(charge: ChargeDetail): string | null {
  if (charge.direction !== "payable") {
    return null;
  }

  if (charge.state === "paid") {
    return "Esta cobrança já foi paga. Nenhuma nova transferência é necessária.";
  }

  if (charge.state === "cancelled") {
    return "Esta cobrança foi cancelada e não deve ser paga.";
  }

  // The owner of a conta a pagar has no creditor to ask; they settle it themselves.
  return charge.pix || charge.ownedByViewer ? null : "A chave Pix ainda não está disponível. Combine o pagamento com o credor.";
}

export function ChargeDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const [charge, setCharge] = useState<ChargeDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // Picking only stages the file; the footer button is what sends it.
  const [picked, setPicked] = useState<File | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [confirmRemind, setConfirmRemind] = useState(false);
  // How the payment lands: accepting the file under review or by hand; `null` keeps the dialog closed.
  const [confirmPaid, setConfirmPaid] = useState<"review" | "pay" | null>(null);

  const base = `/api/financial/charges/${id}`;

  const load = useCallback(() => {
    let live = true;

    request<ChargeDetail>(base)
      .then((detail) => {
        if (!live) {
          return;
        }

        setCharge(detail);
        setError("");
      })
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : LOAD_ERROR))
      .finally(() => live && setLoaded(true));

    return () => {
      live = false;
    };
  }, [base]);

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

  async function markPaid(how: "review" | "pay") {
    await run(async () => {
      if (how === "review") {
        setCharge(await request<ChargeDetail>(`${base}/proof/review`, jsonInit("POST", { decision: "accepted" }), "Não foi possível revisar o comprovante."));
        setConfirmPaid(null);
        setNotice("Comprovante aceito e pagamento registrado.");
        return;
      }

      setCharge(await request<ChargeDetail>(`${base}/pay`, { method: "POST" }, "Não foi possível atualizar a cobrança."));
      setConfirmPaid(null);
      setNotice("Pagamento integral registrado.");
    }, "Não foi possível atualizar a cobrança.");
  }

  async function reopen() {
    await run(async () => {
      setCharge(await request<ChargeDetail>(`${base}/reopen`, { method: "POST" }, "Não foi possível reabrir a cobrança."));
      setConfirmReopen(false);
    }, "Não foi possível reabrir a cobrança.");
  }

  async function cancel() {
    await run(async () => {
      setCharge(await request<ChargeDetail>(`${base}/cancel`, { method: "POST" }, "Não foi possível atualizar a cobrança."));
      setConfirmCancel(false);
      setNotice("Cobrança cancelada e mantida no histórico.");
    }, "Não foi possível atualizar a cobrança.");
  }

  async function shareLink(rotate = false, paymentMethodId?: string) {
    await run(async () => {
      const path = `${base}/public-link${rotate ? "/rotate" : ""}`;
      const link = await request<PublicLink>(path, paymentMethodId ? jsonInit("POST", { paymentMethodId }) : { method: "POST" }, "Não foi possível compartilhar o link.");

      if (paymentMethodId) {
        setCharge(await request<ChargeDetail>(base));
      }

      const url = `${window.location.origin}/pay/${encodeURIComponent(link.token)}`;
      const text = chargeShareText(charge!, url);

      if (navigator.share) {
        await navigator.share({ title: "Cobrança Receivy", text, url }).catch((reason: unknown) => {
          if ((reason as DOMException).name !== "AbortError") {
            throw new Error("Não foi possível abrir o compartilhamento. Copie o link manualmente.");
          }
        });
        return;
      }

      await navigator.clipboard.writeText(text);
      setNotice("Link copiado.");
    }, "Não foi possível compartilhar o link.");
  }

  async function remind(detail: ChargeDetail) {
    setConfirmRemind(false);

    const result = await run(async () => {
      const response = await browserFetch(`${base}/reminders`, { method: "POST" });

      if (response.status === 429) {
        throw new Error(REMINDER_QUOTA_MESSAGE);
      }

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível enviar o lembrete."));
      }

      return (await response.json()) as { queued: boolean };
    }, "Não foi possível enviar o lembrete.");

    if (result) {
      setNotice(result.queued ? `Lembrete enviado para ${detail.recipient.name}.` : `${detail.recipient.name} ainda não recebe lembretes.`);
    }
  }

  async function copyPix(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setError("");
      setNotice("Chave Pix copiada.");
    } catch {
      setError("Não foi possível copiar a chave.");
    }
  }

  async function upload(file: File) {
    const sent = await run(() => uploadProofFile(base, file), "Não foi possível enviar o comprovante.");

    if (!sent) {
      return;
    }

    // Stays on the charge: the card swaps the preview for the sent file under review.
    setPicked(null);
    setCharge(sent);
    setNotice("Comprovante enviado para revisão.");
  }

  function sendPicked() {
    if (!picked) {
      return;
    }

    void upload(picked);
  }

  if (!charge) {
    return (
      <section className="flex min-h-[40vh] items-center justify-center">
        {loaded ? (
          <div className="flex flex-col gap-3 px-5">
            <p role="alert" className="m-0 text-center text-red-700">
              {error || LOAD_ERROR}
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

  const receivable = charge.direction === "receivable";
  const pending = charge.state === "pending";
  const proof = charge.proof;
  const state = chargeStateTag(charge);
  const status = chargeStatusLine(charge, calendarDate());
  const guidance = payableGuidance(charge);
  const ownBill = charge.payer === "owner";
  // The creditor of a conta a receber: the only viewer who publishes links and sends reminders.
  const creditor = receivable && !ownBill;
  const markable = canMarkPaid(charge);
  const reopenable = canReopenCharge(charge);
  const shareable = canShare(charge);
  const remindable = canRemind(charge);
  const cancellable = canCancelCharge(charge);
  const acceptProof = canAcceptProof(charge);
  const uploadAllowed = canUploadProof(charge);
  // The card picks the file; this button only sends it, so it stays disabled until there is one.
  const footerLabel = uploadAllowed ? (proof ? "Enviar novo comprovante" : "Enviar comprovante") : "Ver comprovante enviado";

  return (
    <section className="flex flex-col gap-4 pb-4">
      {error && (
        <p role="alert" className="m-0 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && <Toast message={notice} onDismiss={() => setNotice("")} />}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] md:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Hero: the same card the billing detail opens with, scoped to one person */}
          <article className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${receivable ? "bg-primary-soft/50 text-primary-strong" : "bg-violet-100 text-violet-900"}`}>
                  {receivable ? "A receber" : "A pagar"}
                </span>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-900">{chargeTypeLabel(charge)}</span>
                {ownBill && charge.ownedByViewer && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-900">Minha conta</span>}
              </div>
              <StatusTag label={state.label} tone={state.tone} compact />
            </div>

            <h2 className="m-0 text-[22px] font-bold tracking-tight text-primary-strong">{charge.description}</h2>

            <div className="flex items-center gap-3">
              <InitialsAvatar name={charge.recipient.name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-semibold text-ink">{charge.recipient.name}</p>
                <p className="m-0 text-[11px] text-muted">{counterpartRoleLabel(charge)}</p>
              </div>
            </div>

            <p className="m-0 flex items-center gap-1.5 text-xs text-muted">
              <CalendarDays size={14} aria-hidden="true" className="shrink-0 text-primary-strong" />
              <span>
                Vencimento: <strong className="font-semibold text-ink">{chargeDateText(charge.dueDate)}</strong>
                {pending && <span className={STATUS_COLOR[status.tone]}> ({status.text.toLocaleLowerCase("pt-BR")})</span>}
              </span>
            </p>

          </article>

          {/* Amount */}
          <article className="flex flex-col items-center gap-1 rounded-2xl border border-outline/30 bg-surface p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{receivable ? "Valor a receber" : "Valor a pagar"}</span>
            <strong className="text-4xl font-extrabold tracking-tight text-primary-strong">{formatMoney(charge.amount)}</strong>
            <span className={`text-xs font-medium ${STATUS_COLOR[status.tone]}`}>{status.text}</span>
          </article>

          {/* Quick actions: whoever pays copies the key and sends the proof; whoever collects (or owns the bill) marks it paid, and reopens it later */}
          {(pending || reopenable) && (
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-2">
                {!receivable && charge.pix && <ActionTile label="Copiar Chave Pix" icon={Copy} hint="Copia a chave Pix do credor" disabled={busy} onClick={() => void copyPix(charge.pix!.key)} />}
                {(!receivable || ownBill) && proof && (
                  <ActionTile label="Comprovante" icon={Eye} tone="primary" hint="Abre o comprovante enviado" disabled={busy} onClick={() => router.push(`/charges/${id}/proof`)} />
                )}
                {reopenable && <ActionTile label="Reabrir" icon={RotateCcw} hint="Desfaz o pagamento e volta a cobrança para pendente" disabled={busy} onClick={() => setConfirmReopen(true)} />}
                {shareable && <ActionTile label="Compartilhar" icon={Share2} hint="Envia o link público de pagamento" disabled={busy} onClick={() => void shareLink()} />}
                {remindable && <ActionTile label="Lembrar" icon={Bell} hint="Envia um lembrete de pagamento" disabled={busy} onClick={() => setConfirmRemind(true)} />}
                {cancellable && <ActionTile label="Cancelar" icon={CircleStop} tone="danger" hint="Encerra a cobrança sem pagamento" disabled={busy} onClick={() => setConfirmCancel(true)} />}
              </div>
              {shareable && (
                <div className="flex justify-end px-1">
                  <button type="button" disabled={busy} onClick={() => void shareLink(true)} className="min-h-8 text-[11px] font-semibold text-primary disabled:opacity-50">
                    Trocar e compartilhar link
                  </button>
                </div>
              )}
            </div>
          )}

          {guidance && <p className="m-0 rounded-2xl bg-surface-muted p-4 text-sm leading-5 text-muted">{guidance}</p>}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ProofCard
            charge={charge}
            busy={busy}
            picked={picked}
            onView={() => router.push(`/charges/${id}/proof`)}
            onPick={setPicked}
            onSend={markable ? sendPicked : undefined}
            onAccept={() => setConfirmPaid(acceptProof ? "review" : "pay")}
          />

          {creditor && pending && charge.sharingState === "pix_required" && <FirstSharePix busy={busy} publish={(methodId) => shareLink(false, methodId)} />}

          {charge.sharingState === "legacy_without_pix" && (
            <p className="m-0 text-xs leading-4 text-muted">
              Esta cobrança foi publicada sem Pix. O histórico não pode ser alterado nem receber um novo link; combine o pagamento manualmente com o credor.
            </p>
          )}
        </div>
      </div>

      {pending && !markable && (uploadAllowed || proof) && (
        <ScreenFooter className="-mx-1 mt-2 border-t border-outline/20 bg-canvas/95 px-1 py-3 backdrop-blur-md">
          <button
            type="button"
            disabled={busy || (uploadAllowed && !picked)}
            onClick={() => (uploadAllowed ? sendPicked() : router.push(`/charges/${id}/proof`))}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white transition hover:bg-primary-strong disabled:opacity-50"
          >
            {uploadAllowed ? <CloudUpload size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            {footerLabel}
          </button>
        </ScreenFooter>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Cancelar cobrança?"
          subtitle="Esta ação não pode ser desfeita."
          icon={CircleStop}
          explanation="Ela não aceitará pagamento e continuará no histórico."
          confirmLabel="Cancelar cobrança"
          busy={busy}
          onConfirm={() => void cancel()}
          onCancel={() => setConfirmCancel(false)}
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
          onConfirm={() => void markPaid(confirmPaid)}
          onCancel={() => setConfirmPaid(null)}
        />
      )}

      {confirmRemind && (
        <ConfirmDialog
          title="Enviar lembrete?"
          icon={Bell}
          tone="primary"
          explanation={`Avisa ${charge.recipient.name} por notificação no app ou por e-mail, com o link de pagamento e a chave Pix. Só um lembrete a cada 24 horas.`}
          confirmLabel="Enviar lembrete"
          busy={busy}
          onConfirm={() => void remind(charge)}
          onCancel={() => setConfirmRemind(false)}
        />
      )}

      {confirmReopen && (
        <ConfirmDialog
          title="Reabrir cobrança?"
          icon={RotateCcw}
          explanation="O pagamento registrado é removido e a cobrança volta a ficar pendente. Um comprovante aceito volta para revisão."
          confirmLabel="Reabrir"
          busy={busy}
          onConfirm={() => void reopen()}
          onCancel={() => setConfirmReopen(false)}
        />
      )}
    </section>
  );
}
