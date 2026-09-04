import { designTokens } from "@receivy/common";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const navigation = [
  ["≡", "Timeline"],
  ["↻", "Recorrências"],
  ["◉", "Contatos"],
  ["⚙", "Ajustes"],
] as const;

type BalanceCardProps = ViewProps & {
  direction: "in" | "out";
  label: string;
  helper: string;
};

function BalanceCard({ direction, label, helper, ...props }: BalanceCardProps) {
  const incoming = direction === "in";

  return (
    <View
      {...props}
      className={`gap-2 px-6 py-6 ${incoming ? "bg-primary-soft/35" : "bg-surface"}`}
    >
      <View className="flex-row items-center gap-3">
        <Text className="text-xl text-primary">{incoming ? "↙" : "↗"}</Text>
        <Text className="text-sm font-bold text-ink">{label}</Text>
      </View>
      <Text
        className="pl-9 text-3xl font-extrabold tracking-tight text-ink"
        style={{ fontVariant: [designTokens.typography.numericVariant] }}
      >
        R$ 0,00
      </Text>
      <Text className="pl-9 text-xs leading-5 text-muted">{helper}</Text>
    </View>
  );
}

export function HomeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 136 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-5 pb-8 pt-4">
          <View className="mb-10 flex-row items-center gap-2">
            <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary">
              <Text className="text-xl font-extrabold text-white">R</Text>
            </View>
            <Text className="text-xl font-extrabold tracking-tight text-primary-strong">
              Receivy
            </Text>
          </View>

          <Text className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">
            Sua visão de hoje
          </Text>
          <Text className="text-4xl font-extrabold leading-10 tracking-tight text-primary-strong">
            O que entra. O que sai. No mesmo lugar.
          </Text>
          <Text className="mt-4 text-base leading-6 text-muted">
            Cobranças criadas por você e valores vinculados ao seu e-mail aparecem
            juntos, sempre com a direção identificada.
          </Text>

          <View className="mt-8 overflow-hidden rounded-3xl border border-outline/60 bg-surface">
            <BalanceCard
              direction="in"
              label="A receber"
              helper="Nenhuma cobrança pendente"
            />
            <View className="h-px bg-outline/45" />
            <BalanceCard
              direction="out"
              label="A pagar"
              helper="Nenhum valor vinculado"
            />
          </View>

          <View className="mt-10 flex-row gap-5">
            <View className="items-center">
              <View className="h-3 w-3 rounded-full border-2 border-canvas bg-primary" />
              <View className="w-px flex-1 bg-outline" />
            </View>
            <View className="flex-1 pb-10">
              <Text className="mb-5 text-3xl text-primary">▦</Text>
              <Text className="text-sm font-bold text-primary">Timeline</Text>
              <Text className="mt-2 text-3xl font-semibold leading-9 tracking-tight text-primary-strong">
                Sua timeline começa aqui
              </Text>
              <Text className="mt-3 text-sm leading-6 text-muted">
                Crie uma cobrança ou entre com o e-mail em que recebeu uma. Os
                próximos vencimentos serão organizados por data.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <Pressable
        accessibilityLabel="Nova cobrança"
        accessibilityRole="button"
        className="absolute bottom-24 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-primary"
      >
        <Text className="text-3xl font-light text-white">+</Text>
      </Pressable>

      <View className="absolute bottom-0 left-0 right-0 flex-row border-t border-outline/45 bg-surface px-1 pb-5 pt-2">
        {navigation.map(([icon, label], index) => (
          <View
            className={`flex-1 items-center gap-1 rounded-xl py-2 ${index === 0 ? "bg-primary-soft/55" : ""}`}
            key={label}
          >
            <Text className={index === 0 ? "text-lg text-primary" : "text-lg text-muted"}>
              {icon}
            </Text>
            <Text
              className={
                index === 0
                  ? "text-[10px] font-bold text-primary"
                  : "text-[10px] font-semibold text-muted"
              }
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}
