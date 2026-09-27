import { Stack } from "expo-router";
import { useHeaderOptions } from "@/navigation/header";
import { ProfileGuard } from "@/components/app/profile-guard";
import { SessionGate } from "@/components/app/session-gate";

/**
 * Everything below needs a session: the gate restores it before the stack mounts.
 * The tabs sit at the bottom of this stack, so every pushed screen hides the tab bar
 * and gets a native header with the back button. The tabs themselves show no header:
 * the selected tab already names the screen. Their title still comes from `useTabHeader`,
 * because iOS labels the back button of a pushed screen with it.
 */
export default function ProtectedLayout() {
  const header = useHeaderOptions();

  return (
    <SessionGate>
      <ProfileGuard />
      <Stack screenOptions={header}>
        <Stack.Screen name="(tabs)" options={{ title: "Feed", headerShown: false }} />
        <Stack.Screen name="contacts" options={{ title: "Meus Contatos" }} />
        <Stack.Screen name="contacts/new" options={{ title: "Novo contato" }} />
        <Stack.Screen name="contacts/[id]/edit" options={{ title: "Editar contato" }} />
        <Stack.Screen name="contacts/[id]" options={{ title: "Contato" }} />
        <Stack.Screen name="settings/payment-methods" options={{ title: "Meios de pagamento" }} />
        <Stack.Screen name="settings/reminders" options={{ title: "Lembretes" }} />
        <Stack.Screen name="settings/whatsapp" options={{ title: "WhatsApp" }} />
        <Stack.Screen name="settings/payment-methods/new" options={{ title: "Novo meio de pagamento" }} />
        <Stack.Screen name="billings/new" options={{ title: "Nova conta", headerShown: false }} />
        <Stack.Screen name="billings/[id]" options={{ title: "Detalhes da conta" }} />
        <Stack.Screen name="billings/[id]/edit" options={{ title: "Editar conta", headerShown: false }} />
        <Stack.Screen name="charges/[id]" options={{ title: "Cobrança" }} />
        <Stack.Screen name="charges/[id]/proof" options={{ title: "Comprovante" }} />
      </Stack>
    </SessionGate>
  );
}
