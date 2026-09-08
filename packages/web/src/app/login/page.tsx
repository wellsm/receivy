import { EmailLoginForm } from "@/components/email-login-form";
import { safeNextPath } from "@/lib/auth/cookies";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next ?? null);

  return (
    <main className="login-page">
      <EmailLoginForm nextPath={nextPath} oauthError={params.error === "oauth"} />
    </main>
  );
}
