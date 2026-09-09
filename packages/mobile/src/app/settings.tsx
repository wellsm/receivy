import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { ProfileScreen } from "@/components/profile-screen";
import { patchDraft } from "@/financial/draft-store";

type Section = "profile" | "pix";

export default function SettingsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string; returnTo?: string }>();
  const [section, setSection] = useState<Section>(params.section === "pix" ? "pix" : "profile");
  const toBilling = params.returnTo === "new-billing";

  if (section === "pix") {
    return (
      <PixSettingsScreen
        onBack={() => (toBilling ? router.back() : setSection("profile"))}
        onCreated={toBilling ? method => { patchDraft({ pix: method.id }); router.back(); } : undefined}
      />
    );
  }

  return (
    <ProfileScreen
      onOpenPeople={() => router.push("/people")}
      onOpenPix={() => setSection("pix")}
      onOpenFeed={() => router.replace("/")}
      onOpenBillings={() => router.push("/billings")}
      onLoggedOut={() => router.replace("/login")}
    />
  );
}
