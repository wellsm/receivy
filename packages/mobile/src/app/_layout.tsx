import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NotificationListener } from "@/components/notification-listener";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <NotificationListener />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
