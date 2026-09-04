import { describe, expect, it, vi } from "vitest";
import { createEmailTransport } from "./transport";

describe("email transport", () => {
  it("sends the login code through Resend without logging its body", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const transport = createEmailTransport({
      apiKey: "resend-key",
      from: "Receivy <login@example.com>",
      mode: "resend",
      fetch,
    });

    await transport.sendLoginCode({ email: "ana@example.com", code: "123456" });

    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
    }));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("supports a silent disabled transport for local development", async () => {
    const fetch = vi.fn();
    const transport = createEmailTransport({ mode: "disabled", fetch });

    await expect(transport.sendLoginCode({ email: "ana@example.com", code: "123456" })).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
