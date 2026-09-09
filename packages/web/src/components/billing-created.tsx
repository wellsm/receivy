"use client";

import { billingCategoryLabel, formatMoney, type BillingDetail, type BillingInvite } from "@receivy/common";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

type BillingCreatedProps = { billing: BillingDetail };

/** Short success screen: the created billing is already saved, this is only sharing. */
export function BillingCreated({ billing }: BillingCreatedProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const charges = billing.charges ?? [];
  const people = billing.split.parts.filter(part => part.kind === "person").length;
  const pending = charges.find(charge => charge.state === "pending");
  const firstCharge = charges[0];

  async function copy(value: string) {
    try {
      await navigator.clipboard?.writeText(value);
      setNotice("Link copiado");
    } catch {
      setError("Não foi possível copiar o link.");
    }
  }

  async function shareLink() {
    if (!pending) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await browserFetch(`/api/financial/charges/${pending.id}/public-link`, { method: "POST" });

      if (!response.ok) {
        router.push(`/charges/${pending.id}`);
        return;
      }

      const link = (await response.json()) as { token: string };
      await copy(`${window.location.origin}/pay/${link.token}`);
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await browserFetch(`/api/financial/billings/${billing.id}/invite`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível criar o convite."));
      }

      const created = (await response.json()) as BillingInvite;
      await copy(created.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="billing-created">
      <p className="date-line">{billingCategoryLabel(billing.category)}</p>
      <h1>Cobrança criada</h1>
      <p className="billing-created-summary">
        {billing.description} · {formatMoney(billing.total)}
      </p>
      <div className="billing-created-actions">
        {people === 1 && pending && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => void shareLink()}>
            Compartilhar link
          </button>
        )}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void invite()}>
          Convidar
        </button>
        {firstCharge && (
          <button type="button" className="secondary-button" onClick={() => router.push(`/charges/${firstCharge.id}`)}>
            Ver cobrança
          </button>
        )}
        <button type="button" className="secondary-button" onClick={() => router.push("/billings")}>
          Voltar às cobranças
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p className="login-error" role="alert">{error}</p>}
    </section>
  );
}
