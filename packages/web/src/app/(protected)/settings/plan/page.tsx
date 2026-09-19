import { AppShell } from "@/components/app/app-shell";
import { PlanScreen } from "@/components/screens/plan-screen";

export default function PlanPage() {
  return (
    <AppShell activePath="/settings" title="Plano" back="/settings">
      <PlanScreen />
    </AppShell>
  );
}
