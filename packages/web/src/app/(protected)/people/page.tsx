import { AppShell } from "@/components/app-shell";
import { PeopleScreen } from "@/components/people-screen";
import { safeNextPath } from "@/lib/auth/cookies";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;

  return (
    <AppShell activePath="/settings">
      <PeopleScreen returnTo={returnTo ? safeNextPath(returnTo) : undefined} />
    </AppShell>
  );
}
