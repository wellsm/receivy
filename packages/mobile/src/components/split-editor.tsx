import type { SplitMode } from "@receivy/common";
import { Text, TextInput, View } from "react-native";
import { initialOf } from "./contact-carousel";
import { MUTED_TINT } from "./tab-bar";

export type SplitRow = { key: string; name: string; value: string; amountText: string };

type SplitEditorProps = {
  mode: SplitMode;
  rows: SplitRow[];
  hint: string;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
};

const FIELD_LABELS: Record<Exclude<SplitMode, "equal">, string> = {
  shares: "Cotas",
  fixed: "Valor",
  percentage: "Porcentagem",
};

export function SplitEditor({ mode, rows, hint, disabled, onChange }: SplitEditorProps) {
  return (
    <View className="gap-2">
      {rows.map((row) => (
        <View key={row.key} className="min-h-14 flex-row items-center gap-3 rounded-2xl border border-outline bg-surface px-3 py-2">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft">
            <Text className="font-extrabold text-primary-strong">{initialOf(row.name)}</Text>
          </View>
          <Text className="flex-1 font-semibold text-ink" numberOfLines={1}>
            {row.name}
          </Text>
          {mode !== "equal" && (
            <TextInput
              accessibilityLabel={`${FIELD_LABELS[mode]} de ${row.name}`}
              editable={!disabled}
              inputMode={mode === "shares" ? "numeric" : "decimal"}
              placeholder={mode === "shares" ? "1" : "0"}
              placeholderTextColor={MUTED_TINT}
              value={row.value}
              onChangeText={(value) => onChange(row.key, value)}
              className="min-h-10 w-20 rounded-xl border border-outline bg-canvas px-2 text-right text-ink"
            />
          )}
          <Text className="text-sm font-bold text-primary-strong">{row.amountText}</Text>
        </View>
      ))}
      {hint ? <Text className="text-sm font-semibold text-amber-700">{hint}</Text> : null}
    </View>
  );
}
