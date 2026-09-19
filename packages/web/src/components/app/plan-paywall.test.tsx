import { PlanErrorCode, PlanTier } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PlanPaywall } from "@/components/app/plan-paywall";

afterEach(cleanup);

it("shows the API reason, the two benefits and a link to the plan page", () => {
  render(<PlanPaywall error={{ code: PlanErrorCode.LimitReached, message: "Você já tem 5 cobranças indefinidas ativas no plano Grátis.", fields: { limit: 5, used: 5, plan: PlanTier.Free } }} onClose={() => undefined} />);

  const dialog = screen.getByRole("dialog", { name: "Plano Básico" });

  expect(dialog).toBeInTheDocument();
  expect(screen.getByText("Você já tem 5 cobranças indefinidas ativas no plano Grátis.")).toBeInTheDocument();
  expect(screen.getByText("Até 30 cobranças indefinidas ativas")).toBeInTheDocument();
  expect(screen.getByText("Links de pagamento (InfinitePay e PagBank)")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver plano" })).toHaveAttribute("href", "/settings/plan");
  // Focus moves into the dialog on mount, the way ScopeDialog does.
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});

it("closes on Agora não and on Escape", async () => {
  const onClose = vi.fn();

  render(<PlanPaywall error={{ code: PlanErrorCode.Required, message: "Links de pagamento fazem parte do plano Básico.", fields: {} }} onClose={onClose} />);

  await userEvent.click(screen.getByRole("button", { name: "Agora não" }));
  await userEvent.keyboard("{Escape}");

  expect(onClose).toHaveBeenCalledTimes(2);
});
