import {
  addCalendarDays,
  amountDigitsToInput,
  amountInputToDigits,
  billingCategoryLabel,
  BillingDueRule,
  BillingFrequency,
  type BillingDraft,
  BillingRecurrence,
  Direction,
  endOfMonth,
  formatAmountDigits,
  formatMoney,
  scheduleHint,
  untilInstallmentPreview,
} from "@receivy/common";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, Text, TextInput, useColorScheme, View } from "react-native";
import { CategorySelect } from "@/components/app/category-select";
import { MonthSelect } from "@/components/app/month-select";
import { useThemeColors } from "@/theme/colors";

const calendarMark = require("../../../../assets/images/auth/calendar.svg");

export const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: Direction.Receivable, label: "Vou receber" },
  { value: Direction.Payable, label: "Vou pagar" },
];

const TYPES: { value: BillingRecurrence; label: string }[] = [
  { value: BillingRecurrence.Once, label: "À vista" },
  { value: BillingRecurrence.Until, label: "Parcelado" },
  { value: BillingRecurrence.Indefinite, label: "Recorrente" },
];

const FREQUENCIES: { value: BillingFrequency; label: string }[] = [
  { value: BillingFrequency.Monthly, label: "Mensal" },
  { value: BillingFrequency.Yearly, label: "Anual" },
];

const AMOUNT_LABELS: Record<BillingRecurrence, string> = {
  once: "Valor total",
  until: "Valor total",
  indefinite: "Valor por ocorrência",
};

/** A conta a pagar has no split, so "total" says nothing there. */
const PAYABLE_AMOUNT_LABELS: Record<BillingRecurrence, string> = { ...AMOUNT_LABELS, once: "Valor" };

/** "Já recebi" / "Já paguei", by direction. */
export const SETTLED_LABELS: Record<Direction, string> = { receivable: "Já recebi", payable: "Já paguei" };

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" });
}

/** The due date is typed by hand, so a real calendar day is checked before the shared builder sees it. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const time = Date.parse(`${value}T00:00:00.000Z`);

  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** The picker works with the device's local calendar; the draft keeps `AAAA-MM-DD`. */
function dateFromCalendar(value: string, fallback: string): Date {
  const [year, month, day] = (isCalendarDate(value) ? value : fallback).split("-").map(Number);

  return new Date(year!, month! - 1, day!);
}

function calendarFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text className="ml-0.5 font-sans text-[11px] font-semibold uppercase tracking-[0.88px] text-muted">{children}</Text>;
}

type SegmentedProps<T extends string> = {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
};

/** The pill switch of the design: a muted track, the chosen option raised in white. */
export function Segmented<T extends string>({ name, options, value, disabled, onChange }: SegmentedProps<T>) {
  return (
    <View accessibilityLabel={name} className={`flex-row rounded-[14px] bg-surface-muted p-1 ${disabled ? "opacity-60" : ""}`}>
      {options.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            className={`h-10 flex-1 items-center justify-center rounded-[11px] ${active ? "bg-surface shadow-sm" : ""}`}
          >
            <Text className={`font-sans text-[13px] ${active ? "font-bold text-ink" : "font-semibold text-muted"}`}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type AmountTitleFieldsProps = {
  draft: BillingDraft;
  /** Every field is read-only while a save is in flight. */
  locked: boolean;
  /** A finite billing already generated its charges: amount and title are read-only. */
  frozen: boolean;
  onChange: (patch: Partial<BillingDraft>) => void;
};

/** The amount, the title and the category: the top of step 1 and of the edit screen. */
export function AmountTitleFields({ draft, locked, frozen, onChange }: AmountTitleFieldsProps) {
  const colors = useThemeColors();
  const payable = draft.direction === Direction.Payable;
  const installmentPreview = untilInstallmentPreview(draft);

  // The field behaves like a bank keypad: whatever the keyboard hands back is
  // reduced to its digits and re-rendered, so typing pushes cents to the left
  // and the backspace drops the last digit.
  function typeAmount(value: string) {
    onChange({ amount: amountDigitsToInput(amountInputToDigits(value)) });
  }

  return (
    <View className="gap-4">
      {/* Valor */}
      <View className="items-center gap-1 py-2">
        <View className="flex-row items-end justify-center gap-1.5">
          <Text className="pb-2 font-display text-lg font-semibold text-muted">R$</Text>
          <TextInput
            accessibilityLabel="Valor"
            editable={!locked && !frozen}
            keyboardType="number-pad"
            placeholderTextColor={colors.muted}
            value={formatAmountDigits(amountInputToDigits(draft.amount))}
            onChangeText={typeAmount}
            textAlignVertical="center"
            className="min-w-[120px] py-0 text-center font-display text-[44px] font-bold tracking-tight text-ink"
          />
        </View>
        <Text className="font-sans text-[12.5px] text-muted">{(payable ? PAYABLE_AMOUNT_LABELS : AMOUNT_LABELS)[draft.type].toLowerCase()}</Text>
        {installmentPreview && (
          <Text className="text-[11px] text-muted">
            {installmentPreview.count}x de {money(installmentPreview.perInstallmentCents)}
            {installmentPreview.roundedUp ? ` · total ${money(installmentPreview.totalCents)}` : ""}
          </Text>
        )}
      </View>

      {/* Título e categoria */}
      <View className="gap-1.5">
        <SectionLabel>Título da conta</SectionLabel>
        <View className="flex-row items-center gap-2 rounded-2xl border border-outline bg-surface p-1.5 pl-3.5">
          <TextInput
            accessibilityLabel="Título"
            editable={!locked && !frozen}
            maxLength={500}
            placeholder="Ex: Aluguel do sítio, Pizzaria..."
            placeholderTextColor={colors.muted}
            value={draft.description}
            onChangeText={(value) => onChange({ description: value })}
            className="h-10 flex-1 py-0 font-sans text-[15px] tracking-normal text-ink"
          />
          <View className="w-[150px]">
            <CategorySelect value={draft.category} disabled={locked} onSelect={(category) => onChange({ category, description: draft.description || billingCategoryLabel(category) })} />
          </View>
        </View>
      </View>
    </View>
  );
}

type RepeatFieldsProps = {
  draft: BillingDraft;
  today: string;
  locked: boolean;
  /** No edit changes the type or the frequency: `BillingPatch` carries neither. */
  scheduled: boolean;
  /** Generated occurrences keep their due date; only an assinatura moves its next one. */
  dueLocked: boolean;
  onChange: (patch: Partial<BillingDraft>) => void;
};

/** "Como se repete": the type, the frequency or the instalments, and the due date. */
export function RepeatFields({ draft, today, locked, scheduled, dueLocked, onChange }: RepeatFieldsProps) {
  const colors = useThemeColors();
  const scheme = useColorScheme();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const settled = draft.settled === true;
  // Month ends exist for a single due date and for monthly rules; a yearly billing keeps a fixed day.
  const monthEnds = draft.type === BillingRecurrence.Once || draft.frequency === BillingFrequency.Monthly;
  const monthEnd = monthEnds && draft.dueRule === BillingDueRule.EndOfMonth;
  // A recorrente registro starts today or later; a single one may be in the past.
  const minimumDate = settled && draft.type !== BillingRecurrence.Once ? dateFromCalendar(today, today) : undefined;
  const dateLabel = scheduled ? "Próximo vencimento" : draft.type === BillingRecurrence.Until ? "Primeira parcela" : draft.type === BillingRecurrence.Indefinite ? "Próximo vencimento" : "Vencimento";

  // Android answers once and closes its dialog; the iOS sheet stays open while the
  // user browses months, so only Concluir or the backdrop closes it.
  function pickDate(_event: unknown, date: Date) {
    onChange({ start: calendarFromDate(date) });

    if (Platform.OS !== "ios") {
      setCalendarOpen(false);
    }
  }

  function toggleMonthEnd() {
    if (monthEnd) {
      onChange({ dueRule: BillingDueRule.Fixed });

      return;
    }

    // Typed text may not be a date yet; the month end then starts from today.
    const base = /^\d{4}-\d{2}-\d{2}$/.test(draft.start) && draft.start >= today ? draft.start : today;

    setCalendarOpen(false);
    onChange({ dueRule: BillingDueRule.EndOfMonth, start: endOfMonth(base) });
  }

  const hint = scheduleHint(draft);

  return (
    <View className="gap-4">
      {/* Como se repete */}
      <View className="gap-2">
        <SectionLabel>Como se repete</SectionLabel>
        <Segmented
          name="Modalidade"
          options={TYPES}
          value={draft.type}
          disabled={locked || scheduled}
          onChange={(type) => onChange({ type, frequency: type === BillingRecurrence.Until ? BillingFrequency.Monthly : draft.frequency, end: "" })}
        />

        <View className="flex-row gap-2">
          {draft.type === BillingRecurrence.Until && (
            <View className="flex-1 gap-1 rounded-xl border border-outline bg-surface px-3 py-2">
              <Text className="font-sans text-[11px] text-muted">Parcelas</Text>
              <TextInput
                accessibilityLabel="Parcelas"
                editable={!locked && !scheduled}
                inputMode="numeric"
                placeholder="2 a 120"
                placeholderTextColor={colors.muted}
                value={draft.occurrences}
                onChangeText={(value) => onChange({ occurrences: value })}
                className="h-6 py-0 font-sans text-[15px] font-semibold tracking-normal text-ink"
              />
            </View>
          )}
          {draft.type === BillingRecurrence.Indefinite && (
            <View className="flex-1 gap-1.5 rounded-xl border border-outline bg-surface px-3 py-2">
              <Text className="font-sans text-[11px] text-muted">A cada</Text>
              <View className="flex-row gap-1.5">
                {FREQUENCIES.map((option) => {
                  const active = draft.frequency === option.value;

                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected: active, disabled: locked || scheduled }}
                      disabled={locked || scheduled}
                      onPress={() => onChange({ frequency: option.value })}
                      className={`h-7 items-center justify-center rounded-lg px-2.5 ${active ? "bg-primary-soft" : "bg-surface-muted"} ${locked || scheduled ? "opacity-60" : ""}`}
                    >
                      <Text className={`font-sans text-[12px] ${active ? "font-bold text-primary-strong" : "font-semibold text-muted"}`}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <View className="flex-1 gap-1 rounded-xl border border-outline bg-surface px-3 py-2">
            <Text className="font-sans text-[11px] text-muted">{dateLabel}</Text>
            {monthEnd ? (
              <MonthSelect value={draft.start} today={today} disabled={locked || dueLocked} onSelect={(value) => onChange({ start: value })} />
            ) : (
              <View className="flex-row items-center gap-1">
                <TextInput
                  accessibilityLabel="Vencimento"
                  editable={!locked && !dueLocked}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={colors.muted}
                  value={draft.start}
                  onChangeText={(value) => onChange({ start: value })}
                  className="h-6 flex-1 py-0 font-sans text-[15px] font-semibold tracking-normal text-ink"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Abrir calendário"
                  accessibilityState={{ expanded: calendarOpen, disabled: locked || dueLocked }}
                  disabled={locked || dueLocked}
                  onPress={() => setCalendarOpen((open) => !open)}
                  className={`h-7 w-7 items-center justify-center ${locked || dueLocked ? "opacity-50" : ""}`}
                >
                  <Image source={calendarMark} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />
                </Pressable>
              </View>
            )}
          </View>
        </View>

        <View className="flex-row flex-wrap items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hoje"
            accessibilityState={{ selected: !monthEnd && draft.start === today, disabled: locked || dueLocked }}
            disabled={locked || dueLocked}
            onPress={() => onChange({ start: addCalendarDays(today, 0), dueRule: BillingDueRule.Fixed })}
            className={`h-9 items-center justify-center rounded-xl border px-3.5 ${!monthEnd && draft.start === today ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"} ${locked || dueLocked ? "opacity-50" : ""}`}
          >
            <Text className="text-xs font-semibold text-primary-strong">Hoje</Text>
          </Pressable>
          {monthEnds && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Final do mês"
              accessibilityState={{ selected: monthEnd, disabled: locked || dueLocked }}
              disabled={locked || dueLocked}
              onPress={toggleMonthEnd}
              className={`h-9 items-center justify-center rounded-xl border px-3.5 ${monthEnd ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"} ${locked || dueLocked ? "opacity-50" : ""}`}
            >
              <Text className="text-xs font-semibold text-primary-strong">Final do mês</Text>
            </Pressable>
          )}
          {hint ? <Text className="flex-1 font-sans text-[12px] text-muted">{hint}</Text> : null}
        </View>
      </View>

      {calendarOpen && Platform.OS !== "ios" && (
        <DateTimePicker
          accessibilityLabel="Calendário"
          value={dateFromCalendar(draft.start, today)}
          mode="date"
          minimumDate={minimumDate}
          display="default"
          themeVariant={scheme === "dark" ? "dark" : "light"}
          onValueChange={pickDate}
          onDismiss={() => setCalendarOpen(false)}
        />
      )}
      {calendarOpen && Platform.OS === "ios" && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setCalendarOpen(false)}>
          <Pressable className="flex-1 justify-end bg-scrim" onPress={() => setCalendarOpen(false)}>
            <Pressable className="gap-2 rounded-t-3xl bg-canvas p-5 pb-10" onPress={() => undefined}>
              <Text accessibilityRole="header" className="text-lg font-semibold text-primary-strong">
                Data de vencimento
              </Text>
              <DateTimePicker
                accessibilityLabel="Calendário"
                value={dateFromCalendar(draft.start, today)}
                mode="date"
                minimumDate={minimumDate}
                display="inline"
                locale="pt-BR"
                accentColor={colors.primary}
                themeVariant={scheme === "dark" ? "dark" : "light"}
                onValueChange={pickDate}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Concluir" onPress={() => setCalendarOpen(false)} className="h-12 items-center justify-center rounded-xl bg-primary">
                <Text className="text-sm font-bold text-on-primary">Concluir</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
