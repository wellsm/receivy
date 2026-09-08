import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

export type Tab = "Feed" | "Cobranças" | "Perfil";

type TabBarProps = {
  active: Tab;
  onOpenFeed?: () => void;
  onOpenBillings?: () => void;
  onOpenSettings?: () => void;
};

const TAB_ICONS = {
  Feed: require("../../assets/images/auth/tab-feed.svg"),
  Cobranças: require("../../assets/images/auth/tab-billings.svg"),
  Perfil: require("../../assets/images/auth/tab-profile.svg"),
} as const;

export const ACTIVE_TINT = "#003828";
export const MUTED_TINT = "#5B6470";

/** Bottom navigation shared by the Feed and the Perfil screens. */
export function TabBar({ active, onOpenFeed, onOpenBillings, onOpenSettings }: TabBarProps) {
  const tabs: [Tab, (() => void) | undefined][] = [
    ["Feed", onOpenFeed],
    ["Cobranças", onOpenBillings],
    ["Perfil", onOpenSettings],
  ];

  return (
    <View className="absolute bottom-0 left-0 right-0 flex-row border-t border-outline/45 bg-surface px-2 pb-6 pt-2">
      {tabs.map(([label, onPress]) => {
        const selected = label === active;

        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={selected ? undefined : onPress}
            className={`flex-1 items-center gap-1 rounded-full py-2 ${selected ? "bg-primary-soft/40" : ""}`}
          >
            <Image source={TAB_ICONS[label]} tintColor={selected ? ACTIVE_TINT : MUTED_TINT} style={{ width: 22, height: 22 }} />
            <Text className={`text-[11px] font-bold ${selected ? "text-primary-strong" : "text-muted"}`}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
