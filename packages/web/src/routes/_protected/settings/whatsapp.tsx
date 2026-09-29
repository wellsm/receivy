import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { WhatsappScreen } from "@/components/screens/whatsapp-screen";

export const Route = createFileRoute("/_protected/settings/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp | Receivy" }] }),
  component: WhatsappPage,
});

function WhatsappPage() {
  return (
    <AppShell activePath="/settings" title="WhatsApp" back="/settings">
      <WhatsappScreen />
    </AppShell>
  );
}
