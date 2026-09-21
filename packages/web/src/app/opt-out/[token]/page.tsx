import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OptOutPanel } from "@/components/app/opt-out-panel";
import { authApiFetch } from "@/lib/auth/api";

export const metadata: Metadata = { title: "Avisos por e-mail | Receivy", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

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
export default async function OptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = await authApiFetch(`public/notices/opt-out/${encodeURIComponent(token)}`, { method: "POST" });

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error("opt-out failed");
  }

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
