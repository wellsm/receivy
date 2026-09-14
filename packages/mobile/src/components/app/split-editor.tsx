import type { SplitMode, UserAvatar } from "@receivy/common";
import { Text, TextInput, View } from "react-native";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { useThemeColors } from "@/theme/colors";

export type SplitRow = {
  key: string;
  name: string;
  value: string;
  amountText: string;
  /** Set on a row the user cannot edit, such as the owner's remainder on a fixed split. */
  readonlyText?: string;
  avatar?: UserAvatar | null;
};

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

const FIELD_SUFFIX: Record<Exclude<SplitMode, "equal">, string> = {
  shares: "cota(s)",
  fixed: "",
  percentage: "%",
};

export function SplitEditor({ mode, rows, hint, disabled, onChange }: SplitEditorProps) {
  const colors = useThemeColors();

  return (
    <View className="gap-2">
      {rows.map((row) => {
        if (row.readonlyText) {
          return (
            <View key={row.key} className="min-h-12 flex-row items-center rounded-xl border border-outline/20 bg-surface-muted/60 px-3 py-2">
              <Text className="flex-1 text-sm font-semibold text-primary-strong">{row.readonlyText}</Text>
            </View>
          );
        }

        return (
          <View key={row.key} className="min-h-12 flex-row items-center gap-2 rounded-xl border border-outline/20 bg-surface-muted/60 px-2.5 py-2">
            <InitialsAvatar name={row.name} avatar={row.avatar} />
            <Text className="flex-1 text-sm font-semibold text-ink" numberOfLines={1}>
              {row.name}
            </Text>
            {mode !== "equal" && (
              <View className="flex-row items-center gap-1">
                <TextInput
                  accessibilityLabel={`${FIELD_LABELS[mode]} de ${row.name}`}
                  editable={!disabled}
                  inputMode={mode === "shares" ? "numeric" : "decimal"}
                  placeholder={mode === "shares" ? "1" : "0"}
                  placeholderTextColor={colors.muted}
                  value={row.value}
                  onChangeText={(value) => onChange(row.key, value)}
                  className={`h-9 rounded-lg border border-outline/40 bg-surface px-2 py-0 text-right text-[13px] font-bold text-primary-strong ${mode === "fixed" ? "w-24" : "w-14"}`}
                />
                {FIELD_SUFFIX[mode] ? <Text className="text-xs text-muted">{FIELD_SUFFIX[mode]}</Text> : null}
              </View>
            )}
            {row.amountText ? <Text className="text-sm font-bold text-primary">{row.amountText}</Text> : null}
          </View>
        );
      })}
      {hint ? <Text className="text-sm font-semibold text-warning">{hint}</Text> : null}
    </View>
  );
}
