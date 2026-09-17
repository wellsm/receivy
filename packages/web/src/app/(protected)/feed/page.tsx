import { calendarDate, currentMonth, feedFiltersFromQuery, filterCharges, isMonth, type ListCharge } from "@receivy/common";
import { AppShell } from "@/components/app/app-shell";
import { FeedScreen } from "@/components/screens/feed-screen";
import { currentUser } from "@/lib/auth/current-user";
import { sessionApiFetch } from "@/lib/auth/session-fetch";

type FeedPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function listCharges(month: string): Promise<ListCharge | null> {
  return await sessionApiFetch<ListCharge>(`charges?month=${encodeURIComponent(month)}`);
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.month) ? params.month[0] : params.month;
  const month = isMonth(requested) ? requested : currentMonth();
  const today = calendarDate();
  const filters = feedFiltersFromQuery(params, today);
  const [charges, user] = await Promise.all([listCharges(month), currentUser()]);
  const viewerEmail = user?.email ?? "";

  return (
    <AppShell activePath="/feed">
      <FeedScreen
        charges={filterCharges(viewerEmail, charges ?? [], filters, today)}
        filters={filters}
        month={month}
        today={today}
        viewerEmail={viewerEmail}
      />
    </AppShell>
  );
}
