import { AppShell } from "@/components/app-shell";
import { ProfileScreen } from "@/components/profile-screen";

export default function SettingsPage() {
  return (
    <AppShell activePath="/settings">
      <ProfileScreen version={process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"} />
    </AppShell>
  );
}
