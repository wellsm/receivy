import { AppShell } from "@/components/app/app-shell";
import { ChargeDetailScreen } from "@/components/screens/charge-detail-screen";

export default async function ChargePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;

  return (
    <AppShell activePath="/billings" title="Cobrança" back="/billings">
      <ChargeDetailScreen id={id} returned={query.returned === "1"} />
    </AppShell>
  );
}
