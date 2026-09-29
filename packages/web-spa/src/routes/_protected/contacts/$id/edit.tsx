import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";
import { safeNextPath } from "@/lib/auth/next-path";

type EditContactSearch = { returnTo?: string };

export const Route = createFileRoute("/_protected/contacts/$id/edit")({
  validateSearch: (search: Record<string, unknown>): EditContactSearch => (typeof search.returnTo === "string" ? { returnTo: search.returnTo } : {}),
  head: () => ({ meta: [{ title: "Editar contato | Receivy" }] }),
  component: EditContactPage,
});

function EditContactPage() {
  const { id } = Route.useParams();
  const { returnTo } = Route.useSearch();
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Editar contato" back={safeReturn ?? `/contacts/${id}`}>
      <ContactFormScreen contactId={id} returnTo={safeReturn} />
    </AppShell>
  );
}
