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

/** Where the fake link provider sends people locally: one button that "pays" and returns like InfinitePay would. */
export default async function FakeInfinitePayPage({ params, searchParams }: { params: Promise<{ orderNsu: string }>; searchParams: Promise<{ redirect?: string }> }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { orderNsu } = await params;
  const { redirect } = await searchParams;
  const back = redirect ? buildReturnUrl(redirect, orderNsu) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="m-0 text-xl font-bold text-ink">Checkout de mentira</h1>
      <p className="m-0 text-sm text-muted">Pedido {orderNsu}. Nada é cobrado: o botão volta para a cobrança como a InfinitePay voltaria.</p>
      {back ? (
        <a href={back.toString()} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 font-bold text-on-primary">
          Simular pagamento
        </a>
      ) : (
        <p className="m-0 text-sm text-danger">Sem redirect: abra este link a partir da cobrança.</p>
      )}
    </main>
  );
}
