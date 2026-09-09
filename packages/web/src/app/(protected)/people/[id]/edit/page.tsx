import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ContactForm } from "@/components/contact-form";
import { safeNextPath } from "@/lib/auth/cookies";
import { backLabelFor } from "@/lib/navigation";

type EditPersonPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
};

export default async function EditPersonPage({ params, searchParams }: EditPersonPageProps) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const safeReturn = returnTo ? safeNextPath(returnTo) : undefined;
  const back = safeReturn ?? "/people";

  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href={back}>
        ← {backLabelFor(back)}
      </Link>
      <ContactForm personId={id} returnTo={safeReturn} />
    </AppShell>
  );
}
