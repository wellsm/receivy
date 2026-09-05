import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LoginScreen } from "./login-screen";

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("@/auth/oauth", () => ({ loginWithProvider: jest.fn() }));

describe("LoginScreen", () => {
  it("requests a code without rendering any password field", async () => {
    const requestEmailCode = jest.fn().mockResolvedValue(undefined);
    const onCodeRequested = jest.fn();
    await render(
      <LoginScreen
        client={{ requestEmailCode }}
        onCodeRequested={onCodeRequested}
      />,
    );

    expect(screen.queryByLabelText(/senha/i)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Seu e-mail"), "ana@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Receber código" }));

    await waitFor(() => expect(requestEmailCode).toHaveBeenCalledWith({ email: "ana@example.com" }));
    expect(onCodeRequested).toHaveBeenCalledWith("ana@example.com");
  });
});
