import { PaymentProvider } from "@receivy/common";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** Module scope, not the component body: the ids only need to look plausible, and computing them
 * outside render keeps the page itself free of impure calls (Date.now). */
function buildReturnUrl(redirect: string, orderNsu: string): URL {
  const back = new URL(redirect);

  back.searchParams.set("order_nsu", orderNsu);
  back.searchParams.set("transaction_nsu", `fake-${Date.now()}`);
  back.searchParams.set("slug", `fake-${orderNsu.slice(0, 8)}`);
  back.searchParams.set("receipt_url", "https://example.invalid/recibo");

  return back;
}

/** Where the fake link provider sends people locally: one button that "pays" and returns like the real provider would.
 * InfinitePay closes the loop with return ids read by /pay's provider-return; PagBank instead hits its own
 * `/pay` route handler, which calls the API's fake webhook and comes back with `?returned=1`. */
export default async function FakeCheckoutPage({ params, searchParams }: { params: Promise<{ provider: string; orderNsu: string }>; searchParams: Promise<{ redirect?: string }> }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { provider, orderNsu } = await params;
  const { redirect } = await searchParams;
  const isPagSeguro = provider === PaymentProvider.PagSeguro;
  const href = redirect ? (isPagSeguro ? `/dev/checkout/${provider}/${orderNsu}/pay?redirect=${encodeURIComponent(redirect)}` : buildReturnUrl(redirect, orderNsu).toString()) : null;

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
