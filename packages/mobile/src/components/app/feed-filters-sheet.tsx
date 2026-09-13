import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import {
  DEFAULT_FEED_FILTERS,
  FEED_DIRECTIONS,
  FEED_PERIODS,
  FEED_STATUSES,
  FEED_TYPES,
  toggleFeedValue,
  type FeedFilters,
} from "@receivy/common";

type ChipGroupProps<T extends string> = {
  group: string;
  options: { value: T; label: string }[];
  selected: T[];
  /** Shown on the "all" chip of a multi group, which clears the selection. */
  everyLabel?: string;
  onPick: (value: T) => void;
  onClear?: () => void;
};

function ChipGroup<T extends string>({ group, options, selected, everyLabel, onPick, onClear }: ChipGroupProps<T>) {
  const every = !selected.length;

  return (
    <View className="gap-2">
      <Text className="text-[11px] font-bold tracking-widest text-muted">{group.toUpperCase()}</Text>

      <View className="flex-row flex-wrap gap-2">
        {onClear && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${group} ${everyLabel}`}
            accessibilityState={{ selected: every }}
            onPress={onClear}
            className={`min-h-10 justify-center rounded-full border px-4 ${every ? "border-primary bg-primary" : "border-outline bg-surface"}`}
          >
            <Text className={`text-sm font-semibold ${every ? "text-on-primary" : "text-ink"}`}>{everyLabel}</Text>
          </Pressable>
        )}

        {options.map((option) => {
          const active = selected.includes(option.value);

          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`${group} ${option.label}`}
              accessibilityState={{ selected: active }}
              onPress={() => onPick(option.value)}
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

type FeedFiltersSheetProps = {
  value: FeedFilters;
  onApply: (value: FeedFilters) => void;
  onClose: () => void;
};

/** The four feed groups; nothing reaches the list until `Aplicar`. Direction, status and type take many values. */
export function FeedFiltersSheet({ value, onApply, onClose }: FeedFiltersSheetProps) {
  const [draft, setDraft] = useState<FeedFilters>(value);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar filtros" onPress={onClose} className="flex-1 bg-scrim" />

      <View className="gap-5 rounded-t-3xl bg-surface px-5 pb-10 pt-5">
        <View className="flex-row items-center justify-between gap-2">
          <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
            Filtros
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Limpar filtros"
            onPress={() => setDraft(DEFAULT_FEED_FILTERS)}
            className="min-h-10 justify-center px-2"
          >
            <Text className="text-sm font-bold text-primary">Limpar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-5" showsVerticalScrollIndicator={false}>
          <ChipGroup
            group="Direção"
            options={FEED_DIRECTIONS}
            selected={draft.direction}
            everyLabel="Todas"
            onClear={() => setDraft({ ...draft, direction: [] })}
            onPick={(direction) => setDraft({ ...draft, direction: toggleFeedValue(draft.direction, direction) })}
          />
          <ChipGroup
            group="Status"
            options={FEED_STATUSES}
            selected={draft.status}
            everyLabel="Todos"
            onClear={() => setDraft({ ...draft, status: [] })}
            onPick={(status) => setDraft({ ...draft, status: toggleFeedValue(draft.status, status) })}
          />
          <ChipGroup
            group="Modalidade"
            options={FEED_TYPES}
            selected={draft.type}
            everyLabel="Todas"
            onClear={() => setDraft({ ...draft, type: [] })}
            onPick={(type) => setDraft({ ...draft, type: toggleFeedValue(draft.type, type) })}
          />
          <ChipGroup group="Período" options={FEED_PERIODS} selected={[draft.period]} onPick={(period) => setDraft({ ...draft, period })} />
        </ScrollView>

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
