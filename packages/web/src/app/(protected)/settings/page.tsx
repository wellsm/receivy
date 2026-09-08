import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { NotificationSettings } from "@/components/notification-settings";
import { AccountSettings } from "@/components/account-settings";

export default function SettingsPage() {
  return (
    <AppShell activePath="/settings">
      <section className="financial-page detail-section">
        <h2>Contatos</h2>
        <p>Pessoas que você cobra ou que cobram você.</p>
        <Link className="secondary-button" href="/people">Gerenciar contatos</Link>
      </section>
      <AccountSettings />
      <PixSettingsScreen />
      <NotificationSettings />
    </AppShell>
  );
}
