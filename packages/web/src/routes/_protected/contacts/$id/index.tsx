import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { ContactLedgerScreen } from "@/components/screens/contact-ledger-screen";

export const Route = createFileRoute("/_protected/contacts/$id/")({
  head: () => ({ meta: [{ title: "Contato | Receivy" }] }),
  component: ContactPage,
});

function ContactPage() {
  const { id } = Route.useParams();

  return (
    <AppShell activePath="/settings" title="Contato" back="/contacts">
      <ContactLedgerScreen id={id} />
    </AppShell>
  );
}
