import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";
import { safeNextPath } from "@/lib/auth/cookies";
import { backLabelFor } from "@/lib/navigation";

export default async function NewPersonPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;
  const back = safeReturn ?? "/people";

  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href={back}>
        ← {backLabelFor(back)}
      </Link>
      <ContactForm returnTo={safeReturn} />
    </AppShell>
  );
}
