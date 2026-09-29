import { createFileRoute, notFound } from "@tanstack/react-router";
import { apiFetch } from "@/lib/api/client";

type DevPaySearch = { redirect?: string };

/** Only the app's own origin may be a target: this page never becomes an open redirect. */
function sameOriginTarget(target: string): URL | null {
  try {
    const url = new URL(target);

    return url.origin === window.location.origin ? url : null;
  } catch {
    return null;
  }
}

/**
 * Local only: what the "Simular pagamento" button on the fake PagBank checkout hits. It stands in for the
 * PagBank checkout page itself, so it calls the API's fake webhook (dev/checkout/{provider}/{orderNsu}/pay,
 * 404 outside fake mode) and then returns the payer to the charge like PagBank would: unchanged url, `returned=1`
 * set once. The API's own redirect url already carries `?returned=1`; `URLSearchParams.set` keeps it a single
 * value instead of appending a second one (the pay page's `returned === "1"` check would never match `["1","1"]`).
 */
export const Route = createFileRoute("/dev/checkout/$provider/$orderNsu/pay")({
  validateSearch: (search: Record<string, unknown>): DevPaySearch => (typeof search.redirect === "string" ? { redirect: search.redirect } : {}),
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound();
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const back = deps.redirect ? sameOriginTarget(deps.redirect) : null;

    if (!back) {
      throw notFound();
    }

    const response = await apiFetch(`dev/checkout/${encodeURIComponent(params.provider)}/${encodeURIComponent(params.orderNsu)}/pay`, { method: "POST", auth: false });

    if (!response.ok) {
      throw notFound();
    }

    back.searchParams.set("returned", "1");
    window.location.assign(back.toString());
  },
  component: DevPayPage,
});

function DevPayPage() {
  return <p className="m-0 p-5 text-sm text-muted">Voltando para a cobrança…</p>;
}
