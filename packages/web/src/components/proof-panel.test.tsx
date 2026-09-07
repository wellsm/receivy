import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProofPanel } from "./proof-panel";
vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: (...args: unknown[]) => fetch(...args as Parameters<typeof fetch>) }));
beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
afterEach(cleanup);
it("uploads the selected bytes then finalizes and shows pending review", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ id: "intent", uploadUrl: "https://upload.test/file", expiresAt: "2027-01-01" }))
    .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(Response.json({ state: "pending" }));
  render(<ProofPanel base="/api/public-proof/token" state="pending" publicView uploadsEnabled />);
  const file = new File(["%PDF-1.7\nproof"], "recibo.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe(file);
  expect(fetcher.mock.calls[2]?.[0]).toBe("/api/public-proof/token/uploads/intent/finalize");
});
it("does not offer another upload on terminal charges", () => {
  render(<ProofPanel base="/api/public-proof/token" state="paid" publicView uploadsEnabled={false} />);
  expect(screen.queryByRole("button", { name: "Enviar comprovante" })).toBeNull();
  expect(screen.getByText(/Não pague nem envie/)).toBeTruthy();
});
it("closes the upload action after an accepted public status arrives on a stale page", async () => {
  sessionStorage.setItem("receivy-proof-intent", "intent");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ state: "accepted", reason: null, closureReason: null }));
  render(<ProofPanel base="/api/public-proof/token" state="pending" publicView uploadsEnabled />);
  await screen.findByText(/Não pague nem envie/);
  expect(screen.queryByRole("button", { name: "Enviar comprovante" })).toBeNull();
});
it("allows creditor review only while charge and proof are pending", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ proofs: [{ id: "p", originalName: "recibo.pdf", state: "rejected", closureReason: "paid", reason: "system" }] }));
  render(<ProofPanel base="/api/financial/charges/id/proofs" state="paid" creditor />);
  await waitFor(() => expect(screen.getByText("Encerrado porque a cobrança foi paga manualmente.")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Aceitar comprovante" })).toBeNull();
});
it("allows replacing a definitively rejected file with a new upload intent", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ id: "bad-intent", uploadUrl: "https://upload.test/bad", expiresAt: new Date(Date.now() + 300_000).toISOString() }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ message: "Arquivo inválido." }, { status: 422 }))
    .mockResolvedValueOnce(Response.json({ id: "replacement", uploadUrl: "https://upload.test/replacement", expiresAt: new Date(Date.now() + 300_000).toISOString() }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ state: "pending" }));
  render(<ProofPanel base="/api/public-proof/token" state="pending" publicView />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
  const valid = new File(["%PDF-1.7\nproof"], "valid.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [valid] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(JSON.parse(fetcher.mock.calls[3]?.[1]?.body as string)).toEqual({ filename: "valid.pdf", mime: "application/pdf", size: 14 });
  expect(fetcher.mock.calls[4]?.[1]?.body).toBe(valid);
});
it("clears an expired intent so the selected file can be replaced without reloading", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ id: "short-intent", uploadUrl: "https://upload.test/short", expiresAt: new Date(Date.now() + 50).toISOString() }))
    .mockRejectedValueOnce(new Error("network unavailable"));
  render(<ProofPanel base="/api/public-proof/token" state="pending" publicView />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [new File(["pdf"], "proof.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled());
  expect(screen.getByRole("button", { name: "Enviar comprovante" })).toBeDisabled();
});
it("retains the same unexpired intent and file for a transient upload retry", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ id: "retry-intent", uploadUrl: "https://upload.test/retry", expiresAt: new Date(Date.now() + 300_000).toISOString() }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ state: "pending" }));
  render(<ProofPanel base="/api/public-proof/token" state="pending" publicView />);
  const file = new File(["%PDF-1.7\nproof"], "proof.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(fetcher.mock.calls[2]?.[0]).toBe("https://upload.test/retry");
  expect(fetcher.mock.calls[2]?.[1]?.body).toBe(file);
});
it.each(["lost response", "already finalized"])("recovers a committed proof after %s without claiming failure", async failure => {
  let savedAtFinalize: string | null = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (url === "https://upload.test/recover") return new Response(null, { status: 204 });
    if (String(url).endsWith("/finalize")) {
      savedAtFinalize = sessionStorage.getItem("receivy-proof-intent");
      if (failure === "lost response") throw new Error("connection lost after commit");
      return Response.json({ message: "Já finalizado." }, { status: 409 });
    }
    if (init?.method === "POST") return Response.json({ id: "recover-intent", uploadUrl: "https://upload.test/recover", expiresAt: new Date(Date.now() + 300_000).toISOString() });
    return Response.json({ state: "pending", reason: null, closureReason: null });
  });
  render(<ProofPanel base="/api/public-proof/token" state="pending" publicView />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [new File(["%PDF-1.7\nproof"], "proof.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(savedAtFinalize).toBe("recover-intent");
  expect(screen.queryByRole("alert")).toBeNull();
});
it.each(["reload", "manual verification"])("recovers through %s when commit response and first status lookup are lost", async recovery => {
  let statusReads = 0;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (url === "https://upload.test/reload") return new Response(null, { status: 204 });
    if (String(url).endsWith("/finalize")) throw new Error("connection lost after commit");
    if (init?.method === "POST") return Response.json({ id: "reload-intent", uploadUrl: "https://upload.test/reload", expiresAt: new Date(Date.now() + 300_000).toISOString() });
    return ++statusReads === 1 ? new Response(null, { status: 503 }) : Response.json({ state: "pending", reason: null, closureReason: null });
  });
  const view = render(<ProofPanel base="/api/public-proof/token" state="pending" publicView />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [new File(["%PDF-1.7\nproof"], "proof.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText(/Não foi possível confirmar o envio/);
  expect(sessionStorage.getItem("receivy-proof-intent")).toBe("reload-intent");
  if (recovery === "reload") {
    view.unmount();
    render(<ProofPanel base="/api/public-proof/token" state="pending" publicView />);
  } else fireEvent.click(screen.getByRole("button", { name: "Verificar envio" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/finalize"))).toHaveLength(1);
});
