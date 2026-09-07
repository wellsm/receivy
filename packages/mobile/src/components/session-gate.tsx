import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { AccountSettings } from "./account-settings";
import { authClient } from "@/auth/client";
import { HomeScreen } from "./home-screen";

export function SessionGate() {
  const router = useRouter();
  const [ready, setReady] = useState(() => Boolean(authClient.getAccessToken()));
  const [needsName, setNeedsName] = useState(false);
  useEffect(() => { if (!ready) return; let active = true; void authClient.authenticatedFetch("auth/me").then(async response => { if (response.ok && active) setNeedsName(!(await response.json()).user.name); }).catch(() => {}); return () => { active = false; }; }, [ready]);

  useEffect(() => {
    if (ready) {
      return;
    }
    let active = true;
    void authClient.refresh().then(
      () => active && setReady(true),
      () => active && router.replace("/login"),
    );
    return () => {
      active = false;
    };
  }, [ready, router]);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#0B513D" size="large" />
      </View>
    );
  }

  if (needsName) return <ScrollView contentContainerClassName="px-5 py-12"><AccountSettings onboarding onComplete={() => setNeedsName(false)} /></ScrollView>;
  return <HomeScreen onOpenRecurrences={() => router.push("/recurrences")} onOpenPeople={() => router.push("/people")} onCreateCharge={() => router.push("/charges/new")} onOpenCharge={id => router.push({ pathname: "/charges/[id]", params: { id } })} onOpenSettings={() => router.push("/settings")} />;
}
