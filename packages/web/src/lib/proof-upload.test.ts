import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UPLOAD_CONFLICT, UPLOAD_UNCONFIRMED, uploadProofFile } from "./proof-upload";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: (...args: unknown[]) => fetch(...(args as Parameters<typeof fetch>)) }));

const base = "/api/financial/charges/c1";
const file = new File(["%PDF-1.7\nproof"], "recibo.pdf", { type: "application/pdf" });
const ticket = () => Response.json({ uploadUrl: "https://upload.test/put", expiresAt: "2030-01-01" });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("reserves a ticket, PUTs the bytes and polls the charge until the proof is pending", async () => {
  let reads = 0;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "POST") return ticket();
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    return Response.json(++reads < 3 ? { id: "c1", proof: null } : { id: "c1", proof: { state: "pending" } });
  });

  const pending = uploadProofFile(base, file);
  await vi.advanceTimersByTimeAsync(2_000);

  expect((await pending).proof?.state).toBe("pending");
  expect(fetcher.mock.calls[0]?.[0]).toBe(`${base}/proof`);
  expect(fetcher.mock.calls[1]?.[0]).toBe("https://upload.test/put");
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe(file);
  expect(fetcher.mock.calls.filter(([url]) => url === base)).toHaveLength(3);
});

it("gives up after thirty seconds without the bucket event", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "POST") return ticket();
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    return Response.json({ id: "c1", proof: null });
  });

  const failure = uploadProofFile(base, file).catch((reason: Error) => reason.message);
  await vi.advanceTimersByTimeAsync(30_000);

  expect(await failure).toBe(UPLOAD_UNCONFIRMED);
});

it("names the conflict when the charge already has a file under review or on its way", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "conflict" }, { status: 409 }));

  await expect(uploadProofFile(base, file)).rejects.toThrow(UPLOAD_CONFLICT);
});

it("rejects a file the API would refuse before reserving anything", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");

  await expect(uploadProofFile(base, new File(["x"], "notas.txt", { type: "text/plain" }))).rejects.toThrow("Selecione JPG, PNG ou PDF de até 10 MB.");
  expect(fetcher).not.toHaveBeenCalled();
});
