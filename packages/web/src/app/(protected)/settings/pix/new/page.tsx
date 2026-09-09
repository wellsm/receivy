import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PixKeyForm } from "@/components/pix-key-form";
import { safeNextPath } from "@/lib/auth/cookies";
import { backLabelFor } from "@/lib/navigation";

export default async function NewPixKeyPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; required?: string }> }) {
  const { returnTo, required } = await searchParams;
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;
  const back = safeReturn ?? "/settings/pix";

  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href={back}>
        ← {backLabelFor(back)}
      </Link>
      <PixKeyForm returnTo={safeReturn} required={required === "1"} />
    </AppShell>
  );
}
