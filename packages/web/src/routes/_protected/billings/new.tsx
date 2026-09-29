import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";

export const Route = createFileRoute("/_protected/billings/new")({
  head: () => ({ meta: [{ title: "Nova conta | Receivy" }] }),
  component: NewBillingPage,
});

function NewBillingPage() {
  const navigate = useNavigate();

  return (
    <AppShell activePath="/billings" title="Nova conta" back="/billings">
      <BillingFormScreen billing={null} onSaved={(billing) => void navigate({ to: "/billings/$id", params: { id: billing.id }, replace: true })} />
    </AppShell>
  );
}
