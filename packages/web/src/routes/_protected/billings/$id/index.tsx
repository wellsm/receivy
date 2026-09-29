import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { BillingDetailScreen } from "@/components/screens/billing-detail-screen";

export const Route = createFileRoute("/_protected/billings/$id/")({
  head: () => ({ meta: [{ title: "Detalhes da conta | Receivy" }] }),
  component: BillingPage,
});

function BillingPage() {
  const { id } = Route.useParams();

  return (
    <AppShell activePath="/billings" title="Detalhes da conta" back="/billings">
      <BillingDetailScreen id={id} />
    </AppShell>
  );
}
