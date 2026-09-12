import { fireEvent, render, screen } from "@testing-library/react-native";
import { activeBillingChips, BillingFiltersSheet, DEFAULT_BILLING_FILTERS } from "@/components/app/billing-filters-sheet";

describe("BillingFiltersSheet", () => {
  it("applies the chosen direction with the other filters", async () => {
    const onApply = jest.fn();

    await render(<BillingFiltersSheet value={DEFAULT_BILLING_FILTERS} onApply={onApply} onClose={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Direção Todas" })).toBeSelected();

    await fireEvent.press(screen.getByRole("button", { name: "Direção A pagar" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));

    expect(onApply).toHaveBeenCalledWith({ ...DEFAULT_BILLING_FILTERS, direction: "payable" });
  });

  it("lists the direction as a removable chip only when it narrows the list", () => {
    expect(activeBillingChips(DEFAULT_BILLING_FILTERS)).toEqual([]);
    expect(activeBillingChips({ ...DEFAULT_BILLING_FILTERS, direction: "receivable" })).toEqual([{ key: "direction", label: "A receber" }]);
  });
});
