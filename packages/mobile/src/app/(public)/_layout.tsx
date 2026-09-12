import { Stack } from "expo-router";
import { HEADER } from "@/navigation/header";

/**
 * Login draws its own brand hero; every other public screen gets the native header.
 * Onboarding and the OAuth callback are entered by `replace`, so they hide the back button.
 */
export default function PublicLayout() {
  return (
    <Stack screenOptions={HEADER}>
      <Stack.Screen name="login" options={{ title: "Entrar", headerShown: false }} />
      <Stack.Screen name="login/code" options={{ title: "Código" }} />
      <Stack.Screen name="onboarding" options={{ title: "Boas-vindas", headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="auth/callback" options={{ title: "Entrando", headerBackVisible: false }} />
    </Stack>
  );
}
