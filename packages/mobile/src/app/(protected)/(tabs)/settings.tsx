import { useRouter } from "expo-router";
import { ProfileScreen } from "@/components/screens/profile-screen";

export default function SettingsRoute() {
  const router = useRouter();

  return (
    <ProfileScreen
      onOpenContacts={() => router.push("/contacts")}
      onOpenPaymentMethods={() => router.push("/settings/payment-methods")}
      onLoggedOut={() => router.replace("/login")}
    />
  );
}
