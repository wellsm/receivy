import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chargeShareText, type ChargeDetail, type ChargeProof } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ChargeDetailScreen } from "@/components/screens/charge-detail-screen";

const routerMock = { push: vi.fn(), replace: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function charge(overrides: Partial<ChargeDetail> = {}): ChargeDetail {
  return {
    id: "charge",
    direction: "payable",
    description: "Aluguel",
    amount: { amountCents: 2500, currency: "BRL" },
    dueDate: "2026-09-10",
    state: "pending",
    billingId: "b1",
    billingType: "until",
    installment: 2,
    installmentCount: 3,
    counterpartName: "Ana",
    proofState: null,
    recipient: { userId: "u1", name: "Ana", email: null },
    debtorUserId: "u1",
    pix: { keyType: "email", key: "pix@example.com", label: "Principal" },
    sharingState: "ready",
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01",
    ...overrides,
  };
}

function proof(overrides: Partial<ChargeProof> = {}): ChargeProof {
  return {
    state: "pending",
    file: { name: "comprovante.pdf", mime: "application/pdf", size: 184 * 1024 },
    sentAt: "2026-09-05T14:32:00Z",
    reviewedAt: null,
    reason: null,
    sentByViewer: false,
    ...overrides,
  };
}

/** Routes the BFF calls the screen makes; unknown paths answer with the charge itself. */
function serve(detail: ChargeDetail, extra: Record<string, () => Response> = {}) {
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    const key = `${init?.method ?? "GET"} ${String(path)}`;
    const handler = Object.entries(extra).find(([route]) => route === key)?.[1];

    if (handler) {
      return handler();
    }

    return Response.json(detail);
  });
}

/** Every "marcar pago" entry point asks first; this answers the dialog. */
async function confirmMarkPaid() {
  const dialog = await screen.findByRole("dialog", { name: "Marcar como paga?" });

  fireEvent.click(within(dialog).getByRole("button", { name: "Marcar paga" }));
}

describe("ChargeDetailScreen", () => {
  it("selects an owned Pix explicitly before first publication", async () => {
    serve(charge({ direction: "receivable", pix: null, sharingState: "pix_required" }), {
      "GET /api/financial/payment-methods": () => Response.json({ paymentMethods: [{ id: "method", label: "Principal", pixKey: "pix@example.com", pixKeyType: "email" }] }),
      "POST /api/financial/charges/charge/public-link": () => Response.json({ token: "fixture", expiresAt: "2030-01-01" }),
    });

    render(<ChargeDetailScreen id="charge" />);

    await screen.findByRole("option", { name: "EMAIL · pix@example.com" });
    fireEvent.change(await screen.findByLabelText("Pix para esta cobrança"), { target: { value: "method" } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar com este Pix" }));

    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("/api/financial/charges/charge/public-link", expect.objectContaining({ body: JSON.stringify({ paymentMethodId: "method" }) })));
  });

  it("shows honest manual-history guidance for a legacy published null snapshot", async () => {
    serve(charge({ direction: "receivable", pix: null, sharingState: "legacy_without_pix" }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText(/publicada sem Pix/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
  });

  it.each([
    ["paid" as const, "Esta cobrança já foi paga. Nenhuma nova transferência é necessária."],
    ["cancelled" as const, "Esta cobrança foi cancelada e não deve ser paga."],
  ])("does not instruct a debtor to pay a %s charge", async (state, guidance) => {
    serve(charge({ state, cancelledAt: state === "cancelled" ? "2026-09-01" : null, paidAt: state === "paid" ? "2026-09-01" : null }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText(guidance)).toBeInTheDocument();
    expect(screen.queryByText(/antes de transferir|Faça o Pix|Pague usando/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /comprovante/i })).not.toBeInTheDocument();
  });

  it("keeps the debtor read-only with the hero, amount and upload card", async () => {
    serve(charge());

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByRole("heading", { name: "Aluguel" })).toBeInTheDocument();
    expect(screen.getByText("Parcela 2 de 3")).toBeInTheDocument();
    expect(screen.getByText("Valor a pagar")).toBeInTheDocument();
    expect(screen.getByText("JPG, PNG ou PDF de até 10 MB.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Enviar comprovante" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Marcar pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).not.toBeInTheDocument();
  });

  it("offers a replacement only after the last proof was rejected", async () => {
    serve(charge({ proofState: "rejected", proof: proof({ state: "rejected", reason: "Ilegível", sentByViewer: true }) }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Comprovante rejeitado: Ilegível. Você pode enviar outro arquivo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Substituir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar novo comprovante" })).toBeInTheDocument();
  });

  it("accepts the pending proof when the creditor marks the charge as paid", async () => {
    const pending = charge({ direction: "receivable", proofState: "pending", proof: proof() });
    const review = vi.fn(() => Response.json({ ...pending, state: "paid", proofState: "accepted", proof: proof({ state: "accepted" }), paidAt: "2026-09-08T12:00:00Z" }));

    serve(pending, { "POST /api/financial/charges/charge/proof/review": review });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Valor a receber")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));
    expect(review).not.toHaveBeenCalled();
    await confirmMarkPaid();

    await waitFor(() => expect(review).toHaveBeenCalled());
    expect(browserFetch).not.toHaveBeenCalledWith("/api/financial/charges/charge/pay", expect.anything());
    expect(await screen.findByText("Comprovante aceito e pagamento registrado.")).toBeInTheDocument();
    expect(screen.getByText("Aceito")).toBeInTheDocument();
  });

  it("lets the owner of a conta a pagar copy the key, send the proof and mark it paid, with nothing to share", async () => {
    const paid = charge({ direction: "payable", payer: "owner", ownedByViewer: true, hasPix: true, state: "paid", paidAt: "2026-09-08T12:00:00Z" });
    const pay = vi.fn(() => Response.json(paid));

    serve(charge({ direction: "payable", payer: "owner", ownedByViewer: true, hasPix: true }), { "POST /api/financial/charges/charge/pay": pay });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Minha conta")).toBeInTheDocument();
    expect(screen.getByText("Vai receber de você")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar Pix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Enviar comprovante" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Combine o pagamento com o credor/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));
    await confirmMarkPaid();

    await waitFor(() => expect(pay).toHaveBeenCalled());
    expect(await screen.findByText("Pagamento integral registrado.")).toBeInTheDocument();
  });

  it("names a conta a pagar without payee as the owner's alone", async () => {
    serve(charge({ direction: "payable", payer: "owner", ownedByViewer: true, hasPix: false, pix: null, counterpartName: "Você", recipient: { userId: null, name: "Você", email: null }, debtorUserId: null }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Conta só sua")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar Pix" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Combine o pagamento com o credor/)).not.toBeInTheDocument();
  });

  it("gives the payee of a conta a pagar only Marcar pago and the proof", async () => {
    const pending = charge({ direction: "receivable", payer: "owner", ownedByViewer: false, hasPix: true, proofState: "pending", proof: proof() });
    const review = vi.fn(() => Response.json({ ...pending, state: "paid", proofState: "accepted", proof: proof({ state: "accepted" }) }));

    serve(pending, { "POST /api/financial/charges/charge/proof/review": review });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Vai pagar para você")).toBeInTheDocument();
    expect(screen.queryByText("Minha conta")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comprovante" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar comprovante/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));
    await confirmMarkPaid();

    await waitFor(() => expect(review).toHaveBeenCalled());
    expect(browserFetch).not.toHaveBeenCalledWith("/api/financial/charges/charge/pay", expect.anything());
  });

  it("marks a charge without proof as paid directly and reminds the debtor", async () => {
    const paid = charge({ direction: "receivable", state: "paid", paidAt: "2026-09-08T12:00:00Z" });
    const pay = vi.fn(() => Response.json(paid));
    const remind = vi.fn(() => Response.json({ queued: true }));

    serve(charge({ direction: "receivable" }), { "POST /api/financial/charges/charge/pay": pay, "POST /api/financial/charges/charge/reminders": remind });

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Lembrar" }));

    const remindDialog = await screen.findByRole("dialog", { name: "Enviar lembrete?" });
    expect(remind).not.toHaveBeenCalled();

    fireEvent.click(within(remindDialog).getByRole("button", { name: "Enviar lembrete" }));
    expect(await screen.findByText("Lembrete enviado para Ana.")).toBeInTheDocument();
    expect(remind).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));
    await confirmMarkPaid();

    await waitFor(() => expect(pay).toHaveBeenCalled());
    expect(await screen.findByText("Pagamento integral registrado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reopens a paid receivable charge after confirmation", async () => {
    const reopened = charge({ direction: "receivable" });
    const reopen = vi.fn(() => Response.json(reopened));

    serve(charge({ direction: "receivable", state: "paid", paidAt: "2026-09-08T12:00:00Z" }), { "POST /api/financial/charges/charge/reopen": reopen });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Valor a receber")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));

    const dialog = await screen.findByRole("dialog", { name: "Reabrir cobrança?" });
    expect(reopen).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reabrir" }));

    await waitFor(() => expect(reopen).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reabrir" })).not.toBeInTheDocument();
  });

  it("hides Lembrar when the debtor cannot be reached", async () => {
    serve(charge({ direction: "receivable", counterpartReachable: false }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByRole("button", { name: "Compartilhar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
  });

  it("shares the charge summary with the payment link, or copies it", async () => {
    const detail = charge({ direction: "receivable" });
    const writeText = vi.fn(async () => {});

    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    serve(detail, { "POST /api/financial/charges/charge/public-link": () => Response.json({ token: "tk", expiresAt: "2030-01-01" }) });

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Compartilhar" }));

    const text = chargeShareText(detail, `${window.location.origin}/pay/tk`);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copiado.");
  });
});
