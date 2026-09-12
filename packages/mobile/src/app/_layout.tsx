import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NotificationListener } from "@/components/app/notification-listener";

/** The root only splits the app in two: the public auth flow and the session-gated app. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <NotificationListener />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(public)" />
        <Stack.Screen name="(protected)" />
      </Stack>
    </SafeAreaProvider>
  );
}
