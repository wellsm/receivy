import { AppShell } from "@/components/app/app-shell";
import { WhatsappScreen } from "@/components/screens/whatsapp-screen";

export default function WhatsappPage() {
  return (
    <AppShell activePath="/settings" title="WhatsApp" back="/settings">
      <WhatsappScreen />
    </AppShell>
  );
}
