import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { ChargeDetailScreen } from "@/components/screens/charge-detail-screen";

type ChargeSearch = { returned?: string };

export const Route = createFileRoute("/_protected/charges/$id/")({
  validateSearch: (search: Record<string, unknown>): ChargeSearch => (typeof search.returned === "string" ? { returned: search.returned } : {}),
  head: () => ({ meta: [{ title: "Cobrança | Receivy" }] }),
  component: ChargePage,
});

function ChargePage() {
  const { id } = Route.useParams();
  const { returned } = Route.useSearch();

  return (
    <AppShell activePath="/billings" title="Cobrança" back="/billings">
      <ChargeDetailScreen id={id} returned={returned === "1"} />
    </AppShell>
  );
}
