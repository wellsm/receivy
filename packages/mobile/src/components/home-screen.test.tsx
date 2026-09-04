import { render, screen } from "@testing-library/react-native";

import { HomeScreen } from "./home-screen";

describe("HomeScreen", () => {
  it("shows the shared empty timeline and its primary action", async () => {
    await render(<HomeScreen />);

    expect(
      screen.getByText("O que entra. O que sai. No mesmo lugar."),
    ).toBeOnTheScreen();
    expect(screen.getAllByText("R$ 0,00")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Nova cobrança" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Sua timeline começa aqui")).toBeOnTheScreen();
  });
});
