import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { CopyButton } from "@/components/ui/copy-button";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

describe("CopyButton", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("confirms the copy for three seconds and then returns to its label", async () => {
    await render(<CopyButton value="ana@example.com" accessibilityLabel="Copiar chave" />);

    await fireEvent.press(screen.getByRole("button", { name: "Copiar chave" }));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("ana@example.com");
    expect(await screen.findByText("Copiado")).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(2_999);
    });

    expect(screen.getByText("Copiado")).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.getByText("Copiar")).toBeOnTheScreen();
  });

  it("stays idle and reports when the clipboard refuses", async () => {
    jest.mocked(Clipboard.setStringAsync).mockResolvedValue(false);

    const onRefused = jest.fn();

    await render(<CopyButton value="x" accessibilityLabel="Copiar chave" onRefused={onRefused} />);
    await fireEvent.press(screen.getByRole("button", { name: "Copiar chave" }));

    await act(async () => {});

    expect(onRefused).toHaveBeenCalled();
    expect(screen.queryByText("Copiado")).toBeNull();
  });
});
