import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProofPanel } from "./proof-panel";
vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: (...args: unknown[]) => fetch(...args as Parameters<typeof fetch>) }));
beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
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
