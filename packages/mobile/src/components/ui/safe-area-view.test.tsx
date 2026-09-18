import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
// eslint-disable-next-line no-restricted-imports -- the raw export is the thing under test
import { SafeAreaView as ContextSafeAreaView } from "react-native-safe-area-context";
import { SafeAreaView } from "@/components/ui/safe-area-view";

it("wraps the safe-area-context view with uniwind so className is not silently dropped", async () => {
  expect(SafeAreaView).not.toBe(ContextSafeAreaView);

  await render(<SafeAreaView className="flex-1 bg-canvas" edges={["top"]}><Text>conteúdo</Text></SafeAreaView>);

  expect(screen.getByText("conteúdo")).toBeOnTheScreen();
});
