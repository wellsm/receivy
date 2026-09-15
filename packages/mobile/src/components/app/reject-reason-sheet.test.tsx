import { fireEvent, render, screen } from "@testing-library/react-native";
import { RejectReasonSheet } from "@/components/app/reject-reason-sheet";

describe("RejectReasonSheet", () => {
  it("confirms with the trimmed reason and cancels without one", async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();

    await render(<RejectReasonSheet visible busy={false} onCancel={onCancel} onConfirm={onConfirm} />);

    await fireEvent.changeText(screen.getByLabelText("Motivo opcional"), "  Não caiu  ");
    await fireEvent.press(screen.getByRole("button", { name: "Não recebi" }));

    expect(onConfirm).toHaveBeenCalledWith("Não caiu");
  });

  it("renders nothing while closed", async () => {
    const { rerender } = await render(<RejectReasonSheet visible={false} busy={false} onCancel={jest.fn()} onConfirm={jest.fn()} />);

    expect(screen.queryByLabelText("Motivo opcional")).toBeNull();

    await rerender(<RejectReasonSheet visible busy={false} onCancel={jest.fn()} onConfirm={jest.fn()} />);

    expect(screen.getByLabelText("Motivo opcional")).toBeOnTheScreen();
  });

  it("clears the reason after a cancel, so reopening starts blank", async () => {
    const onConfirm = jest.fn();
    let visible = true;
    const onCancel = jest.fn(() => {
      visible = false;
    });

    const { rerender } = await render(<RejectReasonSheet visible={visible} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);

    await fireEvent.changeText(screen.getByLabelText("Motivo opcional"), "Não caiu");
    expect(screen.getByLabelText("Motivo opcional").props.value).toBe("Não caiu");

    await fireEvent.press(screen.getByRole("button", { name: "Voltar" }));
    await rerender(<RejectReasonSheet visible={visible} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Motivo opcional")).toBeNull();

    await rerender(<RejectReasonSheet visible busy={false} onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByLabelText("Motivo opcional").props.value).toBe("");
  });
});
