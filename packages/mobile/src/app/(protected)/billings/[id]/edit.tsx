import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { BillingDetail } from "@receivy/common";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";
import { financialClient } from "@/financial/client";
import { useThemeColors } from "@/theme/colors";

/** The same form as the creation route, seeded with the billing; the API decides what is still editable. */
export default function EditBillingRoute() {
  const router = useRouter();
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [billing, setBilling] = useState<BillingDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;

    financialClient
      .billing(id)
      .then((detail) => live && setBilling(detail))
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : "Não foi possível carregar a conta."));

    return () => {
      live = false;
    };
  }, [id]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-canvas px-5">
        <Text accessibilityRole="alert" className="text-center text-danger">
          {error}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()} className="min-h-12 justify-center">
          <Text className="font-bold text-primary">Voltar</Text>
        </Pressable>
      </View>
    );
  }

  if (!billing) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator accessibilityLabel="Carregando conta" color={colors.primaryStrong} size="large" />
      </View>
    );
  }

  return <BillingFormScreen billing={billing} onSaved={() => router.back()} />;
}
