import { Link } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";

export default function OauthCallback() {
  return <View className="flex-1 items-center justify-center gap-4 bg-canvas p-6">
    <ActivityIndicator />
    <Text>Concluindo login…</Text>
    <Link href="/login">Se o login não concluir, tente novamente</Link>
  </View>;
}
