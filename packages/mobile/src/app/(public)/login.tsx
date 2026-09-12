import { useRouter } from "expo-router";
import { setPendingLoginEmail } from "@/auth/pending-login";
import { LoginScreen } from "@/components/screens/login-screen";

export default function LoginRoute() {
  const router = useRouter();
  return (
    <LoginScreen
      onCodeRequested={(email) => {
        setPendingLoginEmail(email);
        router.push("/login/code");
      }}
    />
  );
}
