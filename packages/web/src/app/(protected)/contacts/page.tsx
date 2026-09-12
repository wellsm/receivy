import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PeopleScreen } from "@/components/people-screen";
import { safeNextPath } from "@/lib/auth/cookies";
import { backLabelFor } from "@/lib/navigation";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const back = returnTo ? safeNextPath(returnTo) : "/settings";

  return (
    <AppShell activePath="/settings">
      <Link className="back-link" href={back}>
        ← {backLabelFor(back)}
      </Link>
      <PeopleScreen returnTo={returnTo ? safeNextPath(returnTo) : undefined} />
    </AppShell>
  );
}
