import { Image } from "expo-image";
import { Stack } from "expo-router";
import { useHeaderOptions } from "@/navigation/header";
import { ProfileGuard } from "@/components/app/profile-guard";
import { SessionGate } from "@/components/app/session-gate";

const logoMark = require("../../../assets/icons/ios-light.png");

/**
 * Everything below needs a session: the gate restores it before the stack mounts.
 * The tabs sit at the bottom of this stack, so every pushed screen hides the tab bar
 * and gets a native header. The tabs share one header that shows only the logo: the
 * selected tab already names the screen. Its title and actions come from `useTabHeader`.
 */
export default function ProtectedLayout() {
  const header = useHeaderOptions();

  return (
    <SessionGate>
      <ProfileGuard />
      <Stack screenOptions={header}>
        <Stack.Screen
          name="(tabs)"
          options={{
            title: "Feed",
            headerTitleAlign: "center",
            headerTitle: () => <Image source={logoMark} style={{ width: 32, height: 32, borderRadius: 9 }} />,
          }}
        />
        <Stack.Screen name="contacts" options={{ title: "Meus Contatos" }} />
        <Stack.Screen name="contacts/new" options={{ title: "Novo contato" }} />
        <Stack.Screen name="contacts/[id]/edit" options={{ title: "Editar contato" }} />
        <Stack.Screen name="contacts/[id]" options={{ title: "Contato" }} />
        <Stack.Screen name="settings/payment-methods" options={{ title: "Meios de pagamento" }} />
        <Stack.Screen name="settings/payment-methods/new" options={{ title: "Novo meio de pagamento" }} />
        <Stack.Screen name="billings/new" options={{ title: "Nova conta" }} />
        <Stack.Screen name="billings/[id]" options={{ title: "Detalhes da conta" }} />
        <Stack.Screen name="billings/[id]/edit" options={{ title: "Editar conta" }} />
        <Stack.Screen name="charges/[id]" options={{ title: "Cobrança" }} />
        <Stack.Screen name="charges/[id]/proof" options={{ title: "Comprovante" }} />
      </Stack>
    </SessionGate>
  );
}
