import { Stack } from "expo-router";
import { useHeaderOptions } from "@/navigation/header";
import { ProfileGuard } from "@/components/app/profile-guard";
import { SessionGate } from "@/components/app/session-gate";

/**
 * Everything below needs a session: the gate restores it before the stack mounts.
 * There is no tab bar (design 8a/8b): the Feed is the root, its header opens Contas and
 * the avatar opens Perfil. Feed and Contas draw their own header; every other screen gets
 * the native one, whose iOS back button reads the previous screen's title.
 */
export default function ProtectedLayout() {
  const header = useHeaderOptions();

  return (
    <SessionGate>
      <ProfileGuard />
      <Stack screenOptions={header}>
        <Stack.Screen name="index" options={{ title: "Feed", headerShown: false }} />
        <Stack.Screen name="billings/index" options={{ title: "Contas", headerShown: false }} />
        <Stack.Screen name="settings/index" options={{ title: "Perfil" }} />
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
