import { fireEvent, render, screen } from "@testing-library/react-native";
import { ScopeModal } from "@/components/app/scope-modal";

describe("ScopeModal", () => {
  it("offers two scoped actions and a way back", async () => {
    const onPrimary = jest.fn();
    const onSecondary = jest.fn();
    const onCancel = jest.fn();

    await render(
      <ScopeModal
        title="Pausar conta?"
        explanation="E as pendentes?"
        primaryLabel="Manter as deste mês"
        secondaryLabel="Cancelar pendentes (2)"
        secondaryTone="danger"
        onPrimary={onPrimary}
        onSecondary={onSecondary}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("header", { name: "Pausar conta?" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Manter as deste mês" }));
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar pendentes (2)" }));
    await fireEvent.press(screen.getByRole("button", { name: "Voltar" }));

    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
