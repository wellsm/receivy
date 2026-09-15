import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChargeState } from "@receivy/common";
import { ProofPanel } from "@/components/app/proof-panel";
const BASE = "/api/public-proof/token";
const STATUS = `${BASE}/proof`;
const COMPLETE = `${STATUS}/complete`;
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
    if (init?.method === "POST") return url === COMPLETE ? pending() : ticket();
    expect(url).toBe(STATUS);
    return stored ? pending() : empty();
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
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
it("completes the upload right after the PUT instead of polling the slot", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    if (init?.method === "POST") return url === COMPLETE ? pending() : ticket();
    return empty();
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf()] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`)).toEqual([`GET ${STATUS}`, `POST ${STATUS}`, "PUT https://upload.test/file", `POST ${COMPLETE}`]);
  expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps the send button busy from the click until the upload is completed", async () => {
  let finishPut: () => void = () => {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "PUT") return new Promise<Response>(resolve => { finishPut = () => resolve(new Response(null, { status: 204 })); });
    if (init?.method === "POST") return url === COMPLETE ? pending() : ticket();
    return empty();
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf()] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  const sending = await screen.findByRole("button", { name: "Enviando…" });
  expect(sending).toBeDisabled();
  expect(sending.getAttribute("aria-busy")).toBe("true");
  finishPut();
  await screen.findByText("Comprovante enviado para revisão.");
  expect(screen.queryByRole("button", { name: "Enviando…" })).toBeNull();
});
it("keeps the flag when the API cannot attach the file so a reload asks again", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    if (init?.method === "POST") return url === COMPLETE ? new Response(null, { status: 500 }) : ticket();
    return uploading();
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  fireEvent.change(await screen.findByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf()] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível confirmar o envio. Atualize a página.");
  expect(sessionStorage.getItem("receivy-proof-upload")).toBe("1");
});
it("completes a started upload after a reload and names the sent file", async () => {
  sessionStorage.setItem("receivy-proof-upload", "1");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => (init?.method === "POST" && url === COMPLETE ? pending("foto.pdf") : uploading()));
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  expect(await screen.findByText("Comprovante enviado para revisão.")).toBeTruthy();
  expect(screen.getByText("foto.pdf")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Apagar e enviar outro" })).toBeEnabled();
  expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull();
});
it("lets the payer send another file after a rejection", async () => {
  let stored = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") { stored = true; return new Response(null, { status: 204 }); }
    if (init?.method === "POST") return _url === COMPLETE ? pending() : ticket();
    return stored ? pending() : Response.json({ state: "rejected", reason: "Ilegível", file: { name: "antigo.pdf", mime: "application/pdf", size: 14 } });
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  await screen.findByText(/Comprovante rejeitado: Ilegível/);
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf("novo.pdf")] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByText("Comprovante enviado para revisão.");
  expect(screen.queryByText(/Comprovante rejeitado/)).toBeNull();
  expect(screen.getByText("novo.pdf")).toBeTruthy();
});
it("does not offer another upload on terminal charges", () => {
  render(<ProofPanel base={BASE} state={ChargeState.Paid} uploadsEnabled={false} />);
  expect(screen.queryByRole("button", { name: "Enviar comprovante" })).toBeNull();
  expect(screen.getByText(/Não pague nem envie/)).toBeTruthy();
});
it("closes the upload action after an accepted status arrives on a stale page", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ state: "accepted", reason: null, file: { name: "recibo.pdf", mime: "application/pdf", size: 14 } }));
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  await screen.findByText(/Não pague nem envie/);
  expect(screen.queryByRole("button", { name: "Enviar comprovante" })).toBeNull();
});
it("forgets a started upload that never became a proof instead of waiting for it", async () => {
  sessionStorage.setItem("receivy-proof-upload", "1");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(empty());
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  await waitFor(() => expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull());
  expect(screen.getByRole("alert").textContent).toBe("O envio anterior não foi concluído. Selecione o arquivo e envie novamente.");
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
});
it("declares a payment without a file and lets the payer take it back", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (init?.method === "POST" && url === `${STATUS}/declaration`) return Response.json({ state: "pending", kind: "declaration", reason: null, file: null });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return empty();
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} creditor="Ana" />);
  fireEvent.click(await screen.findByRole("button", { name: "Já paguei e não tenho comprovante" }));
  expect(await screen.findByText("Pagamento informado · aguardando confirmação de Ana.")).toBeTruthy();
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Já paguei e não tenho comprovante" })).toBeTruthy());
  expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
});
it("does not remember an upload whose bytes never reached the storage", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") throw new Error("storage down");
    if (init?.method === "POST") return ticket();
    return empty();
  });
  render(<ProofPanel base={BASE} state={ChargeState.Pending} />);
  fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [pdf()] } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));
  await screen.findByRole("alert");
  expect(sessionStorage.getItem("receivy-proof-upload")).toBeNull();
  expect(screen.getByLabelText("Comprovante JPG, PNG ou PDF")).toBeEnabled();
  expect(screen.getByText("recibo.pdf")).toBeTruthy();
});
