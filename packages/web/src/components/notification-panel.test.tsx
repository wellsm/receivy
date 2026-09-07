import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { NotificationPanel } from "./notification-panel";
vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("requests a manual reminder explicitly and never claims queued means delivered", async () => {
  vi.mocked(browserFetch).mockResolvedValue(
    Response.json({ queued: true }, { status: 202 }),
  );
  render(<NotificationPanel id="charge" canRemind />);
  fireEvent.click(screen.getByRole("button", { name: "Enviar lembrete" }));
  expect(
    await screen.findByText(/Isso não confirma a entrega/),
  ).toBeInTheDocument();
  expect(browserFetch).toHaveBeenCalledWith(
    "/api/financial/charges/charge/reminders",
    { method: "POST" },
  );
});
it("keeps uncertain delivery visible and hides reminder action for a terminal/debtor view", async () => {
  vi.mocked(browserFetch).mockResolvedValue(
    Response.json({
      deliveries: [
        {
          id: "delivery",
          channel: "push",
          template: "initial",
          state: "uncertain",
          attempts: 1,
        },
      ],
    }),
  );
  render(<NotificationPanel id="charge" canRemind={false} />);
  expect(screen.queryByText("Enviar lembrete")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Consultar envios" }));
  expect(
    await screen.findByText(/Resultado incerto — sem reenvio automático/),
  ).toBeInTheDocument();
});
