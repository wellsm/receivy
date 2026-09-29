import { createFileRoute, useRouter } from "@tanstack/react-router";
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

const enum OptOutLoad {
  Ready = "ready",
  Invalid = "invalid",
  Failed = "failed",
}

// A person only lands here from an e-mail footer link (or List-Unsubscribe), so the page opts them out on load; deciding to receive e-mails again means opening the link from a later e-mail.
export const Route = createFileRoute("/opt-out/$token")({
  loader: async ({ params }) => {
    const response = await apiFetch(`public/notices/opt-out/${encodeURIComponent(params.token)}`, { method: "POST", auth: false });

    if (response.status === 404) {
      return { load: OptOutLoad.Invalid };
    }

    // Any other refusal, or an outage (apiFetch resolves a 503), lets the person retry instead of ending on the root error.
    if (!response.ok) {
      return { load: OptOutLoad.Failed };
    }

    return { load: OptOutLoad.Ready };
  },
  head: () => ({ meta: [{ title: "Avisos por e-mail | Receivy" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: OptOutPage,
});

function OptOutPage() {
  const { token } = Route.useParams();
  const { load } = Route.useLoaderData();
  const router = useRouter();

  return (
    <main className={PAGE}>
      <div className={SHELL}>
        <Brand />
        <h1 className="m-0 text-xl font-bold text-ink">Avisos por e-mail</h1>
        {load === OptOutLoad.Ready && <OptOutPanel token={token} optedOut />}
        {load === OptOutLoad.Invalid && <p className="m-0 text-sm leading-6 text-muted">Este link não é válido ou expirou. Abra o link de um e-mail mais recente.</p>}
        {load === OptOutLoad.Failed && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm leading-6 text-muted">Não foi possível carregar esta página agora. Tente de novo em instantes.</p>
            <button
              type="button"
              onClick={() => void router.invalidate()}
              className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-xl bg-primary px-5 text-[15px] font-bold text-on-primary transition hover:bg-primary-strong"
            >
              Tentar de novo
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
