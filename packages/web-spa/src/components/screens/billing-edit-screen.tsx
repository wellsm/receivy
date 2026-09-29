import type { BillingDetail } from "@receivy/common";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";
import { apiFetch } from "@/lib/api/client";
import { responseMessage } from "@/lib/financial-response";
import { useAppNavigate } from "@/lib/navigate";

const LOAD_ERROR = "Não foi possível carregar a cobrança.";

/** The same form as the creation route, seeded with the billing; the API decides what is still editable. */
export function BillingEditScreen({ id }: { id: string }) {
  const router = useRouter();
  const navigate = useAppNavigate();
  const [billing, setBilling] = useState<BillingDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;

    apiFetch(`billings/${encodeURIComponent(id)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await responseMessage(response, LOAD_ERROR));
        }

        return (await response.json()) as BillingDetail;
      })
      .then((detail) => live && setBilling(detail))
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : LOAD_ERROR));

    return () => {
      live = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <p role="alert" className="m-0 text-center text-danger">
          {error}
        </p>
        <button type="button" className="min-h-12 font-bold text-primary" onClick={() => router.history.back()}>
          Voltar
        </button>
      </div>
    );
  }

  if (!billing) {
    return (
      <p role="status" className="m-0 py-10 text-center text-sm text-muted">
        Carregando cobrança…
      </p>
    );
  }

  return <BillingFormScreen billing={billing} onSaved={() => navigate(`/billings/${id}`, { replace: true })} />;
}
