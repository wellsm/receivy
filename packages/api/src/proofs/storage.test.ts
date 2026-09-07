import { afterEach, expect, it, vi } from "vitest";
import { s3ProofStorage } from "./storage";
afterEach(() => vi.unstubAllEnvs());
it("signs upload size and MIME and makes downloads attachment-only for 60 seconds", async () => {
  vi.stubEnv("AWS_REGION", "sa-east-1"); vi.stubEnv("AWS_ACCESS_KEY_ID", "LOCALFAKEKEY"); vi.stubEnv("AWS_SECRET_ACCESS_KEY", "local-only-fake-secret");
  const storage = s3ProofStorage("test-receivy-proof-files-example");
  const upload = new URL(await storage.uploadUrl("temporary/random/key", "application/pdf", 14));
  expect(upload.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
  expect(upload.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
  expect(upload.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(upload.searchParams.has("x-amz-checksum-crc32")).toBe(false);
  const download = new URL(await storage.downloadUrl("proofs/random/key", "application/pdf"));
  expect(download.searchParams.get("response-content-disposition")).toBe('attachment; filename="comprovante.pdf"');
  expect(download.searchParams.get("X-Amz-Expires")).toBe("60");
});
