import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { ACTIVE_TINT } from "@/theme/colors";

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
  neutral: { circle: "bg-surface-muted", tint: ACTIVE_TINT, label: "font-medium text-ink" },
  primary: { circle: "bg-primary", tint: "#FFFFFF", label: "font-bold text-primary" },
  danger: { circle: "bg-red-100", tint: "#b91c1c", label: "font-medium text-red-700" },
} as const;

/** One square of the quick-actions row under a detail card: icon in a circle, label below. Lay them out in a `flex-row gap-2`. */
export function ActionTile({ label, icon, tone = "neutral", hint, disabled = false, onPress }: ActionTileProps) {
  const style = STYLES[tone];

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
        <Image source={icon} tintColor={style.tint} style={{ width: 20, height: 20 }} />
      </View>
      <Text className={`text-xs ${style.label}`} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
