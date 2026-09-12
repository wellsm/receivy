import { AppShell } from "@/components/app/app-shell";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";
import { safeNextPath } from "@/lib/auth/cookies";

type EditContactPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
};

export default async function EditContactPage({ params, searchParams }: EditContactPageProps) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Editar contato" back={safeReturn ?? `/contacts/${id}`}>
      <ContactFormScreen contactId={id} returnTo={safeReturn} />
    </AppShell>
  );
}
