import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UPLOAD_CONFLICT, UPLOAD_UNCONFIRMED, uploadProofFile } from "./proof-upload";

const API = "https://api.test";
const base = "charges/c1";
const file = new File(["%PDF-1.7\nproof"], "recibo.pdf", { type: "application/pdf" });
const ticket = () => Response.json({ uploadUrl: "https://upload.test/put", expiresAt: "2030-01-01" });

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("reserves a ticket, PUTs the bytes and completes the upload", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "PUT") {
      return new Response(null, { status: 204 });
    }
    if (url === `${API}/${base}/proof/complete`) {
      return Response.json({ id: "c1", proof: { state: "pending" } });
    }

    return ticket();
  });

  expect((await uploadProofFile(base, file)).proof?.state).toBe("pending");
  expect(fetcher.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toEqual([
    `POST ${API}/${base}/proof`,
    "PUT https://upload.test/put",
    `POST ${API}/${base}/proof/complete`,
  ]);
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe(file);
});

it("explains an upload the API could not complete", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "PUT") {
      return new Response(null, { status: 204 });
    }
    if (url === `${API}/${base}/proof/complete`) {
      return new Response(null, { status: 500 });
    }

    return ticket();
  });

  await expect(uploadProofFile(base, file)).rejects.toThrow(UPLOAD_UNCONFIRMED);
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

it("reports a PUT that never reached the storage with the upload failure copy", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") {
      throw new TypeError("Failed to fetch");
    }

    return ticket();
  });

  const failure = uploadProofFile(base, file);

  await expect(failure).rejects.toThrow("O arquivo não foi enviado. Aguarde cinco minutos para iniciar outro envio.");
  await expect(failure).rejects.not.toThrow(/failed to fetch/i);
});
