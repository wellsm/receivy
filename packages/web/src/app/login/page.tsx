import { LoginScreen } from "@/components/screens/login-screen";
import { safeNextPath } from "@/lib/auth/cookies";
import { loginProviders } from "@/lib/auth/login-providers";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [params, providers] = await Promise.all([searchParams, loginProviders()]);
  const nextPath = safeNextPath(params.next ?? null);

  return (
    <main className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden bg-canvas px-5 py-12 md:px-8 md:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-96 w-96 -translate-x-48 rounded-full bg-primary-soft/15" />
      <LoginScreen nextPath={nextPath} providers={providers} oauthError={params.error === "oauth"} />
    </main>
  );
}
