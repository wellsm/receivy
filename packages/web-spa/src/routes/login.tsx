import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginScreen } from "@/components/screens/login-screen";
import { oauthProviders } from "@/lib/auth/flows";
import { safeNextPath } from "@/lib/auth/next-path";
import { hasSession } from "@/lib/auth/session";

type LoginSearch = { next?: string; error?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    ...(typeof search.next === "string" ? { next: search.next } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  beforeLoad: () => {
    if (hasSession()) {
      throw redirect({ to: "/feed" });
    }
  },
  loader: () => oauthProviders(),
  head: () => ({ meta: [{ title: "Entrar | Receivy" }] }),
  component: LoginPage,
});

function LoginPage() {
  const providers = Route.useLoaderData();
  const { next, error } = Route.useSearch();

  return (
    <main className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden bg-canvas px-5 py-12 md:px-8 md:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-96 w-96 -translate-x-48 rounded-full bg-primary-soft/15" />
      <LoginScreen nextPath={safeNextPath(next ?? null)} providers={providers} oauthError={error === "oauth"} />
    </main>
  );
}
