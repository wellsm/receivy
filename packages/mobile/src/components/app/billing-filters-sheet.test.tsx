import { fireEvent, render, screen } from "@testing-library/react-native";
import { BillingCategory, BillingRecurrence, DEFAULT_BILLING_LIST_FILTERS, Direction } from "@receivy/common";
import { BillingFiltersSheet } from "@/components/app/billing-filters-sheet";

describe("BillingFiltersSheet", () => {
  it("applies the chosen type, frequency and category together", async () => {
    const onApply = jest.fn();

    await render(<BillingFiltersSheet value={DEFAULT_BILLING_LIST_FILTERS} onApply={onApply} onClose={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Tipo Todas" })).toBeSelected();

    await fireEvent.press(screen.getByRole("button", { name: "Tipo A pagar" }));
    await fireEvent.press(screen.getByRole("button", { name: "Frequência Recorrente" }));
    await fireEvent.press(screen.getByRole("button", { name: "Categoria Moradia" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));

    expect(onApply).toHaveBeenCalledWith({ type: Direction.Payable, recurrence: BillingRecurrence.Indefinite, category: BillingCategory.Housing });
  });

  it("clears every group back to the default", async () => {
    const onApply = jest.fn();

    await render(<BillingFiltersSheet value={{ ...DEFAULT_BILLING_LIST_FILTERS, type: Direction.Receivable }} onApply={onApply} onClose={jest.fn()} />);

    await fireEvent.press(screen.getByRole("button", { name: "Limpar" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));

    expect(onApply).toHaveBeenCalledWith(DEFAULT_BILLING_LIST_FILTERS);
  });
});
