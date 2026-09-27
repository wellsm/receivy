import { groupSizeLabel, type WhatsappGroup } from "@receivy/common";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/app/bottom-sheet";
import { useThemeColors } from "@/theme/colors";

const checkMark = require("../../../assets/images/auth/check.svg");

type WhatsappGroupSheetProps = {
  /** The billing's participants: the groups holding all of them come first. */
  participants: string[];
  selected: string | null;
  load: (participants: string[]) => Promise<WhatsappGroup[]>;
  onPick: (group: WhatsappGroup) => void;
  onClose: () => void;
};

const LOAD_ERROR = "Não foi possível carregar os grupos.";
/** Placeholder rows while the number is asked for its groups: varied widths read as real names. */
const SKELETON_WIDTHS = ["60%", "40%", "50%", "66%"] as const;

/** The list's shape while it loads, so the wait reads as progress instead of a lone spinner. */
function GroupsSkeleton() {
  const colors = useThemeColors();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true })
      ])
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [pulse]);

  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Carregando grupos" className="gap-2">
      <View className="flex-row items-center gap-2">
        <ActivityIndicator size="small" color={colors.primaryStrong} />
        <Text className="font-sans text-[13px] text-muted">Buscando grupos no seu WhatsApp…</Text>
      </View>
      {SKELETON_WIDTHS.map((width) => (
        <Animated.View key={width} style={{ opacity: pulse }} className="min-h-14 justify-center gap-2 rounded-2xl border border-outline bg-surface px-4 py-3">
          <View className="h-3.5 rounded-full bg-outline" style={{ width }} />
          <View className="h-2.5 w-16 rounded-full bg-outline/60" />
        </Animated.View>
      ))}
    </View>
  );
}

/** The groups of the owner's connected number, searchable, the suggested ones on top. */
export function WhatsappGroupSheet({ participants, selected, load, onPick, onClose }: WhatsappGroupSheetProps) {
  const colors = useThemeColors();
  const [groups, setGroups] = useState<WhatsappGroup[] | null>(null);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const key = participants.join(",");

  useEffect(() => {
    let live = true;

    load(key ? key.split(",") : [])
      .then((found) => live && setGroups(found))
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : LOAD_ERROR));

    return () => {
      live = false;
    };
  }, [key, load]);

  const needle = term.trim().toLocaleLowerCase("pt-BR");
  const visible = (groups ?? []).filter((group) => !needle || group.name.toLocaleLowerCase("pt-BR").includes(needle));

  return (
    <BottomSheet title="Avisar no grupo" doneLabel="" onClose={onClose}>
      <TextInput
        accessibilityLabel="Buscar grupos"
        placeholder="Buscar grupo…"
        placeholderTextColor={colors.muted}
        value={term}
        onChangeText={setTerm}
        className="min-h-12 rounded-xl border border-outline bg-surface px-4 text-ink"
      />
      {error ? (
        <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
          {error}
        </Text>
      ) : null}
      {!groups && !error && <GroupsSkeleton />}
      {groups && !visible.length && <Text className="py-6 text-center text-muted">Nenhum grupo encontrado.</Text>}
      {visible.map((group) => {
        const active = group.jid === selected;

        return (
          <Pressable
            key={group.jid}
            accessibilityRole="button"
            accessibilityLabel={group.name}
            accessibilityState={{ selected: active }}
            onPress={() => onPick(group)}
            className={`min-h-14 flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${active ? "border-primary bg-primary-soft/40" : "border-outline bg-surface"}`}
          >
            <View className="flex-1">
              <Text className="font-sans text-[14px] font-bold text-ink" numberOfLines={1}>
                {group.name}
              </Text>
              <Text className="font-sans text-[11.5px] text-muted">{groupSizeLabel(group.size)}</Text>
            </View>
            {group.suggested && <Text className="rounded-full bg-success-soft px-2 py-0.5 font-sans text-[10.5px] font-bold text-success">Sugerido</Text>}
            {active && <Image source={checkMark} tintColor={colors.primaryStrong} style={{ width: 18, height: 18 }} />}
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}
