import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PixSettingsScreen } from "@/components/pix-settings-screen";

export default function PixSettingsPage() {
  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href="/settings">
        ← Perfil
      </Link>
      <PixSettingsScreen />
    </AppShell>
  );
}
