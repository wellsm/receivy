import { Redirect, useRouter } from "expo-router";
import { clearPendingLoginEmail, getPendingLoginEmail, getPendingLoginSentAt } from "@/auth/pending-login";
import { CodeScreen } from "@/components/code-screen";

export default function CodeRoute() {
  const router = useRouter();
  const email = getPendingLoginEmail();
  const sentAt = getPendingLoginSentAt();

  if (!email) {
    return <Redirect href="/login" />;
  }

  return (
    <CodeScreen
      email={email}
      sentAt={sentAt ?? undefined}
      onBack={() => router.replace("/login")}
      onAuthenticated={() => {
        clearPendingLoginEmail();
        router.replace("/");
      }}
    />
  );
}
