import { useRouter } from "expo-router";
import { PixSettingsScreen } from "@/components/pix-settings-screen";
import { NotificationSettings } from "@/components/notification-settings";
import { AccountSettings } from "@/components/account-settings";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
export default function SettingsRoute() {
  const router = useRouter(); const [notifications, setNotifications] = useState(true);
  return <View className="flex-1 bg-canvas"><SafeAreaView edges={["top"]}><Pressable accessibilityRole="button" onPress={() => router.replace("/")} className="min-h-12 justify-center px-5"><Text className="font-bold text-primary">← Timeline</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setNotifications(value => !value)} className="min-h-12 justify-center px-5"><Text className="font-bold text-primary">{notifications ? "Chaves Pix" : "Conta e notificações"}</Text></Pressable></SafeAreaView>
    {notifications ? <ScrollView contentContainerClassName="px-5 pb-12"><AccountSettings /><NotificationSettings /></ScrollView> : <PixSettingsScreen onBack={() => router.replace("/")} />}</View>;
}
