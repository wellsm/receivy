import { useRouter } from "expo-router";
import { ProfileScreen } from "@/components/screens/profile-screen";

export default function SettingsRoute() {
  const router = useRouter();

  return (
    <ProfileScreen
      onOpenContacts={() => router.push("/contacts")}
      onOpenPix={() => router.push("/settings/pix")}
      onLoggedOut={() => router.replace("/login")}
    />
  );
}
