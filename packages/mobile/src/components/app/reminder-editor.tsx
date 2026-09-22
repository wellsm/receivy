import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import {
  CHANNEL_SET_OPTIONS,
  channelSetLabel,
  PUSH_DISCLAIMER,
  REMINDER_MAX_OFFSET,
  REMINDER_MAX_RULES,
  REMINDER_OFFSET_MODE_LABELS,
  type ChannelSet,
  type ReminderDraft,
  reminderOffsetDays,
  reminderOffsetLabel,
  ReminderOffsetMode,
  reminderOffsetMode,
  reminderPreviewLine,
  shortDayMonth,
  whatsappLockLabel,
} from "@receivy/common";
import { useThemeColors } from "@/theme/colors";

const trashMark = require("../../../assets/images/auth/trash.svg");
const plusMark = require("../../../assets/images/auth/plus.svg");

type WhatsappGate = { available: boolean; planAllows: boolean };

type ReminderEditorProps = {
  rules: ReminderDraft[];
  onChange: (rules: ReminderDraft[]) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
};

/** Which panel a card has open: the days picker, the channel picker, or neither. */
type OpenPanel = { index: number; panel: "days" | "channels" } | null;

const MODES = [ReminderOffsetMode.Before, ReminderOffsetMode.Due, ReminderOffsetMode.After];

const PILL = "h-8 flex-row items-center gap-1.5 rounded-[10px] border px-2.5";
const PILL_TEXT = "font-sans text-[13px] font-bold";

function offsetOf(rule: ReminderDraft): number {
  const parsed = Number(rule.offsetDays);

  return rule.offsetDays === "" || Number.isNaN(parsed) ? 0 : parsed;
}

function ChannelOption({
  channels,
  current,
  locked,
  name,
  disabled,
  onSelect,
}: {
  channels: ChannelSet;
  current: ChannelSet;
  locked: string | null;
  name: string;
  disabled?: boolean;
  onSelect: (channels: ChannelSet) => void;
}) {
  const label = channelSetLabel(channels);
  const active = channels.email === current.email && channels.whatsapp === current.whatsapp;
  const off = disabled || locked !== null;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} ${name}`}
      accessibilityState={{ checked: active, disabled: off }}
      disabled={off}
      onPress={() => onSelect({ ...channels })}
      className={`h-10 flex-row items-center gap-2 rounded-xl border px-3 ${active ? "border-primary bg-primary-soft" : "border-outline"} ${off ? "opacity-60" : ""}`}
    >
      <Text className={`font-sans text-[13px] font-semibold ${active ? "text-primary-strong" : "text-ink"}`}>{label}</Text>
      {locked ? <Text className="rounded-md bg-surface-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted">{locked}</Text> : null}
    </Pressable>
  );
}

export function ReminderEditor({ rules, onChange, whatsapp, disabled }: ReminderEditorProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState<OpenPanel>(null);
  const lock = whatsappLockLabel(whatsapp);

  function patch(index: number, next: Partial<ReminderDraft>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  }

  function toggle(index: number, panel: "days" | "channels") {
    setOpen(open?.index === index && open.panel === panel ? null : { index, panel });
  }

  function add() {
    if (rules.length >= REMINDER_MAX_RULES) {
      return;
    }

    const taken = new Set(rules.map((rule) => offsetOf(rule)));
    const free = [0, -3, 2, -1, 1, -7, 7, -14, 14].find((day) => !taken.has(day)) ?? 0;

    onChange([...rules, { offsetDays: String(free), enabled: true, channels: { email: true, whatsapp: false } }]);
    setOpen({ index: rules.length, panel: "days" });
  }

  return (
    <View className="gap-3">
      {rules.map((rule, index) => {
        const offset = offsetOf(rule);
        const mode = reminderOffsetMode(offset);
        const days = Math.abs(offset);
        const position = index + 1;
        const opened = open?.index === index ? open.panel : null;

        function setOffset(next: number) {
          patch(index, { offsetDays: String(next) });
        }

        return (
          <View key={index} className={`rounded-[20px] border bg-surface p-4 ${opened ? "border-primary" : "border-outline"}`}>
            <View className="flex-row flex-wrap items-center gap-[7px]">
              <Text className="font-sans text-[14.5px] text-muted">Avisar</Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Quando avisar no lembrete ${position}`}
                accessibilityState={{ expanded: opened === "days", disabled }}
                disabled={disabled}
                onPress={() => toggle(index, "days")}
                className={`${PILL} ${opened === "days" ? "border-primary bg-primary" : "border-primary/40 bg-primary-soft"}`}
              >
                <Text className={`${PILL_TEXT} ${opened === "days" ? "text-primary-foreground" : "text-primary-strong"}`}>{reminderOffsetLabel(offset)}</Text>
              </Pressable>

              <Text className="font-sans text-[14.5px] text-muted">por</Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Canais do lembrete ${position}`}
                accessibilityState={{ expanded: opened === "channels", disabled }}
                disabled={disabled}
                onPress={() => toggle(index, "channels")}
                className={`${PILL} ${opened === "channels" ? "border-primary bg-primary" : "border-outline bg-surface-muted"}`}
              >
                <Text className={`${PILL_TEXT} ${opened === "channels" ? "text-primary-foreground" : "text-ink"}`}>{channelSetLabel(rule.channels)}</Text>
              </Pressable>

              <View className="ml-auto flex-row items-center gap-3">
                <Switch
                  accessibilityLabel={`Lembrete ${position} ativo`}
                  disabled={disabled}
                  value={rule.enabled}
                  onValueChange={(value) => patch(index, { enabled: value })}
                  trackColor={{ true: colors.primary }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remover lembrete ${position}`}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => {
                    setOpen(null);
                    onChange(rules.filter((_, i) => i !== index));
                  }}
                >
                  <Image source={trashMark} tintColor={colors.muted} style={{ width: 16, height: 16 }} />
                </Pressable>
              </View>
            </View>

            {opened === "days" ? (
              <View className="mt-3.5 border-t border-outline/50 pt-3.5">
                <View className="flex-row gap-1.5 rounded-xl bg-surface-muted p-[3px]">
                  {MODES.map((option) => {
                    const active = option === mode;

                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="radio"
                        accessibilityLabel={`${REMINDER_OFFSET_MODE_LABELS[option]} no lembrete ${position}`}
                        accessibilityState={{ checked: active, disabled }}
                        disabled={disabled}
                        onPress={() => setOffset(reminderOffsetDays(option, days))}
                        className={`h-[34px] flex-1 items-center justify-center rounded-[9px] ${active ? "bg-surface" : ""}`}
                      >
                        <Text className={`font-sans text-xs font-semibold ${active ? "text-ink" : "text-muted"}`}>{REMINDER_OFFSET_MODE_LABELS[option]}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View className={`mt-2.5 flex-row items-center gap-2.5 ${mode === ReminderOffsetMode.Due ? "opacity-40" : ""}`}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Menos um dia no lembrete ${position}`}
                    accessibilityState={{ disabled: disabled || mode === ReminderOffsetMode.Due || days <= 1 }}
                    disabled={disabled || mode === ReminderOffsetMode.Due || days <= 1}
                    onPress={() => setOffset(reminderOffsetDays(mode, days - 1))}
                    className="h-9 w-9 items-center justify-center rounded-[11px] border border-outline"
                  >
                    <Text className="font-display text-base font-bold text-muted">–</Text>
                  </Pressable>

                  <View className="flex-1 items-center">
                    <Text className="font-display text-lg font-bold text-ink">{mode === ReminderOffsetMode.Due ? 0 : days}</Text>
                    <Text className="font-sans text-[10.5px] text-muted">dias</Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Mais um dia no lembrete ${position}`}
                    accessibilityState={{ disabled: disabled || mode === ReminderOffsetMode.Due || days >= REMINDER_MAX_OFFSET }}
                    disabled={disabled || mode === ReminderOffsetMode.Due || days >= REMINDER_MAX_OFFSET}
                    onPress={() => setOffset(reminderOffsetDays(mode, days + 1))}
                    className="h-9 w-9 items-center justify-center rounded-[11px] border border-outline"
                  >
                    <Text className="font-display text-base font-bold text-muted">+</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {opened === "channels" ? (
              <View className="mt-3.5 gap-1.5 border-t border-outline/50 pt-3.5">
                {CHANNEL_SET_OPTIONS.map((option) => (
                  <ChannelOption
                    key={channelSetLabel(option)}
                    channels={option}
                    current={rule.channels}
                    locked={option.whatsapp ? lock : null}
                    name={`no lembrete ${position}`}
                    disabled={disabled}
                    onSelect={(channels) => {
                      patch(index, { channels });
                      setOpen(null);
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      <View className="flex-row items-center justify-between">
        {rules.length < REMINDER_MAX_RULES ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="E também avisar"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={add}
            className="min-h-8 flex-row items-center gap-1.5"
          >
            <Image source={plusMark} tintColor={colors.primary} style={{ width: 13, height: 13 }} />
            <Text className="font-sans text-sm font-semibold text-primary">E também avisar…</Text>
          </Pressable>
        ) : (
          <Text className="font-sans text-sm text-muted">Limite de lembretes atingido</Text>
        )}

        <Text className="font-sans text-[11px] font-semibold text-muted">
          {rules.length} de {REMINDER_MAX_RULES}
        </Text>
      </View>

      <Text className="font-sans text-[11px] text-muted">{PUSH_DISCLAIMER}</Text>
    </View>
  );
}

/** The preview block under the cards: the dates the rules land on, against a real or example due date. */
export function ReminderPreview({ rules, dueDate }: { rules: ReminderDraft[]; dueDate: string }) {
  const parsed = rules.map((rule) => ({ ...rule, offsetDays: offsetOf(rule) }));

  return (
    <View className="gap-1.5 rounded-2xl border border-outline bg-surface-muted px-4 py-3">
      <Text className="font-sans text-[10px] font-bold tracking-[0.08em] text-muted">PRÉVIA · VENCIMENTO {shortDayMonth(dueDate)}</Text>
      <Text className="font-sans text-[12.5px] text-ink">{reminderPreviewLine(parsed, dueDate)}</Text>
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
  const [open, setOpen] = useState(false);
  const lock = whatsappLockLabel(whatsapp);

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center gap-[7px]">
        <Text className="font-sans text-[14.5px] text-muted">Quando eu toco em Lembrar</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Canais do lembrete manual"
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled}
          onPress={() => setOpen(!open)}
          className={`${PILL} ${open ? "border-primary bg-primary" : "border-outline bg-surface-muted"}`}
        >
          <Text className={`${PILL_TEXT} ${open ? "text-primary-foreground" : "text-ink"}`}>{channelSetLabel(value)}</Text>
        </Pressable>
      </View>

      {open ? (
        <View className="gap-1.5">
          {CHANNEL_SET_OPTIONS.map((option) => (
            <ChannelOption
              key={channelSetLabel(option)}
              channels={option}
              current={value}
              locked={option.whatsapp ? lock : null}
              name="no lembrete manual"
              disabled={disabled}
              onSelect={(channels) => {
                onChange(channels);
                setOpen(false);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
