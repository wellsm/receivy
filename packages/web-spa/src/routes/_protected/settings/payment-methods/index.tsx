import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { PaymentMethodsScreen } from "@/components/screens/payment-methods-screen";
import { safeNextPath } from "@/lib/auth/next-path";

type PaymentMethodsSearch = { returnTo?: string; required?: string };

export const Route = createFileRoute("/_protected/settings/payment-methods/")({
  validateSearch: (search: Record<string, unknown>): PaymentMethodsSearch => ({
    ...(typeof search.returnTo === "string" ? { returnTo: search.returnTo } : {}),
    ...(typeof search.required === "string" ? { required: search.required } : {}),
  }),
  head: () => ({ meta: [{ title: "Meios de pagamento | Receivy" }] }),
  component: PaymentMethodsPage,
});

function PaymentMethodsPage() {
  const { returnTo, required } = Route.useSearch();
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Meios de pagamento" back={safeReturn ?? "/settings"}>
      <PaymentMethodsScreen returnTo={safeReturn} required={required === "1"} />
    </AppShell>
  );
}
