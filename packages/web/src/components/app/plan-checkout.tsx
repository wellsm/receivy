"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type FormEvent, useState } from "react";
import { stripePromise } from "@/lib/stripe";

type Mode = "subscribe" | "setup";

type PlanCheckoutProps = { mode: Mode; clientSecret: string; onDone: (paymentMethodId?: string) => void; onCancel: () => void };

const GENERIC_ERROR = "Não deu para confirmar agora. Tente de novo.";

const APPEARANCE = { theme: "stripe" as const, variables: { colorPrimary: "#4b3fd6", borderRadius: "12px" } };

function CheckoutForm({ mode, onDone, onCancel }: Omit<PlanCheckoutProps, "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setBusy(true);
    setError("");

    // `if_required`: a card without 3DS never leaves the page; 3DS opens Stripe's own modal and comes back here.
    const result = mode === "subscribe" ? await stripe.confirmPayment({ elements, redirect: "if_required" }) : await stripe.confirmSetup({ elements, redirect: "if_required" });

    if (result.error) {
      setError(result.error.message ?? GENERIC_ERROR);
      setBusy(false);

      return;
    }

    if ("setupIntent" in result && result.setupIntent) {
      const method = result.setupIntent.payment_method;

      onDone(typeof method === "string" ? method : method?.id);

      return;
    }

    onDone(undefined);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-12 flex-1 rounded-xl border border-outline font-semibold text-ink">Voltar</button>
        <button type="submit" disabled={busy || !stripe} className="min-h-12 flex-1 rounded-xl bg-primary font-bold text-on-primary disabled:opacity-60">
          {mode === "subscribe" ? "Confirmar assinatura" : "Salvar cartão"}
        </button>
      </div>
    </form>
  );
}

/** Stripe's Payment Element inside our page: the card never touches our servers, and nobody is redirected. */
export function PlanCheckout({ mode, clientSecret, onDone, onCancel }: PlanCheckoutProps) {
  const stripe = stripePromise();

  if (!stripe) {
    return null;
  }

  return (
    <Elements stripe={stripe} options={{ clientSecret, locale: "pt-BR", appearance: APPEARANCE }}>
      <CheckoutForm mode={mode} onDone={onDone} onCancel={onCancel} />
    </Elements>
  );
}
