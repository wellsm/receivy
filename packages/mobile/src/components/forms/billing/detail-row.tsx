import { Image } from "expo-image";
import { Children, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

const chevronMark = require("../../../../assets/images/auth/chevron.svg");

/** The colour of the icon box: brand for what the person filled, neutral for what came from the default, green for money. */
export type DetailTone = "primary" | "muted" | "success";

const TONES: Record<DetailTone, string> = {
  primary: "bg-primary-soft",
  muted: "bg-surface-muted",
  success: "bg-success-soft",
};

type DetailRowProps = {
  icon: number;
  tone?: DetailTone;
  label: string;
  value: string;
  /** "Editar" jumps back to a step; "open" shows the chevron that lifts a sheet. */
  action?: "edit" | "open";
  /** What sits before the action: the participant avatars of the Divisão row. */
  trailing?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
};

/** One line of the review and edit screens: an icon, a small label, the value and how to change it. */
export function DetailRow({ icon, tone = "primary", label, value, action = "open", trailing, disabled, onPress }: DetailRowProps) {
  const colors = useThemeColors();
  const iconColor = tone === "success" ? colors.success : tone === "muted" ? colors.muted : colors.primaryStrong;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={action === "edit" ? "Volta ao passo" : "Abre os ajustes"}
      accessibilityState={{ disabled: !onPress || disabled }}
      disabled={!onPress || disabled}
      onPress={onPress}
      className="min-h-[68px] flex-row items-center gap-3 px-3.5 py-3"
    >
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Image source={icon} tintColor={iconColor} style={{ width: 18, height: 18 }} />
      </View>
      <View className="flex-1">
        <Text className="font-sans text-[11.5px] text-muted">{label}</Text>
        <Text className="font-sans text-[14.5px] font-bold text-ink" numberOfLines={2}>
          {value}
        </Text>
      </View>
      {trailing}
      {onPress && action === "edit" ? (
        <Text className="font-sans text-[13.5px] font-bold text-primary">Editar</Text>
      ) : onPress ? (
        <Image source={chevronMark} tintColor={colors.muted} style={{ width: 16, height: 16, transform: [{ rotate: "90deg" }] }} />
      ) : null}
    </Pressable>
  );
}

/** Rows stacked in one card, separated by hairlines. */
export function DetailCard({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);

  return (
    <View className="overflow-hidden rounded-[20px] border border-outline bg-surface">
      {rows.map((row, index) => (
        <View key={index} className={index ? "border-t border-outline/60" : ""}>
          {row}
        </View>
      ))}
    </View>
  );
}
