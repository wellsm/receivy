import { createFileRoute, redirect } from "@tanstack/react-router";
import { apiJson } from "@/lib/api/client";

/**
 * `/o/<code>` is the opt-out link the notices print. It opens the same `/opt-out/<token>` page the
 * signed link does, which still asks for the click. An unknown code goes there too, and that page
 * shows its invalid-link state, so the copy lives in one place.
 */
export const Route = createFileRoute("/o/$code")({
  loader: async ({ params }) => {
    const link = await apiJson<{ token: string }>(`public/opt-out/short/${encodeURIComponent(params.code)}`, { auth: false }).catch(() => null);

    throw redirect({ to: "/opt-out/$token", params: { token: link?.token ?? params.code }, replace: true });
  },
  head: () => ({ meta: [{ title: "Avisos | Receivy" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
});
