import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { PaymentMethodFormScreen } from "@/components/forms/payment-method-form-screen";
import { safeNextPath } from "@/lib/auth/next-path";

type NewPaymentMethodSearch = { returnTo?: string; required?: string };

export const Route = createFileRoute("/_protected/settings/payment-methods/new")({
  validateSearch: (search: Record<string, unknown>): NewPaymentMethodSearch => ({
    ...(typeof search.returnTo === "string" ? { returnTo: search.returnTo } : {}),
    ...(typeof search.required === "string" ? { required: search.required } : {}),
  }),
  head: () => ({ meta: [{ title: "Novo meio de pagamento | Receivy" }] }),
  component: NewPaymentMethodPage,
});

function NewPaymentMethodPage() {
  const { returnTo, required } = Route.useSearch();
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Novo meio de pagamento" back={safeReturn ?? "/settings/payment-methods"}>
      <PaymentMethodFormScreen returnTo={safeReturn} required={required === "1"} />
    </AppShell>
  );
}
