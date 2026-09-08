import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailSender } from "./factory";

const message = { from: "Receivy <login@receivy.local>", to: "ana@example.com", subject: "Seu código de acesso ao Receivy", text: "Seu código de acesso é 123456." };
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const tempDirectory = () => { const directory = mkdtempSync(join(tmpdir(), "receivy-emails-")); directories.push(directory); return directory; };

describe("email sender factory", () => {
  it("drops mail silently when the transport is disabled or unset", async () => {
    for (const transport of ["disabled", undefined]) {
      const sender = createEmailSender({ transport, stage: "local" });
      expect(sender.mode).toBe("disabled");
      expect(await sender.send(message)).toEqual({ status: "disabled" });
    }
  });

  it("writes an .eml file under the directory in file mode, only for the local stage", async () => {
    const directory = tempDirectory();
    const sender = createEmailSender({ transport: "file", stage: "local", fileDirectory: directory });
    const result = await sender.send({ ...message, key: "delivery-1" });
    expect(result.status).toBe("accepted");
    const [file] = readdirSync(directory);
    expect(file).toMatch(/^\d{4}-\d{2}-\d{2}T.*-seu-codigo-de-acesso-ao-receivy-[a-f0-9]{6}\.eml$/);
    const content = readFileSync(join(directory, file!), "utf8");
    expect(content).toContain("To: ana@example.com");
    expect(content).toContain("Subject: Seu código de acesso ao Receivy");
    expect(content).toContain("X-Receivy-Key: delivery-1");
    expect(content.endsWith("Seu código de acesso é 123456.\n")).toBe(true);
    for (const stage of ["dev", "prd", "test", undefined]) {
      expect(() => createEmailSender({ transport: "file", stage, fileDirectory: directory })).toThrow(/APP_STAGE=local/);
    }
  });

  it("requires an API key for resend and rejects unknown transports at construction", () => {
    expect(() => createEmailSender({ transport: "resend", stage: "dev" })).toThrow(/RESEND_API_KEY/);
    expect(() => createEmailSender({ transport: "resend", stage: "dev", apiKey: "disabled" })).toThrow(/RESEND_API_KEY/);
    expect(() => createEmailSender({ transport: "smtp", stage: "dev" })).toThrow(/Unknown email transport/);
    expect(createEmailSender({ transport: "resend", stage: "dev", apiKey: "key", fetch: vi.fn() }).mode).toBe("resend");
  });

  it("maps Resend outcomes without exposing provider bodies", async () => {
    const outcomes: [Response, string][] = [
      [Response.json({ id: "abc" }), "accepted"],
      [Response.json({}), "uncertain"],
      [new Response("rate limited", { status: 429 }), "transient"],
      [new Response("bad request detail", { status: 422 }), "permanent"],
    ];
    for (const [response, status] of outcomes) {
      const sender = createEmailSender({ transport: "resend", stage: "dev", apiKey: "key", fetch: vi.fn().mockResolvedValue(response) });
      expect((await sender.send(message)).status).toBe(status);
    }
    const offline = createEmailSender({ transport: "resend", stage: "dev", apiKey: "key", fetch: vi.fn().mockRejectedValue(new Error("offline")) });
    expect(await offline.send(message)).toEqual({ status: "uncertain" });
  });
});
