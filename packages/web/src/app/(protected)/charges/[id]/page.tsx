import { AppShell } from "@/components/app/app-shell";
import { ChargeDetailScreen } from "@/components/screens/charge-detail-screen";

export default async function ChargePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell activePath="/billings" title="Cobrança" back="/billings">
      <ChargeDetailScreen id={id} />
    </AppShell>
  );
}
