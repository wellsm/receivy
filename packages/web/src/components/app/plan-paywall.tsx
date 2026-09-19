"use client";

import { PLAN_LIMITS, type PlanErrorPayload, PlanTier } from "@receivy/common";
import { Crown } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";

type PlanPaywallProps = { error: PlanErrorPayload; onClose: () => void };

const BENEFITS = [`Até ${PLAN_LIMITS[PlanTier.Basic].indefinite} cobranças indefinidas ativas`, "Links de pagamento (InfinitePay e PagBank)"];

/** One dialog for every 402 the plan raises: the API says why, this says what the Básico unlocks. */
export function PlanPaywall({ error, onClose }: PlanPaywallProps) {
  const dismiss = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    dismiss.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 sm:items-center"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-[20px] border border-outline bg-surface p-6">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft">
          <Crown size={22} aria-hidden="true" className="text-primary-strong" />
        </div>
        <h2 id={titleId} className="m-0 font-display text-xl font-bold text-ink">Plano Básico</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{error.message}</p>
        <ul className="mt-4 flex list-none flex-col gap-2 p-0">
          {BENEFITS.map(benefit => (
            <li key={benefit} className="rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink">{benefit}</li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-2">
          <Link href="/settings/plan" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 font-bold text-on-primary">Ver plano</Link>
          <button ref={dismiss} type="button" onClick={onClose} className="min-h-12 rounded-xl font-semibold text-muted">Agora não</button>
        </div>
      </div>
    </div>
  );
}
