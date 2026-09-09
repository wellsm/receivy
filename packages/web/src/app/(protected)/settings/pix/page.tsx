import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { safeNextPath } from "@/lib/auth/cookies";
import { backLabelFor } from "@/lib/navigation";

export default async function PixSettingsPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; required?: string }> }) {
  const { returnTo, required } = await searchParams;
  const back = returnTo ? safeNextPath(returnTo) : "/settings";

  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href={back}>
        ← {backLabelFor(back)}
      </Link>
      <PixSettingsScreen returnTo={returnTo ? safeNextPath(returnTo) : undefined} required={required === "1"} />
    </AppShell>
  );
}
