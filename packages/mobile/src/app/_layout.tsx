import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NotificationListener } from "@/components/notification-listener";
import { ProfileGuard } from "@/components/profile-guard";

/**
 * Every route declares a `title` even when its own header is hidden: iOS reads
 * the previous screen's title to label the native back button, so the sub-screens
 * below get "← Feed", "← Perfil" or "← Cobranças" for free.
 */
const HEADER = {
  headerBackButtonDisplayMode: "default",
  headerTintColor: "#003828",
  headerStyle: { backgroundColor: "#faf8ff" },
  headerShadowVisible: false,
  headerTitleStyle: { fontWeight: "700", color: "#003828" },
} as const;

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <NotificationListener />
      <ProfileGuard />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, ...HEADER }}>
        <Stack.Screen name="index" options={{ title: "Feed" }} />
        <Stack.Screen name="billings" options={{ title: "Cobranças" }} />
        <Stack.Screen name="settings" options={{ title: "Perfil" }} />
        <Stack.Screen name="login" options={{ title: "Entrar" }} />
        <Stack.Screen name="login/code" options={{ title: "Código" }} />
        <Stack.Screen name="onboarding" options={{ title: "Boas-vindas" }} />
        <Stack.Screen name="auth/callback" options={{ title: "Entrando" }} />
        <Stack.Screen name="people" options={{ title: "Meus Contatos", headerShown: true }} />
        <Stack.Screen name="people/new" options={{ title: "Novo contato", headerShown: true }} />
        <Stack.Screen name="people/[id]/edit" options={{ title: "Editar contato", headerShown: true }} />
        <Stack.Screen name="people/[id]" options={{ title: "Contato", headerShown: true }} />
        <Stack.Screen name="settings/pix" options={{ title: "Minhas Chaves Pix", headerShown: true }} />
        <Stack.Screen name="settings/pix/new" options={{ title: "Nova chave Pix", headerShown: true }} />
        <Stack.Screen name="charges/new" options={{ title: "Nova cobrança", headerShown: true }} />
        <Stack.Screen name="charges/[id]" options={{ title: "Cobrança", headerShown: true }} />
        <Stack.Screen name="charges/created" options={{ title: "Cobrança criada", headerShown: true }} />
      </Stack>
    </SafeAreaProvider>
  );
}
