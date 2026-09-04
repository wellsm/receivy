import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { CodeScreen } from "./code-screen";

describe("CodeScreen", () => {
  it("accepts exactly six digits and confirms against the in-memory email", async () => {
    const confirmEmailCode = jest.fn().mockResolvedValue({});
    const onAuthenticated = jest.fn();
    await render(
      <CodeScreen
        email="ana@example.com"
        client={{ confirmEmailCode, requestEmailCode: jest.fn() }}
        onAuthenticated={onAuthenticated}
      />,
    );

    await fireEvent.changeText(screen.getByLabelText("Código de 6 dígitos"), "12a3456");
    await fireEvent.press(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(confirmEmailCode).toHaveBeenCalledWith({
      email: "ana@example.com",
      code: "123456",
    }));
    expect(onAuthenticated).toHaveBeenCalled();
  });
});
