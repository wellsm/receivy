import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startLocalProofServer, localProofStorage } from "./local-storage";
import { configuredProofStorage } from "./configured-storage";

describe("explicit local private proof storage", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
  it("requires signatures, limits uploads, and returns attachment-only short downloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "receivy-proof-test-")); cleanups.push(() => rm(dir, { recursive: true }));
    const config = { directory: dir, secret: "local-test-signature-secret-long-enough", origin: "http://localhost:3000" };
    const server = await startLocalProofServer({ ...config, port: 0 }); cleanups.push(server.close);
    const storage = localProofStorage({ ...config, baseUrl: server.url });
    const key = "temporary/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
    const upload = await storage.uploadUrl(key, "application/pdf", 14);
    expect((await fetch(upload, { method: "PUT", headers: { "content-type": "application/pdf" }, body: "%PDF-1.7\nproof" })).status).toBe(204);
    expect((await storage.read(key)).toString()).toBe("%PDF-1.7\nproof");
    expect((await fetch(upload.split("?")[0]!)).status).toBe(403);
    expect((await fetch(upload, { method: "PUT", headers: { "content-type": "application/pdf" }, body: "too much data for intent" })).status).toBe(422);
    const finalKey = key.replace("temporary/", "proofs/");
    await storage.write(finalKey, Buffer.from("%PDF-1.7\nproof"), "application/pdf");
    const download = await fetch(await storage.downloadUrl(finalKey, "application/pdf"));
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(await download.text()).toBe("%PDF-1.7\nproof");
  });
  it("never falls back to local in a production stage or missing mode", () => {
    expect(() => configuredProofStorage({ APP_STAGE: "prd", PROOF_STORAGE_MODE: "local" })).toThrow();
    expect(() => configuredProofStorage({ APP_STAGE: "prd" })).toThrow();
    expect(() => configuredProofStorage({ APP_STAGE: "local", PROOF_STORAGE_MODE: "local" })).toThrow();
  });
});
