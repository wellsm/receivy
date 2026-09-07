import { AppShell } from "@/components/app-shell";
import { TimelineScreen } from "@/components/timeline-screen";
import { AccountOnboarding } from "@/components/account-onboarding";

export default function TimelinePage() {
  return (
    <AppShell><AccountOnboarding><TimelineScreen /></AccountOnboarding></AppShell>
  );
}
