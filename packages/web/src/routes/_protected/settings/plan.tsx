import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { PlanScreen } from "@/components/screens/plan-screen";

export const Route = createFileRoute("/_protected/settings/plan")({
  head: () => ({ meta: [{ title: "Plano | Receivy" }] }),
  component: PlanPage,
});

function PlanPage() {
  return (
    <AppShell activePath="/settings" title="Plano" back="/settings">
      <PlanScreen />
    </AppShell>
  );
}
