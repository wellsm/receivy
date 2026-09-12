import { AppShell } from "@/components/app/app-shell";
import { BillingDetailScreen } from "@/components/screens/billing-detail-screen";

export default async function BillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell activePath="/billings" title="Detalhes da conta" back="/billings">
      <BillingDetailScreen id={id} />
    </AppShell>
  );
}
