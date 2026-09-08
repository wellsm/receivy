import { describe, expect, it, vi } from "vitest";
import { createEmailTransport } from "./transport";
import { createResendSender } from "./vendors/resend";
import { createDisabledSender } from "./disabled";

describe("login code email transport", () => {
  it("sends the login code through the Resend vendor without logging its body", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "email-1" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const transport = createEmailTransport(createResendSender({ apiKey: "resend-key", fetch }), "Receivy <login@example.com>");

    await transport.sendLoginCode({ email: "ana@example.com", code: "123456" });

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer resend-key");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "Receivy <login@example.com>", to: ["ana@example.com"] });
    expect(String(init.body)).toContain("123456");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("stays silent on the disabled sender and fails closed on delivery failure", async () => {
    await expect(createEmailTransport(createDisabledSender(), "disabled").sendLoginCode({ email: "ana@example.com", code: "123456" })).resolves.toBeUndefined();
    const failing = createResendSender({ apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response(null, { status: 500 })) });
    await expect(createEmailTransport(failing, "Receivy <login@example.com>").sendLoginCode({ email: "ana@example.com", code: "123456" })).rejects.toThrow("Email delivery failed");
  });
});
