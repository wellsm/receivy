import { afterEach, expect, it, vi } from "vitest";
import { uploadAvatar } from "./avatar-upload";

afterEach(() => vi.restoreAllMocks());

it("reserves, puts the bytes and completes the upload", async () => {
  const blob = new Blob(["jpeg"], { type: "image/jpeg" });
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (url === "/api/financial/account/avatar") return Response.json({ uploadUrl: "https://bucket.test/put", expiresAt: "2026-09-13T12:05:00.000Z" });
    if (url === "https://bucket.test/put") return new Response(null, { status: 200 });
    if (url === "/api/financial/account/avatar/complete") return Response.json({ avatar: { url: "https://bucket.test/get", version: "v2" } });
    throw new Error(`unexpected ${String(url)} ${init?.method}`);
  });

  await expect(uploadAvatar(blob)).resolves.toEqual({ url: "https://bucket.test/get", version: "v2" });

  expect(fetcher.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toEqual([
    "POST /api/financial/account/avatar",
    "PUT https://bucket.test/put",
    "POST /api/financial/account/avatar/complete",
  ]);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ mime: "image/jpeg" });
});

it("explains a rejected file", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (url === "/api/financial/account/avatar") return Response.json({ uploadUrl: "https://bucket.test/put", expiresAt: "x" });
    if (url === "https://bucket.test/put") return new Response(null, { status: 200 });
    return Response.json({ message: "Envie uma imagem JPG ou PNG de até 2 MB." }, { status: 422 });
  });

  await expect(uploadAvatar(new Blob(["x"], { type: "image/jpeg" }))).rejects.toThrow("Envie uma imagem JPG ou PNG de até 2 MB.");
});
