import { Redirect, useRouter } from "expo-router";
import { clearPendingLoginEmail, getPendingLoginEmail } from "@/auth/pending-login";
import { CodeScreen } from "@/components/code-screen";

export default function CodeRoute() {
  const router = useRouter();
  const email = getPendingLoginEmail();
  if (!email) {
    return <Redirect href="/login" />;
  }
  return (
    <CodeScreen
      email={email}
      onAuthenticated={() => {
        clearPendingLoginEmail();
        router.replace("/");
      }}
    />
  );
}
