import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { BILLING_CATEGORIES, BILLING_RECURRENCE_FILTERS, BILLING_TYPE_FILTERS, type BillingCategory, type BillingListFilters, DEFAULT_BILLING_LIST_FILTERS } from "@receivy/common";

const CATEGORIES: { value: BillingCategory | ""; label: string }[] = [{ value: "", label: "Todas" }, ...BILLING_CATEGORIES];

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
              <Text className={`text-sm font-semibold ${active ? "text-on-primary" : "text-ink"}`}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type BillingFiltersSheetProps = {
  value: BillingListFilters;
  onApply: (value: BillingListFilters) => void;
  onClose: () => void;
};

/** Design 8b: the Contas footer filter, with Tipo, Frequência and Categoria; nothing reaches the list until `Aplicar`. */
export function BillingFiltersSheet({ value, onApply, onClose }: BillingFiltersSheetProps) {
  const [draft, setDraft] = useState<BillingListFilters>(value);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar filtros" onPress={onClose} className="flex-1 bg-scrim" />

      <View className="gap-5 rounded-t-3xl bg-surface px-5 pb-10 pt-5">
        <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
          Filtros
        </Text>

        <ScrollView contentContainerClassName="gap-5" showsVerticalScrollIndicator={false}>
          <ChipGroup group="Tipo" options={BILLING_TYPE_FILTERS} selected={draft.type} onSelect={(type) => setDraft({ ...draft, type })} />
          <ChipGroup group="Frequência" options={BILLING_RECURRENCE_FILTERS} selected={draft.recurrence} onSelect={(recurrence) => setDraft({ ...draft, recurrence })} />
          <ChipGroup group="Categoria" options={CATEGORIES} selected={draft.category} onSelect={(category) => setDraft({ ...draft, category })} />
        </ScrollView>

        <Pressable accessibilityRole="button" accessibilityLabel="Limpar" onPress={() => setDraft(DEFAULT_BILLING_LIST_FILTERS)} className="min-h-10 items-center justify-center">
          <Text className="font-bold text-primary">Limpar</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aplicar"
          onPress={() => onApply(draft)}
          className="min-h-14 items-center justify-center rounded-2xl bg-primary"
        >
          <Text className="font-bold text-on-primary">Aplicar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
