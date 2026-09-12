import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProofPanel } from "@/components/app/proof-panel";
const BASE = "/api/public-proof/token";
const STATUS = `${BASE}/proof`;
const ticket = () => Response.json({ uploadUrl: "https://upload.test/file", expiresAt: new Date(Date.now() + 300_000).toISOString() });
const empty = () => Response.json({ state: null, reason: null, file: null });
const pending = (name = "recibo.pdf") => Response.json({ state: "pending", reason: null, file: { name, mime: "application/pdf", size: 14 } });
const uploading = () => Response.json({ state: "uploading", reason: null, file: null });
function pdf(name = "recibo.pdf") { return new File(["%PDF-1.7\nproof"], name, { type: "application/pdf" }); }
beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("shows the selected file in place of the dropzone, then lets the payer delete the sent proof and pick another", async () => {
  let stored = false;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "DELETE") { stored = false; return new Response(null, { status: 204 }); }
    if (init?.method === "PUT") { stored = true; return new Response(null, { status: 204 }); }
    if (init?.method === "POST") return ticket();
    expect(url).toBe(STATUS);
    return stored ? pending() : empty();
  });
  render(<ProofPanel base={BASE} state="pending" />);
  const file = pdf();
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [file] } });
  expect(screen.getByText("recibo.pdf")).toBeTruthy();
  expect(screen.getByText("Trocar arquivo")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(screen.getByText("recibo.pdf")).toBeTruthy();
  const reserve = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
  expect(reserve?.[0]).toBe(STATUS);
  expect(JSON.parse(reserve?.[1]?.body as string)).toEqual({ filename: "recibo.pdf", mime: "application/pdf", size: 14 });
  expect(fetcher.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body).toBe(file);
  fireEvent.click(screen.getByRole("button", { name: "Apagar e enviar outro" }));
  await waitFor(() => expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled());
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(STATUS);
  expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull();
  expect(screen.queryByText("Comprovante enviado para revisão.")).toBeNull();
});
it("polls the slot after the PUT until the bucket event turns it into a proof", async () => {
  vi.useFakeTimers();
  let reads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    if (init?.method === "POST") return ticket();
    reads += 1;
    if (reads === 1) return empty();
    return reads < 4 ? uploading() : pending();
  });
  await act(async () => { render(<ProofPanel base={BASE} state="pending" />); });
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf()] } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" })); });
  expect(screen.queryByText("Comprovante enviado para revisão.")).toBeNull();
  expect(sessionStorage.getItem("receivy-proof-upload")).toBe("1");
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(screen.getByText("Comprovante enviado para revisão.")).toBeTruthy();
  expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("gives up after thirty seconds but keeps the flag so a reload asks again", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    if (init?.method === "POST") return ticket();
    return uploading();
  });
  await act(async () => { render(<ProofPanel base={BASE} state="pending" />); });
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf()] } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole("alert").textContent).toBe("Não foi possível confirmar o envio. Atualize a página.");
  expect(sessionStorage.getItem("receivy-proof-upload")).toBe("1");
});
it("re-polls a started upload after a reload and names the sent file", async () => {
  vi.useFakeTimers();
  sessionStorage.setItem("receivy-proof-upload", "1");
  let reads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => (++reads < 2 ? uploading() : pending("foto.pdf")));
  await act(async () => { render(<ProofPanel base={BASE} state="pending" />); });
  expect(screen.queryByText("Comprovante enviado para revisão.")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(screen.getByText("Comprovante enviado para revisão.")).toBeTruthy();
  expect(screen.getByText("foto.pdf")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Apagar e enviar outro" })).toBeEnabled();
  expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull();
});
it("lets the payer send another file after a rejection", async () => {
  let stored = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") { stored = true; return new Response(null, { status: 204 }); }
    if (init?.method === "POST") return ticket();
    return stored ? pending() : Response.json({ state: "rejected", reason: "Ilegível", file: { name: "antigo.pdf", mime: "application/pdf", size: 14 } });
  });
  render(<ProofPanel base={BASE} state="pending" />);
  await screen.findByText(/Comprovante rejeitado: Ilegível/);
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf("novo.pdf")] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(screen.queryByText(/Comprovante rejeitado/)).toBeNull();
  expect(screen.getByText("novo.pdf")).toBeTruthy();
});
it("does not offer another upload on terminal charges", () => {
  render(<ProofPanel base={BASE} state="paid" uploadsEnabled={false} />);
  expect(screen.queryByRole("button", { name: "Enviar comprovante" })).toBeNull();
  expect(screen.getByText(/Não pague nem envie/)).toBeTruthy();
});
it("closes the upload action after an accepted status arrives on a stale page", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ state: "accepted", reason: null, file: { name: "recibo.pdf", mime: "application/pdf", size: 14 } }));
  render(<ProofPanel base={BASE} state="pending" />);
  await screen.findByText(/Não pague nem envie/);
  expect(screen.queryByRole("button", { name: "Enviar comprovante" })).toBeNull();
});
it("forgets a started upload that never became a proof instead of waiting for it", async () => {
  sessionStorage.setItem("receivy-proof-upload", "1");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(empty());
  render(<ProofPanel base={BASE} state="pending" />);
  await waitFor(() => expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull());
  expect(screen.getByRole("alert").textContent).toBe("O envio anterior não foi concluído. Selecione o arquivo e envie novamente.");
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
});
it("does not remember an upload whose bytes never reached the storage", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") throw new Error("storage down");
    if (init?.method === "POST") return ticket();
    return empty();
  });
  render(<ProofPanel base={BASE} state="pending" />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf()] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByRole("alert");
  expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull();
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
  expect(screen.getByText("recibo.pdf")).toBeTruthy();
});
