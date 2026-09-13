"use client";

import { billingCategoryLabel, formatMoney, type BillingType, type InviteAcceptResult, type PublicInviteView } from "@receivy/common";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

type JoinInviteScreenProps = { token: string; view: PublicInviteView; authenticated: boolean };

const EXPIRED = "Convite expirado. Peça um novo link.";
const CONTACT_NOTICE = "Você entrou como contato; o criador ajusta a divisão.";
const AWAITING_NOTICE = "Você entrou. O dono da conta vai confirmar sua participação e a cobrança aparece no seu feed.";
const TYPE_LABELS: Record<BillingType, string> = { once: "À vista", until: "Parcelado", indefinite: "Sem fim" };

const PAGE = "min-h-screen bg-canvas px-4 pb-16 pt-7";
const COLUMN = "mx-auto flex w-full max-w-md flex-col gap-6 md:max-w-2xl";
const BRAND = "m-0 text-[22px] font-extrabold text-primary-strong";
const CARD = "flex flex-col gap-4 rounded-2xl border border-outline/30 bg-surface p-6 md:p-10";
const TITLE = "m-0 text-3xl font-extrabold leading-tight tracking-tight text-primary-strong md:text-4xl";
const PRIMARY_BUTTON = "inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-on-primary transition hover:bg-primary-strong disabled:opacity-50";

/** The public shell shown when the invite is missing, used by the page and by the screen. */
export function InviteUnavailable() {
  return (
    <main className={PAGE}>
      <div className={COLUMN}>
        <p className={BRAND}>Receivy</p>
        <section className={CARD}>
          <h1 className={TITLE}>Convite indisponível</h1>
          <p className="m-0 text-sm font-bold leading-6 text-muted">{EXPIRED}</p>
        </section>
      </div>
    </main>
  );
}

export function JoinInviteScreen({ token, view, authenticated }: JoinInviteScreenProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function join() {
    setBusy(true);
    setError("");

    try {
      const response = await browserFetch(`/api/financial/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });

      if (response.status === 404) {
        throw new Error(EXPIRED);
      }

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível entrar na cobrança."));
      }

      const result = (await response.json()) as InviteAcceptResult;

      if (result.awaitingOwner || !result.joinedSplit) {
        try {
          window.sessionStorage.setItem("receivy.notice", result.awaitingOwner ? AWAITING_NOTICE : CONTACT_NOTICE);
        } catch {
          // The notice is a courtesy; storage may be blocked.
        }
      }

      if (result.awaitingOwner) {
        router.replace("/");
        return;
      }

      router.replace(result.chargeId ? `/charges/${result.chargeId}` : "/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar na cobrança.");
    } finally {
      setBusy(false);
    }
  }

  if (view.expired) {
    return <InviteUnavailable />;
  }

  return (
    <main className={PAGE}>
      <div className={COLUMN}>
        <p className={BRAND}>Receivy</p>
        <section className={CARD}>
          <p className="m-0 text-sm text-muted">
            <strong className="font-bold text-primary-strong">{view.creditorFirstName}</strong> te convidou para
          </p>
          <h1 className={TITLE}>{view.description}</h1>
          <strong className="text-4xl font-extrabold tracking-tight text-primary-strong tabular-nums md:text-5xl">{formatMoney(view.amount)}</strong>

          <dl className="m-0 grid gap-3 border-t border-outline/20 pt-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Categoria</dt>
              <dd className="m-0 mt-1 font-bold text-ink">{billingCategoryLabel(view.category)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Participantes</dt>
              <dd className="m-0 mt-1 font-bold text-ink">{`${view.participantCount} pessoa${view.participantCount === 1 ? "" : "s"}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Modalidade</dt>
              <dd className="m-0 mt-1 font-bold text-ink">{TYPE_LABELS[view.type]}</dd>
            </div>
          </dl>

          {!authenticated && (
            <Link className={PRIMARY_BUTTON} href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>
              Entrar para participar
            </Link>
          )}
          {authenticated && (
            <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void join()}>
              Participar
            </button>
          )}

          {error && (
            <p className="m-0 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-[13px] leading-5 text-danger" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
