import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function PixSettingsPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;

  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href="/settings">
        ← Perfil
      </Link>
      <PixSettingsScreen returnTo={returnTo ? safeNextPath(returnTo) : undefined} />
    </AppShell>
  );
}
