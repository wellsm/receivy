import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { RemindersScreen } from "@/components/screens/reminders-screen";

export const Route = createFileRoute("/_protected/settings/reminders")({
  head: () => ({ meta: [{ title: "Lembretes | Receivy" }] }),
  component: RemindersPage,
});

function RemindersPage() {
  return (
    <AppShell activePath="/settings" title="Lembretes" back="/settings">
      <RemindersScreen />
    </AppShell>
  );
}
