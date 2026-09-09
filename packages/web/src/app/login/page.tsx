import { EmailLoginForm } from "@/components/email-login-form";
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
    <main className="login-page">
      <EmailLoginForm nextPath={nextPath} providers={providers} oauthError={params.error === "oauth"} />
    </main>
  );
}
