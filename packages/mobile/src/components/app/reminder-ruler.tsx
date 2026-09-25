import { Image } from "expo-image";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Switch, Text, View, type LayoutChangeEvent } from "react-native";
import {
  REMINDER_MAX_OFFSET,
  REMINDER_MAX_RULES,
  type ChannelSet,
  type ReminderDraft,
  reminderOffsetLabel,
  shiftDays,
  shortDayMonth,
  whatsappLockLabel,
} from "@receivy/common";
import { useThemeColors } from "@/theme/colors";
import { visibleChannels, whatsappEnabled } from "@/whatsapp-flag";

const trashMark = require("../../../assets/images/auth/trash.svg");
const chevronMark = require("../../../assets/images/auth/chevron.svg");

type WhatsappGate = { available: boolean; planAllows: boolean };

type ReminderRulerProps = {
  rules: ReminderDraft[];
  onChange: (rules: ReminderDraft[]) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
};

/** Where a free slot is offered on the ruler, in the order the picker fills them. */
const SUGGESTED = [-14, -7, -3, -1, 1, 2, 3, 7, 14];

const HINT = "Toque num ponto cinza para criar, arraste para mover, toque no índigo para editar.";

const PREVIEW_NOTE = "Sempre às 6h no fuso da conta. Push sai junto sempre que a pessoa tiver o app.";

/** One configurable channel per rule: e-mail or WhatsApp, never both. The stored shape stays a ChannelSet. */
const SINGLE_CHANNELS: ChannelSet[] = [
  { email: true, whatsapp: false },
  { email: false, whatsapp: true }
];

/** Collapses a stored set that carries both channels, or none, so exactly one option reads as picked. */
function single(channels: ChannelSet): ChannelSet {
  if (channels.whatsapp && !channels.email) {
    return { email: false, whatsapp: true };
  }

  return { email: true, whatsapp: false };
}

function singleChannelLabel(channels: ChannelSet): string {
  return channels.whatsapp ? "whatsapp" : "email";
}

function offsetOf(rule: ReminderDraft): number {
  const parsed = Number(rule.offsetDays);

  return rule.offsetDays === "" || Number.isNaN(parsed) ? 0 : parsed;
}

/** The ruler spans ±14 days, with the due date in the middle. */
function percentOf(offset: number): number {
  return ((offset + REMINDER_MAX_OFFSET) / (REMINDER_MAX_OFFSET * 2)) * 100;
}

function offsetAt(ratio: number): number {
  const raw = Math.round(ratio * REMINDER_MAX_OFFSET * 2) - REMINDER_MAX_OFFSET;

  return Math.min(REMINDER_MAX_OFFSET, Math.max(-REMINDER_MAX_OFFSET, raw));
}

/** What a row says under its title: the configured channels plus the implicit push, or that it is paused. */
function rowSubtitle(rule: ReminderDraft): string {
  if (!rule.enabled) {
    return "pausado";
  }

  return `${singleChannelLabel(visibleChannels(single(rule.channels)))} · push`;
}

export function ReminderRuler({ rules, onChange, whatsapp, disabled }: ReminderRulerProps) {
  const colors = useThemeColors();
  const width = useRef(0);
  const [editing, setEditing] = useState<number | null>(null);
  const lock = whatsappLockLabel(whatsapp);

  const ordered = rules.map((rule, index) => ({ rule, index, offset: offsetOf(rule) })).sort((a, b) => a.offset - b.offset);
  const taken = new Set(ordered.map((item) => item.offset));
  const free = SUGGESTED.filter((day) => !taken.has(day));

  function patch(index: number, next: Partial<ReminderDraft>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  }

  function moveTo(index: number, offset: number) {
    if (taken.has(offset) && offsetOf(rules[index]!) !== offset) {
      return;
    }

    patch(index, { offsetDays: String(offset) });
  }

  function create(offset: number) {
    if (rules.length >= REMINDER_MAX_RULES || taken.has(offset)) {
      return;
    }

    onChange([...rules, { offsetDays: String(offset), enabled: true, channels: { email: true, whatsapp: false } }]);
  }

  function measure(event: LayoutChangeEvent) {
    width.current = event.nativeEvent.layout.width;
  }

  return (
    <View className="gap-3.5">
      <View className="rounded-[20px] border border-outline bg-surface p-4 pb-[18px]">
        <View className="flex-row items-baseline justify-between">
          <Text className="font-sans text-[11px] font-semibold tracking-[0.88px] text-muted">QUANDO AVISAR</Text>
          <Text className="font-sans text-[11px] font-semibold text-muted">
            {rules.length} de {REMINDER_MAX_RULES}
          </Text>
        </View>

        <View onLayout={measure} className="relative mt-5 h-[66px]">
          <View className="absolute left-0 right-0 top-[30px] h-0.5 bg-outline" />
          <View className="absolute bottom-3.5 left-1/2 top-3.5 -ml-px w-0.5 bg-ink" />
          <View className="absolute left-1/2 top-0 h-[18px] -translate-x-1/2 justify-center rounded-md bg-ink px-[7px]">
            <Text className="font-sans text-[9.5px] font-bold tracking-[0.57px] text-canvas">VENCIMENTO</Text>
          </View>

          {free.map((day) => (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={`Criar lembrete ${reminderOffsetLabel(day)}`}
              accessibilityState={{ disabled: disabled || rules.length >= REMINDER_MAX_RULES }}
              disabled={disabled || rules.length >= REMINDER_MAX_RULES}
              onPress={() => create(day)}
              style={{ left: `${percentOf(day)}%` }}
              className="absolute top-[22px] -ml-2 h-4 w-4 items-center justify-center"
            >
              <View className="h-[7px] w-[7px] rounded-full bg-outline" />
            </Pressable>
          ))}

          {ordered.map(({ index, offset }) => (
            <Pin
              key={index}
              index={index}
              offset={offset}
              disabled={disabled}
              width={width}
              onMove={moveTo}
              onPress={() => setEditing(editing === index ? null : index)}
            />
          ))}
        </View>

        <View className="mt-1.5 flex-row justify-between">
          <Text className="font-sans text-[10px] font-medium text-muted">14 dias antes</Text>
          <Text className="font-sans text-[10px] font-medium text-muted">14 dias depois</Text>
        </View>

        <Text className="mt-3 font-sans text-[11.5px] text-muted">{HINT}</Text>
      </View>

      <View className="gap-2">
        <Text className="px-1 font-sans text-[11px] font-semibold tracking-[0.88px] text-muted">{rules.length === 1 ? "O AVISO" : `OS ${rules.length} AVISOS`}</Text>

        <View className="overflow-hidden rounded-[20px] border border-outline bg-surface">
          {ordered.map(({ rule, index, offset }, position) => (
            <View key={index} className={position === 0 ? "" : "border-t border-outline/50"}>
              <View className="flex-row items-center gap-[11px] px-4 py-3">
                <Switch
                  accessibilityLabel={`Lembrete ${index + 1} ativo`}
                  disabled={disabled}
                  value={rule.enabled}
                  onValueChange={(value) => patch(index, { enabled: value })}
                  trackColor={{ true: colors.primary }}
                />

                <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-primary-soft">
                  <Text className="font-display text-[11px] font-bold text-primary-strong">{position + 1}</Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Editar lembrete ${index + 1}`}
                  accessibilityState={{ expanded: editing === index, disabled }}
                  disabled={disabled}
                  onPress={() => setEditing(editing === index ? null : index)}
                  className="min-w-0 flex-1 flex-row items-center gap-2"
                >
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans text-[13.5px] font-semibold text-ink" numberOfLines={1}>
                      {reminderOffsetLabel(offset)}
                    </Text>
                    <Text className="font-sans text-[11px] text-muted" numberOfLines={1}>
                      {rowSubtitle(rule)}
                    </Text>
                  </View>
                  <Image source={chevronMark} tintColor={colors.muted} style={{ width: 13, height: 13, transform: [{ rotate: editing === index ? "-90deg" : "90deg" }] }} />
                </Pressable>
              </View>

              {editing === index ? (
                <View className="gap-1.5 px-4 pb-3.5">
                  {whatsappEnabled()
                    ? SINGLE_CHANNELS.map((option) => {
                        const label = singleChannelLabel(option);
                        const locked = option.whatsapp ? lock : null;
                        const picked = single(rule.channels);
                        const active = option.email === picked.email && option.whatsapp === picked.whatsapp;
                        const off = disabled || locked !== null;

                        return (
                          <Pressable
                            key={label}
                            accessibilityRole="radio"
                            accessibilityLabel={`${label} no lembrete ${index + 1}`}
                            accessibilityState={{ checked: active, disabled: off }}
                            disabled={off}
                            onPress={() => patch(index, { channels: { ...option } })}
                            className={`h-10 flex-row items-center gap-2 rounded-xl border px-3 ${active ? "border-primary bg-primary-soft" : "border-outline"} ${off ? "opacity-60" : ""}`}
                          >
                            <Text className={`font-sans text-[13px] font-semibold ${active ? "text-primary-strong" : "text-ink"}`}>{label}</Text>
                            {locked ? <Text className="rounded-md bg-surface-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted">{locked}</Text> : null}
                          </Pressable>
                        );
                      })
                    : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remover lembrete ${index + 1}`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={() => {
                      setEditing(null);
                      onChange(rules.filter((_, i) => i !== index));
                    }}
                    className="mt-1 h-10 flex-row items-center justify-center gap-2 rounded-xl border border-danger/40"
                  >
                    <Image source={trashMark} tintColor={colors.danger} style={{ width: 15, height: 15 }} />
                    <Text className="font-sans text-[13px] font-semibold text-danger">Remover este lembrete</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}

          {!rules.length ? <Text className="px-4 py-3 font-sans text-[13px] text-muted">Nenhum lembrete. Toque num ponto da régua.</Text> : null}
        </View>
      </View>
    </View>
  );
}

/**
 * One draggable pin. The gesture reads the track width measured by the card, and the adjustable
 * accessibility actions move it a day at a time for anyone not dragging.
 */
function Pin({
  index,
  offset,
  disabled,
  width,
  onMove,
  onPress,
}: {
  index: number;
  offset: number;
  disabled?: boolean;
  width: { current: number };
  onMove: (index: number, offset: number) => void;
  onPress: () => void;
}) {
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onPanResponderMove: (event) => {
          if (!width.current) {
            return;
          }

          onMove(index, offsetAt(event.nativeEvent.locationX / width.current));
        }
      }),
    [disabled, index, onMove, width]
  );

  return (
    <View style={{ left: `${percentOf(offset)}%` }} className="absolute top-[23px]" {...responder.panHandlers}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={`Lembrete ${index + 1}`}
        accessibilityValue={{ min: -REMINDER_MAX_OFFSET, max: REMINDER_MAX_OFFSET, now: offset, text: reminderOffsetLabel(offset) }}
        accessibilityActions={[
          { name: "increment", label: "um dia depois" },
          { name: "decrement", label: "um dia antes" }
        ]}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment") {
            onMove(index, Math.min(REMINDER_MAX_OFFSET, offset + 1));
          }

          if (event.nativeEvent.actionName === "decrement") {
            onMove(index, Math.max(-REMINDER_MAX_OFFSET, offset - 1));
          }
        }}
        onPress={onPress}
        className="-ml-2 h-4 w-4 rounded-full border-[3px] border-canvas bg-primary"
      />
      <Text className="absolute left-0 top-[23px] -translate-x-1/2 font-sans text-[10.5px] font-semibold text-primary">{reminderOffsetLabel(offset)}</Text>
    </View>
  );
}

/** 5a dates each enabled rule as its own chip, weekday included, against the due date. */
export function RulerPreview({ rules, dueDate }: { rules: ReminderDraft[]; dueDate: string }) {
  const format = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  const days = rules
    .filter((rule) => rule.enabled)
    .map((rule) => offsetOf(rule))
    .sort((a, b) => a - b)
    .map((offset) => format.format(new Date(`${shiftDays(dueDate, offset)}T00:00:00Z`)).replace(/\.$/, ""));

  return (
    <View className="gap-2 rounded-2xl border border-outline bg-surface-muted px-4 py-3">
      <Text className="font-sans text-[10px] font-bold tracking-[0.8px] text-muted">PRÉVIA · VENCIMENTO {shortDayMonth(dueDate)}</Text>

      {days.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {days.map((day) => (
            <View key={day} className="rounded-lg border border-outline bg-surface px-2 py-1">
              <Text className="font-sans text-[11.5px] font-semibold text-ink">{day}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="font-sans text-[12.5px] text-ink">Nenhum lembrete automático.</Text>
      )}

      <Text className="font-sans text-[11px] text-muted">{PREVIEW_NOTE}</Text>
    </View>
  );
}

/** The manual reminder follows the same one-channel rule as the automatic ones. */
export function ManualRulerChannels({
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
  const picked = single(value);

  return (
    <View className="gap-1.5">
      {SINGLE_CHANNELS.map((option) => {
        const label = singleChannelLabel(option);
        const locked = option.whatsapp ? lock : null;
        const active = option.email === picked.email && option.whatsapp === picked.whatsapp;
        const off = disabled || locked !== null;

        return (
          <Pressable
            key={label}
            accessibilityRole="radio"
            accessibilityLabel={`${label} no lembrete manual`}
            accessibilityState={{ checked: active, disabled: off }}
            disabled={off}
            onPress={() => onChange({ ...option })}
            className={`h-10 flex-row items-center gap-2 rounded-xl border px-3 ${active ? "border-primary bg-primary-soft" : "border-outline"} ${off ? "opacity-60" : ""}`}
          >
            <Text className={`font-sans text-[13px] font-semibold ${active ? "text-primary-strong" : "text-ink"}`}>{label}</Text>
            {locked ? <Text className="rounded-md bg-surface-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted">{locked}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
