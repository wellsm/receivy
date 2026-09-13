import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { BILLING_CATEGORIES, type BillingCategory, BillingState, BillingType, Direction } from "@receivy/common";

export type BillingFiltersValue = {
  state: BillingState;
  type: BillingType | "";
  category: BillingCategory | "";
  /** Empty lists both sides; otherwise it becomes `direction=` on the list query. */
  direction: Direction | "";
};

export const DEFAULT_BILLING_FILTERS: BillingFiltersValue = { state: BillingState.Active, type: "", category: "", direction: "" };

const STATES: { value: BillingState; label: string }[] = [
  { value: BillingState.Active, label: "Ativas" },
  { value: BillingState.Paused, label: "Pausadas" },
  { value: BillingState.Ended, label: "Encerradas" },
];

const TYPES: { value: BillingType | ""; label: string }[] = [
  { value: "", label: "Todas" },
  { value: BillingType.Once, label: "Única" },
  { value: BillingType.Until, label: "Parcelada" },
  { value: BillingType.Indefinite, label: "Sem fim" },
];

const CATEGORIES: { value: BillingCategory | ""; label: string }[] = [{ value: "", label: "Todas" }, ...BILLING_CATEGORIES];

const DIRECTIONS: { value: Direction | ""; label: string }[] = [
  { value: "", label: "Todas" },
  { value: Direction.Receivable, label: "A receber" },
  { value: Direction.Payable, label: "A pagar" },
];

/** The filters that differ from the default, as removable chips under the search field. */
export function activeBillingChips(value: BillingFiltersValue): { key: keyof BillingFiltersValue; label: string }[] {
  const chips: { key: keyof BillingFiltersValue; label: string }[] = [];

  if (value.state !== DEFAULT_BILLING_FILTERS.state) {
    chips.push({ key: "state", label: STATES.find((option) => option.value === value.state)?.label ?? value.state });
  }

  if (value.type) {
    chips.push({ key: "type", label: TYPES.find((option) => option.value === value.type)?.label ?? value.type });
  }

  if (value.category) {
    chips.push({ key: "category", label: CATEGORIES.find((option) => option.value === value.category)?.label ?? value.category });
  }

  if (value.direction) {
    chips.push({ key: "direction", label: DIRECTIONS.find((option) => option.value === value.direction)?.label ?? value.direction });
  }

  return chips;
}

type ChipGroupProps<T extends string> = {
  group: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
};

function ChipGroup<T extends string>({ group, options, selected, onSelect }: ChipGroupProps<T>) {
  return (
    <View className="gap-2">
      <Text className="text-[11px] font-bold tracking-widest text-muted">{group.toUpperCase()}</Text>

      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === selected;

          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityLabel={`${group} ${option.label}`}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(option.value)}
              className={`min-h-10 justify-center rounded-full border px-4 ${active ? "border-primary bg-primary" : "border-outline bg-surface"}`}
            >
              <Text className={`text-sm font-semibold ${active ? "text-white" : "text-ink"}`}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type BillingFiltersSheetProps = {
  value: BillingFiltersValue;
  onApply: (value: BillingFiltersValue) => void;
  onClose: () => void;
};

/** Bottom sheet with the four filter groups; nothing reaches the list until `Aplicar`. */
export function BillingFiltersSheet({ value, onApply, onClose }: BillingFiltersSheetProps) {
  const [draft, setDraft] = useState<BillingFiltersValue>(value);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar filtros" onPress={onClose} className="flex-1 bg-black/40" />

      <View className="gap-5 rounded-t-3xl bg-surface px-5 pb-10 pt-5">
        <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
          Filtros
        </Text>

        <ScrollView contentContainerClassName="gap-5" showsVerticalScrollIndicator={false}>
          <ChipGroup group="Direção" options={DIRECTIONS} selected={draft.direction} onSelect={(direction) => setDraft({ ...draft, direction })} />
          <ChipGroup group="Estado" options={STATES} selected={draft.state} onSelect={(state) => setDraft({ ...draft, state })} />
          <ChipGroup group="Tipo" options={TYPES} selected={draft.type} onSelect={(type) => setDraft({ ...draft, type })} />
          <ChipGroup group="Categoria" options={CATEGORIES} selected={draft.category} onSelect={(category) => setDraft({ ...draft, category })} />
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aplicar"
          onPress={() => onApply(draft)}
          className="min-h-14 items-center justify-center rounded-2xl bg-primary"
        >
          <Text className="font-bold text-white">Aplicar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
