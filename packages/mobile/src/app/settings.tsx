import { useState } from "react";
import { useRouter } from "expo-router";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { ProfileScreen } from "@/components/profile-screen";

type Section = "profile" | "pix";

export default function SettingsRoute() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("profile");

  if (section === "pix") {
    return <PixSettingsScreen onBack={() => setSection("profile")} />;
  }

  return (
    <ProfileScreen
      onOpenPeople={() => router.push("/people")}
      onOpenPix={() => setSection("pix")}
      onOpenFeed={() => router.replace("/")}
      onOpenBillings={() => router.push("/billings")}
      onOpenNotifications={() => {}}
      onLoggedOut={() => router.replace("/login")}
    />
  );
}
