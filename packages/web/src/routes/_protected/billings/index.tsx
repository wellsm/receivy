import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { BillingsScreen } from "@/components/screens/billings-screen";

const protectedRoute = getRouteApi("/_protected");

export const Route = createFileRoute("/_protected/billings/")({
  head: () => ({ meta: [{ title: "Contas | Receivy" }] }),
  component: BillingsPage,
});

function BillingsPage() {
  const { user } = protectedRoute.useLoaderData();

  return (
    <AppShell activePath="/billings">
      <BillingsScreen user={user} />
    </AppShell>
  );
}
