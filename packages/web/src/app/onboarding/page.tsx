import { needsOnboarding } from "@receivy/common";
import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/screens/onboarding-screen";
import { safeNextPath } from "@/lib/auth/cookies";
import { currentUser } from "@/lib/auth/current-user";

type OnboardingPageProps = { searchParams: Promise<{ next?: string }> };

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const [user, params] = await Promise.all([currentUser(), searchParams]);
  const nextPath = safeNextPath(params.next ?? null);

  if (user && !needsOnboarding(user)) {
    redirect(nextPath);
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center bg-canvas px-6 py-8 md:px-8 md:py-16">
      <OnboardingScreen nextPath={nextPath} initialName={user?.name} />
    </main>
  );
}
