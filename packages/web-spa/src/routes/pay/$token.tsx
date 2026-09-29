import { createFileRoute, redirect } from "@tanstack/react-router";
import { PublicChargeScreen } from "@/components/screens/public-charge-screen";
import { loadPublicCharge, ownChargeIdByToken, type PublicChargeQuery } from "@/lib/public-charge";

const pick = (search: Record<string, unknown>, key: keyof PublicChargeQuery) => (typeof search[key] === "string" ? { [key]: search[key] } : {});

export const Route = createFileRoute("/pay/$token")({
  validateSearch: (search: Record<string, unknown>): PublicChargeQuery => ({
    ...pick(search, "order_nsu"),
    ...pick(search, "transaction_nsu"),
    ...pick(search, "slug"),
    ...pick(search, "returned"),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    // Back from InfinitePay: close the charge with the ids, then take them out of the address bar and the history
    // (replace), so going back or reloading never posts the return again. The loader then runs for `?returned=1`.
    if (deps.order_nsu && deps.transaction_nsu && deps.slug) {
      await loadPublicCharge(params.token, deps);

      throw redirect({ to: "/pay/$token", params, search: { returned: "1" }, replace: true });
    }

    const charge = await loadPublicCharge(params.token, deps);
    // Back from the checkout with a session: a participant lands on their own charge screen, not the public one.
    // Any other visit (a creditor previewing the link, a payer without account) stays here.
    const ownChargeId = charge && deps.returned === "1" ? await ownChargeIdByToken(params.token) : null;

    if (ownChargeId) {
      throw redirect({ to: "/charges/$id", params: { id: ownChargeId }, search: { returned: "1" }, replace: true });
    }

    return { charge };
  },
  head: () => ({ meta: [{ title: "Cobrança | Receivy" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: PayPage,
});

function PayPage() {
  const { token } = Route.useParams();
  const { charge } = Route.useLoaderData();
  const query = Route.useSearch();

  return <PublicChargeScreen token={token} charge={charge} query={query} />;
}
