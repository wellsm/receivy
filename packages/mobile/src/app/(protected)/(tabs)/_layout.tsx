import { Image } from "expo-image";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { ACTIVE_TINT, MUTED_TINT } from "@/theme/colors";

const TABS = [
  {
    name: "index",
    label: "Feed",
    sf: { default: "house", selected: "house.fill" },
    src: require("../../../../assets/images/auth/tab-feed.svg"),
  },
  {
    name: "billings",
    label: "Contas",
    sf: { default: "doc.text", selected: "doc.text.fill" },
    src: require("../../../../assets/images/auth/tab-billings.svg"),
  },
  {
    name: "settings",
    label: "Perfil",
    sf: { default: "person", selected: "person.fill" },
    src: require("../../../../assets/images/auth/tab-profile.svg"),
  },
] as const;

/** iOS gets the system tab bar (SF Symbols, liquid glass); Android falls back to the JS tabs with the SVG icons. */
export default function TabsLayout() {
  if (Platform.OS === "ios") {
    return (
      <NativeTabs tintColor={ACTIVE_TINT} iconColor={MUTED_TINT}>
        {TABS.map((tab) => (
          <NativeTabs.Trigger key={tab.name} name={tab.name}>
            <NativeTabs.Trigger.Icon sf={tab.sf} />
            <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_TINT,
        tabBarInactiveTintColor: MUTED_TINT,
        tabBarStyle: { backgroundColor: "#ffffff", borderTopColor: "#bfc9c3" },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarIcon: ({ focused }) => (
              <Image source={tab.src} tintColor={focused ? ACTIVE_TINT : MUTED_TINT} style={{ width: 22, height: 22 }} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
