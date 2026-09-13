import { Modal, Pressable, Text, View } from "react-native";

type ScopeModalProps = {
  title: string;
  subtitle?: string;
  explanation: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** "danger" when the second action cancels charges; "neutral" when it only narrows the scope. */
  secondaryTone?: "danger" | "neutral";
  busy?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onCancel: () => void;
};

const SECONDARY = {
  danger: { button: "bg-danger-solid", label: "text-on-danger" },
  neutral: { button: "border border-outline", label: "text-ink" },
} as const;

/** A choice with two outcomes plus Voltar: Pausar, Encerrar and the scope of a recorrente edit. */
export function ScopeModal({ title, subtitle, explanation, primaryLabel, secondaryLabel, secondaryTone = "neutral", busy = false, onPrimary, onSecondary, onCancel }: ScopeModalProps) {
  const secondary = SECONDARY[secondaryTone];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-scrim px-6">
        <View className="w-full max-w-xs gap-3 rounded-2xl border border-outline/40 bg-surface p-5">
          <Text accessibilityRole="header" className="text-center text-lg font-semibold text-ink">
            {title}
          </Text>
          {subtitle ? <Text className="text-center text-[11px] text-muted">{subtitle}</Text> : null}
          <Text className="text-center text-xs leading-4 text-muted">{explanation}</Text>
          <View className="gap-2 pt-1">
            <Pressable accessibilityRole="button" accessibilityLabel={primaryLabel} disabled={busy} onPress={onPrimary} className="h-11 items-center justify-center rounded-lg bg-primary">
              <Text className="text-xs font-semibold text-on-primary">{primaryLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={secondaryLabel} disabled={busy} onPress={onSecondary} className={`h-11 items-center justify-center rounded-lg ${secondary.button}`}>
              <Text className={`text-xs font-semibold ${secondary.label}`}>{secondaryLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar" disabled={busy} onPress={onCancel} className="h-11 items-center justify-center rounded-lg">
              <Text className="text-xs font-semibold text-muted">Voltar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
