import type { PublicLink } from "@receivy/common";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { apiJson } from "@/lib/api/client";

/**
 * `/p/<code>` is what the notices print: short enough for a WhatsApp message. It opens the same
 * `/pay/<token>` page the signed link does. An unknown, revoked or expired code goes there too, and
 * the pay page shows its "Link indisponível" state, so that copy lives in one place.
 */
export const Route = createFileRoute("/p/$code")({
  loader: async ({ params }) => {
    const link = await apiJson<PublicLink>(`public/short/${encodeURIComponent(params.code)}`, { auth: false }).catch(() => null);

    throw redirect({ to: "/pay/$token", params: { token: link?.token ?? params.code }, replace: true });
  },
  head: () => ({ meta: [{ title: "Cobrança | Receivy" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
});
