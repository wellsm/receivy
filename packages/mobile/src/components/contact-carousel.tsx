import { lastBilledHint, type Person } from "@receivy/common";
import { Image } from "expo-image";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ACTIVE_TINT } from "./tab-bar";

type ContactCarouselProps = {
  people: Person[];
  selected: string[];
  today: string;
  disabled: boolean;
  onToggle: (personId: string) => void;
  /** Absent when the screen cannot navigate to the contact form. */
  onNew?: () => void;
};

const plusMark = require("../../assets/images/auth/plus.svg");

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
}

export function ContactCarousel({ people, selected, today, disabled, onToggle, onNew }: ContactCarouselProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 py-1">
      {onNew && (
        <Pressable accessibilityRole="button" accessibilityLabel="Novo contato" disabled={disabled} onPress={onNew} className="w-20 items-center gap-1">
          <View className="h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-primary">
            <Image source={plusMark} tintColor={ACTIVE_TINT} style={{ width: 18, height: 18 }} />
          </View>
          <Text className="text-xs font-bold text-primary-strong" numberOfLines={1}>
            Novo
          </Text>
          <Text className="text-[10px] text-muted" numberOfLines={1}>
            Cadastrar
          </Text>
        </Pressable>
      )}
      {people.map((person) => (
        <Pressable
          key={person.id}
          accessibilityRole="button"
          accessibilityLabel={person.name}
          accessibilityState={{ selected: selected.includes(person.id), disabled }}
          disabled={disabled}
          onPress={() => onToggle(person.id)}
          className="w-20 items-center gap-1"
        >
          <View
            className={`h-14 w-14 items-center justify-center rounded-full border ${
              selected.includes(person.id) ? "border-primary bg-primary" : "border-outline bg-surface"
            }`}
          >
            <Text className={`text-lg font-extrabold ${selected.includes(person.id) ? "text-white" : "text-primary-strong"}`}>{initialOf(person.name)}</Text>
          </View>
          <Text className="text-xs font-bold text-ink" numberOfLines={1}>
            {person.name}
          </Text>
          <Text className="text-[10px] text-muted" numberOfLines={1}>
            {lastBilledHint(person.lastBilledAt, today)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
