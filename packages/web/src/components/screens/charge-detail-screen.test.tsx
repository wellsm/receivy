import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingKind, BillingRecurrence, ChargeState, chargeShareText, Direction, PixKeyType, ProofKind, ProofMime, ProofState, SharingState, type ChargeDetail, type ChargeProof } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ChargeDetailScreen } from "@/components/screens/charge-detail-screen";

const routerMock = { push: vi.fn(), replace: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

function charge(overrides: Partial<ChargeDetail> = {}): ChargeDetail {
  return {
    id: "charge",
    direction: Direction.Payable,
    description: "Aluguel",
    amount: { amountCents: 2500, currency: "BRL" },
    dueDate: "2026-09-10",
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Until,
    installment: 2,
    installmentCount: 3,
    counterpartName: "Ana",
    proofState: null,
    recipient: { userId: "u1", name: "Ana", email: null },
    debtorId: "u1",
    pix: { keyType: PixKeyType.Email, key: "pix@example.com", label: "Principal" },
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01",
    ...overrides,
  };
}

function proof(overrides: Partial<ChargeProof> = {}): ChargeProof {
  return {
    state: ProofState.Pending,
    kind: ProofKind.File,
    file: { name: "comprovante.pdf", mime: ProofMime.Pdf, size: 184 * 1024 },
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
    serve(charge({ direction: Direction.Receivable, pix: null, sharingState: SharingState.PixRequired }), {
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
    serve(charge({ direction: Direction.Receivable, pix: null, sharingState: SharingState.LegacyWithoutPix }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText(/publicada sem Pix/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
  });

  it.each([
    [ChargeState.Paid, "Esta cobrança já foi paga. Nenhuma nova transferência é necessária."],
    [ChargeState.Cancelled, "Esta cobrança foi cancelada e não deve ser paga."],
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
    // One control picks the file, one sends it, and sending stays off until something is picked.
    expect(screen.getByRole("button", { name: "Selecionar comprovante" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Enviar comprovante" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).not.toBeInTheDocument();
  });

  it("previews the picked proof in the card and sends it only from the send button, staying on the charge", async () => {
    let current = charge();
    const ticket = vi.fn(() => {
      current = charge({ proofState: ProofState.Pending, proof: proof({ sentByViewer: true }) });

      return Response.json({ uploadUrl: "https://bucket.test/put", expiresAt: "2026-09-05T14:40:00Z" });
    });
    const put = vi.fn(async () => new Response(null, { status: 200 }));

    vi.stubGlobal("fetch", put);
    vi.mocked(browserFetch).mockImplementation(async (path, init) => {
      if (init?.method === "POST" && path === "/api/financial/charges/charge/proof") {
        return ticket();
      }

      return Response.json(current);
    });

    render(<ChargeDetailScreen id="charge" />);

    const input = await screen.findByLabelText("Comprovante JPG, PNG ou PDF");

    fireEvent.change(input, { target: { files: [new File(["%PDF"], "comprovante.pdf", { type: "application/pdf" })] } });

    // Picking stages the file inside the proof card; nothing reaches the API yet.
    expect(await screen.findByText("comprovante.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trocar arquivo" })).toBeInTheDocument();
    expect(ticket).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enviar comprovante" }));

    await waitFor(() => expect(ticket).toHaveBeenCalled());
    await waitFor(() => expect(put).toHaveBeenCalledWith("https://bucket.test/put", expect.objectContaining({ method: "PUT" })));

    expect(await screen.findByText("Comprovante enviado para revisão.")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("offers a replacement only after the last proof was rejected", async () => {
    serve(charge({ proofState: ProofState.Rejected, proof: proof({ state: ProofState.Rejected, reason: "Ilegível", sentByViewer: true }) }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Comprovante rejeitado: Ilegível. Você pode enviar outro arquivo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Substituir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar novo comprovante" })).toBeInTheDocument();
  });

  it("accepts the pending proof when the creditor marks the charge as paid", async () => {
    const pending = charge({ direction: Direction.Receivable, proofState: ProofState.Pending, proof: proof() });
    const review = vi.fn(() => Response.json({ ...pending, state: "paid", proofState: "accepted", proof: proof({ state: ProofState.Accepted }), paidAt: "2026-09-08T12:00:00Z" }));

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
    const paid = charge({ direction: Direction.Payable, ownedByViewer: true, hasPix: true, state: ChargeState.Paid, paidAt: "2026-09-08T12:00:00Z" });
    const pay = vi.fn(() => Response.json(paid));

    serve(charge({ direction: Direction.Payable, ownedByViewer: true, hasPix: true }), { "POST /api/financial/charges/charge/pay": pay });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Minha conta")).toBeInTheDocument();
    expect(screen.getByText("Vai receber de você")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar Chave Pix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Selecionar comprovante" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Combine o pagamento com o credor/)).not.toBeInTheDocument();

    // No footer here (the owner settles), so the card itself carries the send button once a file is picked.
    fireEvent.change(screen.getByLabelText("Comprovante JPG, PNG ou PDF"), { target: { files: [new File(["%PDF"], "conta.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByRole("button", { name: "Enviar comprovante" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));

    await confirmMarkPaid();

    await waitFor(() => expect(pay).toHaveBeenCalled());

    expect(await screen.findByText("Pagamento integral registrado.")).toBeInTheDocument();
  });

  it("names a conta a pagar without payee as the owner's alone", async () => {
    serve(charge({ direction: Direction.Payable, ownedByViewer: true, hasPix: false, pix: null, counterpartName: "Você", recipient: { userId: null, name: "Você", email: null }, debtorId: null }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Conta só sua")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar Chave Pix" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Combine o pagamento com o credor/)).not.toBeInTheDocument();
  });

  it("gives the payee of a conta a pagar only Marcar pago and the proof", async () => {
    const pending = charge({ direction: Direction.Receivable, ownedByViewer: false, hasPix: true, proofState: ProofState.Pending, proof: proof() });
    const review = vi.fn(() => Response.json({ ...pending, state: "paid", proofState: "accepted", proof: proof({ state: ProofState.Accepted }) }));

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
    const paid = charge({ direction: Direction.Receivable, state: ChargeState.Paid, paidAt: "2026-09-08T12:00:00Z" });
    const pay = vi.fn(() => Response.json(paid));
    const remind = vi.fn(() => Response.json({ queued: true }));

    serve(charge({ direction: Direction.Receivable }), { "POST /api/financial/charges/charge/pay": pay, "POST /api/financial/charges/charge/reminders": remind });

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
    // Pinned well after the fixture's due date (2026-09-10) so the reopened charge deterministically reads
    // as overdue, regardless of the real clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));

    const reopened = charge({ direction: Direction.Receivable });
    const reopen = vi.fn(() => Response.json(reopened));

    serve(charge({ direction: Direction.Receivable, state: ChargeState.Paid, paidAt: "2026-09-08T12:00:00Z" }), { "POST /api/financial/charges/charge/reopen": reopen });

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
    expect(screen.getByText("Atrasado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reabrir" })).not.toBeInTheDocument();
  });

  it("hides Lembrar when the debtor cannot be reached", async () => {
    serve(charge({ direction: Direction.Receivable, counterpartReachable: false }));

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByRole("button", { name: "Compartilhar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
  });

  it("shares the charge summary with the payment link, or copies it", async () => {
    const detail = charge({ direction: Direction.Receivable });
    const writeText = vi.fn(async () => {});

    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    serve(detail, { "POST /api/financial/charges/charge/public-link": () => Response.json({ token: "tk", expiresAt: "2030-01-01" }) });

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Compartilhar" }));

    const text = chargeShareText(detail, `${window.location.origin}/pay/tk`);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));

    expect(await screen.findByRole("status")).toHaveTextContent("Link copiado.");
  });

  it("lets the debtor declare a payment and take it back", async () => {
    const declared = charge({
      proofState: ProofState.Pending,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null, sentByViewer: true }),
    });

    serve(charge({ confirmationRequired: true }), {
      "POST /api/financial/charges/charge/proof/declaration": () => Response.json(declared),
    });

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Já paguei" }));

    const dialog = await screen.findByRole("dialog", { name: "Informar pagamento?" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Já paguei" }));

    expect(await screen.findByText(/aguardando confirmação de Ana/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anexar comprovante" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver comprovante" })).not.toBeInTheDocument();
  });

  it("lets the creditor confirm or refuse a declared payment with a reason", async () => {
    const declared = charge({
      direction: Direction.Receivable,
      ownedByViewer: true,
      proofState: ProofState.Pending,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null }),
    });
    const refused = { ...declared, proofState: ProofState.Rejected, proof: proof({ kind: ProofKind.Declaration, file: null, state: ProofState.Rejected, reason: "Não caiu" }) };

    serve(declared, { "POST /api/financial/charges/charge/proof/review": () => Response.json(refused) });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText(/Ana informou que pagou/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar recebimento" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Não recebi" }));

    const dialog = await screen.findByRole("dialog", { name: "Não recebeu o pagamento?" });

    fireEvent.change(within(dialog).getByLabelText("Motivo (opcional)"), { target: { value: "Não caiu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Não recebi" }));

    await waitFor(() =>
      expect(browserFetch).toHaveBeenCalledWith(
        "/api/financial/charges/charge/proof/review",
        expect.objectContaining({ body: JSON.stringify({ decision: "rejected", reason: "Não caiu" }) }),
      ),
    );
  });

  it("lets the creditor mark as paid by hand after refusing a declared payment", async () => {
    const refused = charge({
      direction: Direction.Receivable,
      ownedByViewer: true,
      proofState: ProofState.Rejected,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null, state: ProofState.Rejected, reason: "Não caiu", reviewedAt: "2026-09-06T10:00:00Z" }),
    });
    const pay = vi.fn(() => Response.json({ ...refused, state: "paid", paidAt: "2026-09-08T12:00:00Z" }));

    serve(refused, { "POST /api/financial/charges/charge/pay": pay });

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText(/Ana informou que pagou/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar recebimento" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));

    await confirmMarkPaid();

    await waitFor(() => expect(pay).toHaveBeenCalled());
  });

  it("clears the rejection reason when the dialog is cancelled and reopened", async () => {
    serve(
      charge({
        direction: Direction.Receivable,
        ownedByViewer: true,
        proofState: ProofState.Pending,
        proofKind: ProofKind.Declaration,
        proof: proof({ kind: ProofKind.Declaration, file: null }),
      }),
    );

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Não recebi" }));

    const dialog = await screen.findByRole("dialog", { name: "Não recebeu o pagamento?" });

    fireEvent.change(within(dialog).getByLabelText("Motivo (opcional)"), { target: { value: "Não caiu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "Não recebi" }));

    const reopened = await screen.findByRole("dialog", { name: "Não recebeu o pagamento?" });

    expect(within(reopened).getByLabelText("Motivo (opcional)")).toHaveValue("");
  });

  it("pauses and resumes the notices of one charge, keeping Lembrar", async () => {
    const put = vi.fn((notify: boolean) => Response.json(charge({ direction: Direction.Receivable, notify })));

    vi.mocked(browserFetch).mockImplementation(async (path, init) => {
      if (init?.method === "PUT" && path === "/api/financial/charges/charge/notify") {
        return put(JSON.parse(String(init.body)).notify);
      }

      return Response.json(charge({ direction: Direction.Receivable }));
    });

    render(<ChargeDetailScreen id="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Não notificar esta cobrança" }));

    expect(await screen.findByText("Avisos desta cobrança pausados.")).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith(false);
    expect(screen.getByText("Sem avisos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lembrar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Voltar a notificar" }));

    expect(await screen.findByText("Avisos reativados.")).toBeInTheDocument();
    expect(put).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();
  });

  it("offers no notice switch to whoever owes", async () => {
    serve(charge());

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Valor a pagar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();
  });

  it("badges a registro and hides Lembrar, the link, the proof and Não notificar", async () => {
    serve(
      charge({
        direction: Direction.Receivable,
        ownedByViewer: true,
        counterpartName: "Empresa X",
        recipient: { userId: null, name: "Empresa X", email: null },
        debtorId: null,
        sharingState: SharingState.Closed,
        kind: BillingKind.Record,
      }),
    );

    render(<ChargeDetailScreen id="charge" />);

    expect(await screen.findByText("Registro")).toBeInTheDocument();
    expect(screen.getByText("Empresa X")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).not.toBeInTheDocument();
    expect(screen.queryByText("Comprovante")).not.toBeInTheDocument();
  });
});
