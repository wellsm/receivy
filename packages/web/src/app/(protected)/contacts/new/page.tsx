import { AppShell } from "@/components/app/app-shell";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;

  return (
    <AppShell activePath="/settings" title="Novo contato" back={safeReturn ?? "/contacts"}>
      <ContactFormScreen returnTo={safeReturn} />
    </AppShell>
  );
}
