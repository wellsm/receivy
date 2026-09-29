import { createFileRoute, notFound } from "@tanstack/react-router";
import { OptOutPanel } from "@/components/app/opt-out-panel";
import { apiFetch } from "@/lib/api/client";

const PAGE = "min-h-screen bg-canvas px-4 pb-16 pt-6 md:flex md:items-center md:justify-center md:px-10 md:py-10";
const SHELL = "mx-auto flex w-full max-w-md flex-col gap-5 overflow-hidden rounded-3xl border border-outline bg-surface p-5 md:max-w-lg md:p-9";

function Brand() {
  return (
    <p className="m-0 flex items-center gap-2.5 font-display text-base font-bold text-ink">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
        R
      </span>
      Receivy
    </p>
  );
}

// A person only lands here from an e-mail footer link (or List-Unsubscribe), so the page opts them out on load; deciding to receive e-mails again means opening the link from a later e-mail.
export const Route = createFileRoute("/opt-out/$token")({
  loader: async ({ params }) => {
    const response = await apiFetch(`public/notices/opt-out/${encodeURIComponent(params.token)}`, { method: "POST", auth: false });

    if (response.status === 404) {
      throw notFound();
    }

    if (!response.ok) {
      throw new Error("opt-out failed");
    }
  },
  head: () => ({ meta: [{ title: "Avisos por e-mail | Receivy" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: OptOutPage,
});

function OptOutPage() {
  const { token } = Route.useParams();

  return (
    <main className={PAGE}>
      <div className={SHELL}>
        <Brand />
        <h1 className="m-0 text-xl font-bold text-ink">Avisos por e-mail</h1>
        <OptOutPanel token={token} optedOut />
      </div>
    </main>
  );
}
