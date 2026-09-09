import { useRouter } from "expo-router";
import { ProfileScreen } from "@/components/profile-screen";

export default function SettingsRoute() {
  const router = useRouter();

  return (
    <ProfileScreen
      onOpenPeople={() => router.push("/people")}
      onOpenPix={() => router.push("/settings/pix")}
      onOpenFeed={() => router.replace("/")}
      onOpenBillings={() => router.push("/billings")}
      onLoggedOut={() => router.replace("/login")}
    />
  );
}
