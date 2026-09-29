import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { BillingEditScreen } from "@/components/screens/billing-edit-screen";

export const Route = createFileRoute("/_protected/billings/$id/edit")({
  head: () => ({ meta: [{ title: "Editar conta | Receivy" }] }),
  component: EditBillingPage,
});

function EditBillingPage() {
  const { id } = Route.useParams();

  return (
    <AppShell activePath="/billings" title="Editar conta" back={`/billings/${id}`}>
      <BillingEditScreen id={id} />
    </AppShell>
  );
}
