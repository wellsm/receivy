"use client";

import { billingCategoryLabel, formatMoney, type BillingType, type InviteAcceptResult, type PublicInviteView } from "@receivy/common";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

type JoinInviteProps = { token: string; view: PublicInviteView; authenticated: boolean };

const EXPIRED = "Convite expirado. Peça um novo link.";
const CONTACT_NOTICE = "Você entrou como contato; o criador ajusta a divisão.";
const TYPE_LABELS: Record<BillingType, string> = { once: "À vista", until: "Parcelado", indefinite: "Sem fim" };

export function JoinInvite({ token, view, authenticated }: JoinInviteProps) {
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

      if (!result.joinedSplit) {
        try {
          window.sessionStorage.setItem("receivy.notice", CONTACT_NOTICE);
        } catch {
          // The notice is a courtesy; storage may be blocked.
        }
      }

      router.replace(result.chargeId ? `/charges/${result.chargeId}` : "/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar na cobrança.");
    } finally {
      setBusy(false);
    }
  }

  if (view.expired) {
    return (
      <main className="public-charge public-invite">
        <div className="public-brand">Receivy</div>
        <section>
          <h1>Convite indisponível</h1>
          <p className="invite-expired">{EXPIRED}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="public-charge public-invite">
      <div className="public-brand">Receivy</div>
      <section>
        <p className="invite-inviter">
          <strong>{view.creditorFirstName}</strong> te convidou para
        </p>
        <h1>{view.description}</h1>
        <strong className="public-amount">{formatMoney(view.amount)}</strong>
        <dl>
          <div>
            <dt>Categoria</dt>
            <dd>{billingCategoryLabel(view.category)}</dd>
          </div>
          <div>
            <dt>Participantes</dt>
            <dd>{`${view.participantCount} pessoa${view.participantCount === 1 ? "" : "s"}`}</dd>
          </div>
          <div>
            <dt>Modalidade</dt>
            <dd>{TYPE_LABELS[view.type]}</dd>
          </div>
        </dl>
        {!authenticated && (
          <Link className="primary-button" href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>
            Entrar para participar
          </Link>
        )}
        {authenticated && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => void join()}>
            Participar
          </button>
        )}
        {error && <p className="login-error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
