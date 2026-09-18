import { calendarDate, currentMonth, feedFiltersFromQuery, filterCharges, isMonth, type ListCharge } from "@receivy/common";
import { AppShell } from "@/components/app/app-shell";
import { FeedScreen } from "@/components/screens/feed-screen";
import { sessionApiFetch } from "@/lib/auth/session-fetch";

type FeedPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function listCharges(month: string): Promise<ListCharge | null> {
  return sessionApiFetch<ListCharge>(`charges?month=${encodeURIComponent(month)}`);
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.month) ? params.month[0] : params.month;
  const month = isMonth(requested) ? requested : currentMonth();
  const today = calendarDate();
  const filters = feedFiltersFromQuery(params, today);
  const charges = await listCharges(month);

  return (
    <AppShell activePath="/feed">
      <FeedScreen
        charges={filterCharges(charges ?? [], filters, today)}
        filters={filters}
        month={month}
        today={today}
      />
    </AppShell>
  );
}
