import { Text, View } from "react-native";

export function AuthBrand() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary">
        <Text className="text-xl font-extrabold text-white">R</Text>
      </View>
      <Text className="text-2xl font-extrabold tracking-tight text-primary-strong">Receivy</Text>
    </View>
  );
}
