import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NotificationListener } from "@/components/notification-listener";
import { ProfileGuard } from "@/components/profile-guard";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <NotificationListener />
      <ProfileGuard />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
