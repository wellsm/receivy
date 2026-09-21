import { AppShell } from "@/components/app/app-shell";
import { RemindersScreen } from "@/components/screens/reminders-screen";

export default function RemindersPage() {
  return (
    <AppShell activePath="/settings" title="Lembretes" back="/settings">
      <RemindersScreen />
    </AppShell>
  );
}
