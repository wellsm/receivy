import { AppShell } from "@/components/app/app-shell";
import { BillingEditScreen } from "@/components/screens/billing-edit-screen";

export default async function EditBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell activePath="/billings" title="Editar conta" back={`/billings/${id}`}>
      <BillingEditScreen id={id} />
    </AppShell>
  );
}
