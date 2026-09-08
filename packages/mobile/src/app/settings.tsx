import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AccountSettings } from "@/components/account-settings";
import { NotificationSettings } from "@/components/notification-settings";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { SafeAreaView } from "@/components/safe-area-view";

type Section = "profile" | "pix";

export default function SettingsRoute() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("profile");

  if (section === "pix") {
    return <PixSettingsScreen onBack={() => setSection("profile")} />;
  }

  return (
    <View className="flex-1 bg-canvas">
      <SafeAreaView edges={["top"]}>
        <Pressable accessibilityRole="button" onPress={() => router.replace("/")} className="min-h-12 justify-center px-5">
          <Text className="font-bold text-primary">← Feed</Text>
        </Pressable>
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-3 px-5 pb-12">
        <Text className="text-3xl font-extrabold text-primary-strong">Perfil</Text>
        <View className="gap-2 rounded-2xl border border-outline/40 bg-surface p-4">
          <Text className="text-lg font-bold text-ink">Contatos</Text>
          <Text className="text-sm leading-5 text-muted">Pessoas que você cobra ou que cobram você.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Gerenciar contatos" onPress={() => router.push("/people")} className="min-h-12 justify-center">
            <Text className="font-bold text-primary">Gerenciar contatos →</Text>
          </Pressable>
        </View>
        <View className="gap-2 rounded-2xl border border-outline/40 bg-surface p-4">
          <Text className="text-lg font-bold text-ink">Chaves Pix</Text>
          <Text className="text-sm leading-5 text-muted">Chaves usadas nos links das suas cobranças.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Gerenciar chaves Pix" onPress={() => setSection("pix")} className="min-h-12 justify-center">
            <Text className="font-bold text-primary">Gerenciar chaves Pix →</Text>
          </Pressable>
        </View>
        <AccountSettings />
        <NotificationSettings />
      </ScrollView>
    </View>
  );
}
