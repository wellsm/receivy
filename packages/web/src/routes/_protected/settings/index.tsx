import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { ProfileScreen } from "@/components/screens/profile-screen";

export const Route = createFileRoute("/_protected/settings/")({
  head: () => ({ meta: [{ title: "Perfil | Receivy" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AppShell activePath="/settings">
      <ProfileScreen />
    </AppShell>
  );
}
