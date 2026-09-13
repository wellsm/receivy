import "../global.css";

import { ResolvedTheme } from "@receivy/common";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NotificationListener } from "@/components/app/notification-listener";
import { applyThemePreference, readThemePreference } from "@/theme/preference";

// Before the first render: a pinned theme is applied synchronously and never flashes.
applyThemePreference(readThemePreference());

/** The root only splits the app in two: the public auth flow and the session-gated app. */
export default function RootLayout() {
  // Appearance.setColorScheme makes the native color scheme follow the pinned choice, so this is the resolved theme.
  const scheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <NotificationListener />
      <StatusBar style={scheme === ResolvedTheme.Dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(public)" />
        <Stack.Screen name="(protected)" />
      </Stack>
    </SafeAreaProvider>
  );
}
