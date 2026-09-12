import { AppShell } from "@/components/app/app-shell";
import { ContactLedgerScreen } from "@/components/screens/contact-ledger-screen";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell activePath="/settings" title="Contato" back="/contacts">
      <ContactLedgerScreen id={id} />
    </AppShell>
  );
}
