import { notFound, redirect } from "next/navigation";
import { authApiFetch } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

/** Local only: what the "Simular pagamento" button on the fake PagBank checkout hits. It stands in for the
 * PagBank checkout page itself, so it calls the API's fake webhook (dev/checkout/{provider}/{orderNsu}/pay,
 * 404 outside fake mode) and then returns the payer to the charge like PagBank would: unchanged url, `returned=1`
 * set once. The API's own redirect url already carries `?returned=1`; `URLSearchParams.set` keeps it a single
 * value instead of appending a second one (Next would otherwise parse the repeated key as `["1","1"]`, and the
 * pay page's `returned === "1"` check would never match). */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string; orderNsu: string }> }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { provider, orderNsu } = await params;
  const redirectTo = new URL(request.url).searchParams.get("redirect");

  if (!redirectTo) {
    notFound();
  }

  const response = await authApiFetch(`dev/checkout/${provider}/${orderNsu}/pay`, { method: "POST" });

  if (!response.ok) {
    notFound();
  }

  const back = new URL(redirectTo);

  back.searchParams.set("returned", "1");

  redirect(back.toString());
}
