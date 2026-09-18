import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { CodeScreen } from "@/components/screens/code-screen";

const SENT_AT = Date.parse("2026-09-08T12:00:00Z");

function clock(offsetMs = 0) {
  let current = SENT_AT + offsetMs;

  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("CodeScreen", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("accepts exactly six digits and confirms against the in-memory email", async () => {
    const confirmEmailCode = jest.fn().mockResolvedValue({});
    const onAuthenticated = jest.fn();
    const time = clock();

    await render(
      <CodeScreen
        email="lucas@email.com"
        sentAt={SENT_AT}
        now={time.now}
        client={{ confirmEmailCode, requestEmailCode: jest.fn() }}
        onAuthenticated={onAuthenticated}
      />,
    );

    expect(screen.getByText("luc***@email.com")).toBeOnTheScreen();
    expect(screen.getByText("10:00")).toBeOnTheScreen();
    expect(screen.queryByText(/WhatsApp|suporte/i)).toBeNull();

    const confirm = screen.getByRole("button", { name: "Confirmar e Entrar" });

    expect(confirm).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText("Código de 6 dígitos"), "12a3456");

    expect(confirm).toBeEnabled();

    await fireEvent.press(confirm);

    await waitFor(() => expect(confirmEmailCode).toHaveBeenCalledWith({ email: "lucas@email.com", code: "123456" }));

    expect(onAuthenticated).toHaveBeenCalled();
    // Clearing it here would flash the button back to idle while this screen is still on top.
    expect(confirm).toBeDisabled();
  });

  it("counts down to expiry and then refuses the code until a new one is sent", async () => {
    const time = clock();

    await render(
      <CodeScreen
        email="ana@example.com"
        sentAt={SENT_AT}
        now={time.now}
        client={{ confirmEmailCode: jest.fn(), requestEmailCode: jest.fn().mockResolvedValue(undefined) }}
        onAuthenticated={jest.fn()}
      />,
    );

    await fireEvent.changeText(screen.getByLabelText("Código de 6 dígitos"), "123456");

    time.advance(4 * 60_000 + 3_000);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("05:57")).toBeOnTheScreen();

    time.advance(6 * 60_000);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Código expirado. Peça um novo código.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Confirmar e Entrar" })).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Reenviar código" }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("10:00")).toBeOnTheScreen();
    expect(screen.getByLabelText("Código de 6 dígitos")).toHaveDisplayValue("");
  });

  it("holds the resend button for the server cooldown after sending", async () => {
    const requestEmailCode = jest.fn().mockResolvedValue(undefined);
    const time = clock();

    await render(
      <CodeScreen
        email="ana@example.com"
        sentAt={SENT_AT}
        now={time.now}
        client={{ confirmEmailCode: jest.fn(), requestEmailCode }}
        onAuthenticated={jest.fn()}
      />,
    );

    const resend = screen.getByRole("button", { name: "Reenviar código" });

    expect(resend).toBeDisabled();
    expect(screen.getByText("Reenviar em 01:00")).toBeOnTheScreen();

    time.advance(61_000);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("button", { name: "Reenviar código" })).toBeEnabled();

    await fireEvent.press(screen.getByRole("button", { name: "Reenviar código" }));
    await waitFor(() => expect(requestEmailCode).toHaveBeenCalledWith({ email: "ana@example.com" }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("button", { name: "Reenviar código" })).toBeDisabled();
  });
});
