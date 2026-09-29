import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { ContactsScreen } from "@/components/screens/contacts-screen";
import { safeNextPath } from "@/lib/auth/next-path";

type ContactsSearch = { returnTo?: string };

export const Route = createFileRoute("/_protected/contacts/")({
  validateSearch: (search: Record<string, unknown>): ContactsSearch => (typeof search.returnTo === "string" ? { returnTo: search.returnTo } : {}),
  head: () => ({ meta: [{ title: "Meus Contatos | Receivy" }] }),
  component: ContactsPage,
});

function ContactsPage() {
  const { returnTo } = Route.useSearch();
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Meus Contatos" back={safeReturn ?? "/settings"}>
      <ContactsScreen returnTo={safeReturn} />
    </AppShell>
  );
}
