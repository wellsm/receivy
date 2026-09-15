import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

type RejectReasonSheetProps = {
  visible: boolean;
  busy: boolean;
  onCancel: () => void;
  /** The trimmed reason; empty when the creditor gave none. */
  onConfirm: (reason: string) => void;
};

/** "Não recebi": the charge goes back to pending and the payer reads the optional reason. */
export function RejectReasonSheet({ visible, busy, onCancel, onConfirm }: RejectReasonSheetProps) {
  const colors = useThemeColors();
  const [reason, setReason] = useState("");
  const [wasVisible, setWasVisible] = useState(visible);

  // Every open starts blank: adjusted during render (not an effect) so a cancelled or submitted
  // reason never lingers for the next time, with no extra render in between.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    setReason("");
  }

  if (!visible) {
    return null;
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-scrim px-6">
        <View className="w-full gap-4 rounded-3xl bg-surface p-6">
          <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
            Não recebeu o pagamento?
          </Text>
          <Text className="leading-5 text-muted">A cobrança volta a ficar pendente e a pessoa recebe o motivo.</Text>
          <TextInput
            accessibilityLabel="Motivo opcional"
            value={reason}
            maxLength={500}
            multiline
            onChangeText={setReason}
            placeholder="Motivo (opcional)"
            placeholderTextColor={colors.muted}
            className="min-h-20 rounded-xl border border-outline bg-canvas p-3 text-[16px] tracking-normal text-ink"
          />
          <View className="flex-row gap-3">
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={onCancel} className="min-h-12 flex-1 items-center justify-center rounded-xl border border-outline">
              <Text className="font-bold text-primary">Voltar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Não recebi"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onConfirm(reason.trim())}
              className="min-h-12 flex-1 items-center justify-center rounded-xl bg-danger-solid"
            >
              <Text className="font-bold text-on-danger">Não recebi</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
