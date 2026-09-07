import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { NotificationSettings } from "./notification-settings";
vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("loads, saves recipient preferences and revokes a device without exposing its token", async () => {
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method === "PATCH")
      return Response.json(JSON.parse(init.body as string));
    return Response.json(
      String(path).endsWith("devices")
        ? {
            devices: [
              {
                id: "device",
                platform: "ios",
                active: true,
                createdAt: "2026-09-07",
              },
            ],
          }
        : {
            emailEnabled: true,
            pushEnabled: true,
            reminderOffsets: [-3, 0, 2],
          },
    );
  });
  render(<NotificationSettings />);
  fireEvent.click(await screen.findByLabelText("Receber e-mail"));
  fireEvent.click(screen.getByRole("button", { name: "Salvar notificações" }));
  expect(await screen.findByText("Preferências salvas.")).toBeInTheDocument();
  await waitFor(() =>
    expect(browserFetch).toHaveBeenCalledWith(
      "/api/financial/notification-preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          emailEnabled: false,
          pushEnabled: true,
          reminderOffsets: [-3, 0, 2],
        }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remover ios" }));
  await waitFor(() =>
    expect(browserFetch).toHaveBeenCalledWith("/api/financial/devices/device", {
      method: "DELETE",
    }),
  );
});
