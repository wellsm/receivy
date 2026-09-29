import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";
import { safeNextPath } from "@/lib/auth/next-path";

type NewContactSearch = { returnTo?: string };

export const Route = createFileRoute("/_protected/contacts/new")({
  validateSearch: (search: Record<string, unknown>): NewContactSearch => (typeof search.returnTo === "string" ? { returnTo: search.returnTo } : {}),
  head: () => ({ meta: [{ title: "Novo contato | Receivy" }] }),
  component: NewContactPage,
});

function NewContactPage() {
  const { returnTo } = Route.useSearch();
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Novo contato" back={safeReturn ?? "/contacts"}>
      <ContactFormScreen returnTo={safeReturn} />
    </AppShell>
  );
}
