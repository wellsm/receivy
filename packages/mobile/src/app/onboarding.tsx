import { useRouter } from "expo-router";
import { OnboardingScreen } from "@/components/onboarding-screen";

export default function OnboardingRoute() {
  const router = useRouter();

  return <OnboardingScreen onComplete={() => router.replace("/")} />;
}
