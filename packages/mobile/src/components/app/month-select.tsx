import { useState } from "react";
import { Image } from "expo-image";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { endOfMonthOptions } from "@receivy/common";
import { ACTIVE_TINT, MUTED_TINT } from "@/theme/colors";

const chevronMark = require("../../../assets/images/auth/chevron.svg");
const checkMark = require("../../../assets/images/auth/check.svg");

/** Current month plus the next twelve. */
const MONTHS_AHEAD = 13;

type MonthSelectProps = {
  /** The last day of the chosen month (`YYYY-MM-DD`). */
  value: string;
  today: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
};

/** Select-shaped trigger over a bottom sheet of month ends, for a due date on the last day of the month. */
export function MonthSelect({ value, today, onSelect, disabled }: MonthSelectProps) {
  const [open, setOpen] = useState(false);
  const options = endOfMonthOptions(today, MONTHS_AHEAD);
  // A saved month beyond the window still reads right on the trigger.
  const current = options.find((option) => option.value === value) ?? endOfMonthOptions(value, 1)[0]!;

  function choose(next: string) {
    setOpen(false);
    onSelect(next);
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mês do vencimento"
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={`h-11 flex-row items-center gap-2 rounded-xl border border-outline/50 bg-surface px-3.5 ${disabled ? "opacity-60" : ""}`}
      >
        <Text className="flex-1 text-[14px] font-semibold text-ink" numberOfLines={1}>
          {current.label}
        </Text>

        <Text className="text-xs text-muted">{current.dueLabel}</Text>

        <Image source={chevronMark} tintColor={MUTED_TINT} style={{ width: 14, height: 14, transform: [{ rotate: "90deg" }] }} />
      </Pressable>

      {open && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setOpen(false)}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar meses" onPress={() => setOpen(false)} className="flex-1 bg-black/40" />

          <View className="max-h-[70%] gap-4 rounded-t-3xl bg-surface px-5 pb-10 pt-5">
            <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
              Mês do vencimento
            </Text>

            <ScrollView contentContainerClassName="gap-1" showsVerticalScrollIndicator={false}>
              {options.map((option) => {
                const active = option.value === value;

                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => choose(option.value)}
                    className={`h-14 flex-row items-center gap-3 rounded-2xl px-3 ${active ? "bg-surface-muted" : ""}`}
                  >
                    <Text className="flex-1 text-sm font-semibold text-ink">{option.label}</Text>

                    <Text className="text-xs text-muted">{option.dueLabel}</Text>

                    {active && <Image source={checkMark} tintColor={ACTIVE_TINT} style={{ width: 16, height: 16 }} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      )}
    </View>
  );
}
