import { AppShell } from "@/components/app/app-shell";
import { ProfileScreen } from "@/components/screens/profile-screen";

export default function SettingsPage() {
  return (
    <AppShell activePath="/settings">
      <ProfileScreen />
    </AppShell>
  );
}
