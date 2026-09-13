import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

type ActionTileProps = {
  label: string;
  /** SVG asset from `require(...)`. */
  icon: number;
  /** `primary` is the main call to action of the row; `danger` a removal. */
  tone?: "neutral" | "primary" | "danger";
  hint?: string;
  disabled?: boolean;
  onPress: () => void;
};

const STYLES = {
  neutral: { circle: "bg-surface-muted", label: "font-medium text-ink" },
  primary: { circle: "bg-primary", label: "font-bold text-primary" },
  danger: { circle: "bg-danger-soft", label: "font-medium text-danger" },
} as const;

/** One square of the quick-actions row under a detail card: icon in a circle, label below. Lay them out in a `flex-row gap-2`. */
export function ActionTile({ label, icon, tone = "neutral", hint, disabled = false, onPress }: ActionTileProps) {
  const style = STYLES[tone];
  const colors = useThemeColors();
  const tint = tone === "primary" ? colors.onPrimary : tone === "danger" ? colors.danger : colors.primaryStrong;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`flex-1 items-center justify-center gap-1.5 rounded-xl border border-outline/30 bg-surface px-1 py-3 ${disabled ? "opacity-50" : ""}`}
    >
      <View className={`h-10 w-10 items-center justify-center rounded-full ${style.circle}`}>
        <Image source={icon} tintColor={tint} style={{ width: 20, height: 20 }} />
      </View>
      <Text className={`text-xs ${style.label}`} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
