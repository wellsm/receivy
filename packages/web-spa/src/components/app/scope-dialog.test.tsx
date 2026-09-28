import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CirclePause } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { ScopeDialog } from "@/components/app/scope-dialog";

afterEach(cleanup);

it("offers two scoped actions and a way back", async () => {
  const onPrimary = vi.fn();
  const onSecondary = vi.fn();
  const onCancel = vi.fn();
  const user = userEvent.setup();

  render(<ScopeDialog title="Pausar conta?" icon={CirclePause} explanation="E as pendentes?" primaryLabel="Manter as deste mês" secondaryLabel="Cancelar pendentes (2)" secondaryTone="danger" onPrimary={onPrimary} onSecondary={onSecondary} onCancel={onCancel} />);

  expect(screen.getByRole("dialog", { name: "Pausar conta?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Voltar" })).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Manter as deste mês" }));
  await user.click(screen.getByRole("button", { name: "Cancelar pendentes (2)" }));
  await user.keyboard("{Escape}");

  expect(onPrimary).toHaveBeenCalledTimes(1);
  expect(onSecondary).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
});
