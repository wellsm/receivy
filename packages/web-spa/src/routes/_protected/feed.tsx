import { calendarDate, currentMonth, feedFiltersFromQuery, filterCharges, isMonth, type ListCharge } from "@receivy/common";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { FeedScreen } from "@/components/screens/feed-screen";
import { apiJson } from "@/lib/api/client";

const protectedRoute = getRouteApi("/_protected");

type FeedSearch = Record<string, string | string[] | undefined>;

export const Route = createFileRoute("/_protected/feed")({
  validateSearch: (search: Record<string, unknown>): FeedSearch =>
    Object.fromEntries(
      Object.entries(search).map(([key, value]) => [
        key,
        typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string")) ? value : undefined,
      ]),
    ),
  loaderDeps: ({ search }) => {
    const requested = Array.isArray(search.month) ? search.month[0] : search.month;

    return { month: isMonth(requested) ? requested : currentMonth() };
  },
  loader: async ({ deps }) => {
    const charges = await apiJson<ListCharge>(`charges?month=${encodeURIComponent(deps.month)}`).catch(() => null);

    return { charges: charges ?? [], month: deps.month };
  },
  head: () => ({ meta: [{ title: "Feed | Receivy" }] }),
  component: FeedPage,
});

function FeedPage() {
  const { charges, month } = Route.useLoaderData();
  const { user } = protectedRoute.useLoaderData();
  const search = Route.useSearch();
  const today = calendarDate();
  const filters = feedFiltersFromQuery(search, today);

  return (
    <AppShell activePath="/feed">
      <FeedScreen charges={filterCharges(charges, filters, today)} filters={filters} month={month} today={today} user={user} />
    </AppShell>
  );
}
