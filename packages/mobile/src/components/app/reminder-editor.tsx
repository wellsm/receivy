import { Image } from "expo-image";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { PUSH_DISCLAIMER, REMINDER_MAX_RULES, type ChannelSet, type ReminderDraft, reminderOffsetLabel, whatsappLockLabel } from "@receivy/common";
import { useThemeColors } from "@/theme/colors";

const trashMark = require("../../../assets/images/auth/trash.svg");
const closeMark = require("../../../assets/images/auth/plus.svg");

type WhatsappGate = { available: boolean; planAllows: boolean };

type ReminderEditorProps = {
  rules: ReminderDraft[];
  onChange: (rules: ReminderDraft[]) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
};

function ChannelChip({
  label,
  checked,
  locked,
  badge = true,
  disabled,
  name,
  onChange,
}: {
  label: string;
  checked: boolean;
  locked: string | null;
  /** The lock badge text renders once per screen, on the automatic rule; a manual-channel chip only dims. */
  badge?: boolean;
  disabled?: boolean;
  name: string;
  onChange: (value: boolean) => void;
}) {
  const off = disabled || locked !== null;
  const on = checked && !locked;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={name}
      accessibilityState={{ checked: on, disabled: off }}
      disabled={off}
      onPress={() => {
        if (off) {
          return;
        }

        onChange(!checked);
      }}
      className={`h-8 flex-row items-center gap-1.5 rounded-full border px-3 ${on ? "border-primary bg-primary-soft" : "border-outline"} ${off ? "opacity-60" : ""}`}
    >
      <Text className={`font-sans text-xs font-semibold ${on ? "text-primary-strong" : "text-muted"}`}>{label}</Text>
      {locked && badge ? <Text className="rounded-md bg-surface-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted">{locked}</Text> : null}
    </Pressable>
  );
}

export function ReminderEditor({ rules, onChange, whatsapp, disabled }: ReminderEditorProps) {
  const colors = useThemeColors();
  const lock = whatsappLockLabel(whatsapp);

  function patch(index: number, next: Partial<ReminderDraft>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  }

  function add() {
    if (rules.length >= REMINDER_MAX_RULES) {
      return;
    }

    onChange([...rules, { offsetDays: "", enabled: true, channels: { email: true, whatsapp: false } }]);
  }

  return (
    <View className="gap-3">
      {rules.map((rule, index) => {
        const offset = Number(rule.offsetDays);
        const human = rule.offsetDays === "" || Number.isNaN(offset) ? "" : reminderOffsetLabel(offset);

        return (
          <View key={index} className="gap-2.5 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
            <View className="flex-row items-center gap-3">
              <TextInput
                accessibilityLabel={`Dias do lembrete ${index + 1}`}
                keyboardType="number-pad"
                editable={!disabled}
                value={rule.offsetDays}
                onChangeText={(value) => patch(index, { offsetDays: value })}
                className="h-9 w-20 rounded-lg border border-outline bg-canvas px-2 font-sans text-sm text-ink"
              />
              <Text className="flex-1 font-sans text-sm text-ink" numberOfLines={1}>
                {human}
              </Text>
              <Switch
                accessibilityLabel={`Lembrete ${index + 1} ativo`}
                disabled={disabled}
                value={rule.enabled}
                onValueChange={(value) => patch(index, { enabled: value })}
                trackColor={{ true: colors.primary }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remover lembrete ${index + 1}`}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => onChange(rules.filter((_, i) => i !== index))}
              >
                <Image source={trashMark} tintColor={colors.muted} style={{ width: 16, height: 16 }} />
              </Pressable>
            </View>

            <View className="flex-row flex-wrap gap-2">
              <ChannelChip
                label="E-mail"
                name={`E-mail no lembrete ${index + 1}`}
                checked={rule.channels.email}
                locked={null}
                disabled={disabled}
                onChange={(value) => patch(index, { channels: { ...rule.channels, email: value } })}
              />
              <ChannelChip
                label="WhatsApp"
                name={`WhatsApp no lembrete ${index + 1}`}
                checked={rule.channels.whatsapp}
                locked={lock}
                disabled={disabled}
                onChange={(value) => patch(index, { channels: { ...rule.channels, whatsapp: value } })}
              />
            </View>
          </View>
        );
      })}

      {rules.length < REMINDER_MAX_RULES ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Adicionar lembrete" accessibilityState={{ disabled }} disabled={disabled} onPress={add} className="min-h-8 flex-row items-center gap-1.5 self-start">
          <Image source={closeMark} tintColor={colors.primary} style={{ width: 13, height: 13 }} />
          <Text className="font-sans text-sm font-semibold text-primary">Adicionar lembrete</Text>
        </Pressable>
      ) : null}

      <Text className="font-sans text-[11px] text-muted">{PUSH_DISCLAIMER}</Text>
    </View>
  );
}

export function ManualChannels({
  value,
  onChange,
  whatsapp,
  disabled,
}: {
  value: ChannelSet;
  onChange: (value: ChannelSet) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
}) {
  const lock = whatsappLockLabel(whatsapp);

  return (
    <View className="gap-2">
      <Text className="font-sans text-[11px] text-muted">É o que sai quando você toca em Lembrar</Text>
      <View className="flex-row flex-wrap gap-2">
        <ChannelChip label="E-mail" name="E-mail no lembrete manual" checked={value.email} locked={null} disabled={disabled} onChange={(email) => onChange({ ...value, email })} />
        <ChannelChip label="WhatsApp" name="WhatsApp no lembrete manual" checked={value.whatsapp} locked={lock} badge={false} disabled={disabled} onChange={(whatsapp) => onChange({ ...value, whatsapp })} />
      </View>
    </View>
  );
}
