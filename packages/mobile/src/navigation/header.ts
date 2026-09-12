/** Native stack header shared by every headed route; iOS labels the back button with the previous screen's title. */
export const HEADER = {
  headerBackButtonDisplayMode: "default",
  headerTintColor: "#003828",
  headerStyle: { backgroundColor: "#faf8ff" },
  headerShadowVisible: false,
  headerTitleStyle: { fontWeight: "700", color: "#003828" },
} as const;
