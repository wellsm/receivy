import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LoginScreen } from "@/components/screens/login-screen";

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("@/auth/oauth", () => ({ loginWithProvider: jest.fn() }));
jest.mock("@/auth/client", () => ({
  authClient: {
    requestEmailCode: jest.fn(),
    oauthProviders: jest.fn().mockResolvedValue({ google: false, apple: false, appleNative: false }),
  },
}));

describe("LoginScreen", () => {
  it("requests a code with the normalized e-mail and never asks for a password", async () => {
    const requestEmailCode = jest.fn().mockResolvedValue(undefined);
    const onCodeRequested = jest.fn();
    await render(<LoginScreen client={{ requestEmailCode }} onCodeRequested={onCodeRequested} />);

    expect(screen.queryByLabelText(/senha/i)).toBeNull();
    expect(screen.getByText("Controle o que tem a receber e a pagar")).toBeOnTheScreen();

    const button = screen.getByRole("button", { name: "Continuar com E-mail" });
    expect(button).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText("Seu e-mail"), "  Ana@Example.com ");
    expect(button).toBeEnabled();
    await fireEvent.press(button);

    await waitFor(() => expect(requestEmailCode).toHaveBeenCalledWith({ email: "ana@example.com" }));
    expect(onCodeRequested).toHaveBeenCalledWith("ana@example.com");
    // Clearing it here would flash the button back to idle while this screen is still on top.
    expect(button).toBeDisabled();
  });

  it("hides provider buttons and the e-mail divider while the API reports them disabled", async () => {
    await render(<LoginScreen client={{ requestEmailCode: jest.fn() }} onCodeRequested={jest.fn()} />);

    expect(screen.queryByRole("button", { name: "Continuar com Google" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continuar com Apple" })).toBeNull();
    expect(screen.queryByText("ou continue com seu e-mail")).toBeNull();
    expect(screen.getByRole("button", { name: "Continuar com E-mail" })).toBeOnTheScreen();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
  });

  it("opens the legal texts from the footer links", async () => {
    await render(<LoginScreen client={{ requestEmailCode: jest.fn() }} onCodeRequested={jest.fn()} />);

    await fireEvent.press(screen.getByRole("link", { name: "Termos" }));

    expect(await screen.findByRole("button", { name: "Fechar" })).toBeOnTheScreen();
    expect(screen.getAllByText("Termos de uso").length).toBeGreaterThan(0);
  });
});
