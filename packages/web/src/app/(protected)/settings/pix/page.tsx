import { AppShell } from "@/components/app/app-shell";
import { PixSettingsScreen } from "@/components/screens/pix-settings-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function PixSettingsPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; required?: string }> }) {
  const { returnTo, required } = await searchParams;
  const back = returnTo ? safeNextPath(returnTo) : "/settings";

  return (
    <AppShell activePath="/settings" title="Minhas Chaves Pix" back={back}>
      <PixSettingsScreen returnTo={returnTo ? safeNextPath(returnTo) : undefined} required={required === "1"} />
    </AppShell>
  );
}
