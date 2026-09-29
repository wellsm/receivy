import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { completeOauth } from "@/lib/auth/flows";

type CallbackSearch = { code?: string };

export const Route = createFileRoute("/auth/oauth/callback")({
  validateSearch: (search: Record<string, unknown>): CallbackSearch => (typeof search.code === "string" ? { code: search.code } : {}),
  component: OauthCallbackPage,
});

function OauthCallbackPage() {
  const { code } = Route.useSearch();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  // StrictMode runs effects twice in dev; the verifier must be popped and the code spent once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }

    started.current = true;

    if (!code) {
      return;
    }

    completeOauth(code)
      .then((user) => {
        if (!user) {
          setFailed(true);

          return;
        }

        void navigate({ to: "/feed", replace: true });
      })
      .catch(() => {
        setFailed(true);
      });
  }, [code, navigate]);

  if (failed || !code) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-5 text-center">
        <h1 className="m-0 font-display text-2xl font-bold text-ink">Não foi possível entrar</h1>
        <Link className="text-sm font-semibold text-primary" to="/login" search={{ error: "oauth" }}>Tentar de novo</Link>
      </main>
    );
  }

  return <main className="flex min-h-dvh items-center justify-center bg-canvas text-sm text-muted">Entrando…</main>;
}
