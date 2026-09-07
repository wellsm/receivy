import { fireEvent, render, screen } from "@testing-library/react-native";

import { PixSettingsScreen } from "./pix-settings-screen";

function client(overrides: Partial<Record<"paymentMethods" | "savePaymentMethod" | "defaultPaymentMethod" | "archivePaymentMethod", jest.Mock>> = {}) {
  return {
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }),
    savePaymentMethod: jest.fn(),
    defaultPaymentMethod: jest.fn(),
    archivePaymentMethod: jest.fn(),
    ...overrides,
  };
}

describe("PixSettingsScreen", () => {
  it("preserves the Pix draft when the mutation fails", async () => {
    const savePaymentMethod = jest.fn().mockRejectedValue(new Error("Chave inválida."));
    await render(<PixSettingsScreen client={client({ savePaymentMethod })} />);
    await fireEvent.changeText(screen.getByLabelText("Chave Pix"), "pix@example.com");
    await fireEvent.changeText(screen.getByLabelText("Nome da chave"), "Principal");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar chave" }));
    expect(await screen.findByText("Chave inválida.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("pix@example.com");
    expect(screen.getByLabelText("Nome da chave")).toHaveDisplayValue("Principal");
  });

  it("reports a saved mutation separately when refreshing the list fails", async () => {
    const paymentMethods = jest.fn().mockResolvedValueOnce({ paymentMethods: [] }).mockRejectedValueOnce(new Error("Sem conexão para atualizar."));
    const savePaymentMethod = jest.fn().mockResolvedValue({ id: "pix-1" });
    await render(<PixSettingsScreen client={client({ paymentMethods, savePaymentMethod })} />);
    await fireEvent.changeText(screen.getByLabelText("Chave Pix"), "pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar chave" }));
    expect(await screen.findByText("Chave salva, mas não foi possível atualizar a lista agora.")).toBeOnTheScreen();
    expect(screen.queryByText("Chaves Pix atualizadas.")).toBeNull();
    expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("");
  });
});
