import { Image } from "expo-image";
import { Modal, Pressable, Text, View } from "react-native";
import { type ChargeSummary, feedDayLabel, formatMoney, type ManualReminderResult, NOBODY_REACHABLE, PREVIEW_UNAVAILABLE, remindLines } from "@receivy/common";
import { useThemeColors } from "@/theme/colors";

const copyMark = require("../../../assets/images/auth/copy.svg");

type RemindSheetProps = {
  charge: ChargeSummary;
  today: string;
  /** `null` while the preview has not answered yet. */
  preview: ManualReminderResult | null;
  loading: boolean;
  onSend: () => void;
  onClose: () => void;
};

const LOADING_COPY = "Conferindo por onde avisar…";

function dueText(charge: ChargeSummary, today: string): string {
  if (charge.dueDate < today) {
    return "atrasado";
  }

  return `vence ${feedDayLabel(charge.dueDate, today).toLowerCase()}`;
}

/** Confirms a reminder before it goes out; the preview names which channels will actually reach the person. */
export function RemindSheet({ charge, today, preview, loading, onSend, onClose }: RemindSheetProps) {
  const colors = useThemeColors();
  const firstName = charge.counterpartName.trim().split(/\s+/)[0] ?? charge.counterpartName;
  const amount = formatMoney(charge.amount);
  const due = dueText(charge, today);
  const nobody = preview !== null && preview.channels.length === 0;
  const unavailable = !loading && preview === null;
  const { going, dropped } = preview ? remindLines(preview) : { going: "", dropped: [] };
  const disabled = loading || nobody;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar lembrete" onPress={onClose} className="flex-1 bg-scrim" />

      <View className="gap-4 rounded-t-[28px] bg-surface px-5 pb-8 pt-5">
        <View className="h-1 w-11 self-center rounded-full bg-outline" />

        <View className="gap-1">
          <Text accessibilityRole="header" className="font-display text-[21px] font-bold text-ink">
            Lembrar {firstName}
          </Text>
          <Text className="font-sans text-[13px] leading-5 text-muted">
            {charge.description} · {amount} · {due}.
          </Text>
          {loading ? (
            <Text className="font-sans text-[13px] leading-5 text-muted">{LOADING_COPY}</Text>
          ) : unavailable ? (
            <Text className="font-sans text-[13px] leading-5 text-muted">{PREVIEW_UNAVAILABLE}</Text>
          ) : nobody ? (
            <Text className="font-sans text-[13px] leading-5 text-muted">{NOBODY_REACHABLE}</Text>
          ) : (
            <Text className="font-sans text-[13px] leading-5 text-muted">
              <Text>{`Vai por: ${going}`}</Text>
              <Text>{". Um lembrete a cada 24 horas."}</Text>
            </Text>
          )}
        </View>

        <View className="gap-2 rounded-2xl border border-outline/60 bg-canvas p-3.5">
          <Text className="font-sans text-[10.5px] font-semibold tracking-[0.84px] text-muted">PRÉVIA</Text>
          <Text className="font-sans text-[13.5px] font-semibold text-ink">Lembrete: {charge.description}</Text>
          <Text className="font-sans text-[12.5px] leading-5 text-muted">
            {amount} {due}. Abra para copiar a chave Pix e enviar o comprovante.
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <Image source={copyMark} tintColor={colors.primary} style={{ width: 14, height: 14 }} />
            <Text className="font-sans text-xs font-semibold text-primary">inclui link público e chave Pix</Text>
          </View>
        </View>

        {dropped.length > 0 ? (
          <View className="gap-0.5">
            {dropped.map((line) => (
              <Text key={line} className="text-[12px] text-muted">
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View className="flex-row gap-2.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancelar"
            onPress={onClose}
            className="h-[52px] w-[110px] items-center justify-center rounded-2xl border border-outline"
          >
            <Text className="font-sans text-sm font-bold text-muted">Cancelar</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar lembrete"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onSend}
            className={`h-[52px] flex-1 items-center justify-center rounded-2xl bg-primary ${disabled ? "opacity-50" : ""}`}
          >
            <Text className="font-sans text-[15px] font-bold text-on-primary">Enviar lembrete</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
