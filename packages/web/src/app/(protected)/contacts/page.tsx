import { AppShell } from "@/components/app/app-shell";
import { ContactsScreen } from "@/components/screens/contacts-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const back = returnTo ? safeNextPath(returnTo) : "/settings";

  return (
    <AppShell activePath="/settings" title="Meus Contatos" back={back}>
      <ContactsScreen returnTo={returnTo ? safeNextPath(returnTo) : undefined} />
    </AppShell>
  );
}
