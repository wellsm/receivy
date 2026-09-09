import type { AuthUser } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

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

function profile(email = "conta@example.com") {
  const user = { id: "u1", email, name: null, avatarUrl: null, locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL" } satisfies AuthUser;

  return { load: jest.fn().mockResolvedValue(user) };
}

describe("PixSettingsScreen", () => {
  it("preserves the Pix draft when the mutation fails", async () => {
    const savePaymentMethod = jest.fn().mockRejectedValue(new Error("Chave inválida."));
    await render(<PixSettingsScreen client={client({ savePaymentMethod })} profile={profile("")} />);
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
    await render(<PixSettingsScreen client={client({ paymentMethods, savePaymentMethod })} profile={profile("")} />);
    await fireEvent.changeText(screen.getByLabelText("Chave Pix"), "pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar chave" }));
    expect(await screen.findByText("Chave salva, mas não foi possível atualizar a lista agora.")).toBeOnTheScreen();
    expect(screen.queryByText("Chaves Pix atualizadas.")).toBeNull();
    expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("");
  });

  it("prefills the e-mail key with the account e-mail and keeps it editable", async () => {
    await render(<PixSettingsScreen client={client()} profile={profile()} />);

    await waitFor(() => expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("conta@example.com"));

    await fireEvent.changeText(screen.getByLabelText("Chave Pix"), "outra@example.com");

    expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("outra@example.com");
  });

  it("saves the prefilled account e-mail as the key", async () => {
    const savePaymentMethod = jest.fn().mockResolvedValue({ id: "pix-1" });
    await render(<PixSettingsScreen client={client({ savePaymentMethod })} profile={profile()} />);

    await waitFor(() => expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("conta@example.com"));
    await fireEvent.press(screen.getByRole("button", { name: "Salvar chave" }));

    await waitFor(() => expect(savePaymentMethod).toHaveBeenCalledWith({ pixKeyType: "email", pixKey: "conta@example.com", label: undefined }, undefined));
  });

  it("starts the key over when another type is picked", async () => {
    await render(<PixSettingsScreen client={client()} profile={profile()} />);

    await waitFor(() => expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("conta@example.com"));
    await fireEvent.press(screen.getByRole("button", { name: "CPF" }));

    expect(screen.getByLabelText("Chave Pix")).toHaveDisplayValue("");
  });

  it("announces why the Pix key is required when the billing form asked for it", async () => {
    await render(<PixSettingsScreen client={client()} profile={profile("")} required />);

    expect(await screen.findByText("Você precisa de uma chave Pix para criar cobranças.")).toBeOnTheScreen();
  });

  it("hides the required notice on a plain visit", async () => {
    await render(<PixSettingsScreen client={client()} profile={profile("")} />);

    expect(screen.queryByText("Você precisa de uma chave Pix para criar cobranças.")).toBeNull();
  });

  it("hands the new key back to the billing form once", async () => {
    const savePaymentMethod = jest.fn().mockResolvedValue({ id: "pix-1" });
    const onCreated = jest.fn();
    await render(<PixSettingsScreen client={client({ savePaymentMethod })} profile={profile("")} onCreated={onCreated} />);

    await fireEvent.changeText(screen.getByLabelText("Chave Pix"), "pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar chave" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "pix-1" }));
  });

  it("no longer draws its own back link, the native header owns it", async () => {
    await render(<PixSettingsScreen client={client()} profile={profile("")} />);

    expect(screen.queryByText("← Perfil")).toBeNull();
  });
});
