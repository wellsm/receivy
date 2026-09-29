import { PaymentProvider } from "@receivy/common";
import { createFileRoute, notFound } from "@tanstack/react-router";

type DevCheckoutSearch = { redirect?: string };

/** Outside render: the ids only need to look plausible, and the page itself stays free of impure calls (Date.now). */
function buildReturnUrl(redirect: string, orderNsu: string): URL {
  const back = new URL(redirect);

  back.searchParams.set("order_nsu", orderNsu);
  back.searchParams.set("transaction_nsu", `fake-${Date.now()}`);
  back.searchParams.set("slug", `fake-${orderNsu.slice(0, 8)}`);
  back.searchParams.set("receipt_url", "https://example.invalid/recibo");

  return back;
}

/**
 * Where the fake link provider sends people locally: one button that "pays" and returns like the real provider would.
 * InfinitePay closes the loop with return ids read by /pay's provider-return; PagBank instead goes through the sibling
 * `pay` route, which calls the API's fake webhook and comes back with `?returned=1`.
 */
export const Route = createFileRoute("/dev/checkout/$provider/$orderNsu/")({
  validateSearch: (search: Record<string, unknown>): DevCheckoutSearch => (typeof search.redirect === "string" ? { redirect: search.redirect } : {}),
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound();
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => {
    const { provider, orderNsu } = params;
    const isPagSeguro = provider === PaymentProvider.PagSeguro;

    if (!deps.redirect) {
      return { isPagSeguro, href: null };
    }

    const href = isPagSeguro ? `/dev/checkout/${provider}/${orderNsu}/pay?redirect=${encodeURIComponent(deps.redirect)}` : buildReturnUrl(deps.redirect, orderNsu).toString();

    return { isPagSeguro, href };
  },
  component: FakeCheckoutPage,
});

function FakeCheckoutPage() {
  const { orderNsu } = Route.useParams();
  const { isPagSeguro, href } = Route.useLoaderData();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="m-0 text-xl font-bold text-ink">Checkout de mentira</h1>
      <p className="m-0 text-sm text-muted">Pedido {orderNsu}. Nada é cobrado: o botão volta para a cobrança como {isPagSeguro ? "o PagBank" : "a InfinitePay"} voltaria.</p>
      {href ? (
        <a href={href} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 font-bold text-on-primary">
          Simular pagamento
        </a>
      ) : (
        <p className="m-0 text-sm text-danger">Sem redirect: abra este link a partir da cobrança.</p>
      )}
    </main>
  );
}
