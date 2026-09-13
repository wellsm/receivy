import { useThemeColors } from "@/theme/colors";

/** Native stack header shared by every headed route; iOS labels the back button with the previous screen's title. */
export function useHeaderOptions() {
  const colors = useThemeColors();

  return {
    headerBackButtonDisplayMode: "default",
    headerTintColor: colors.primaryStrong,
    headerStyle: { backgroundColor: colors.canvas },
    headerShadowVisible: false,
    headerTitleStyle: { fontWeight: "700", color: colors.primaryStrong },
  } as const;
}
