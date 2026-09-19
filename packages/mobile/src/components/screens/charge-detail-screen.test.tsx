import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { BillingKind, BillingRecurrence, ChargeState, Direction, PaymentLinkState, PaymentProvider, PixKeyType, ProofKind, ProofMime, ProofState, SharingState, type ChargeDetail, type ChargeProof } from "@receivy/common";
import { ChargeDetailScreen } from "@/components/screens/charge-detail-screen";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(() => callback(), [callback]) };
});

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class {} }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

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
    recipient: { userId: "u1", name: "Ana", email: "ana@example.com" },
    debtorId: "u1",
    payment: { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: "pix@example.com", label: "Principal" },
    paymentLink: null,
    receiptUrl: null,
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
    sentByViewer: true,
    ...overrides,
  };
}

const TICKET = { uploadUrl: "https://private.test/put", expiresAt: "2026-09-05T14:40:00Z" };

const notifications = { remind: jest.fn().mockResolvedValue({ queued: true }) };

describe("ChargeDetailScreen", () => {
  it("creates and explicitly selects an owned Pix before sharing", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });

    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, payment: null, sharingState: SharingState.PixRequired })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn().mockResolvedValue({ token: "fixture" }),
      publicChargeUrl: jest.fn().mockReturnValue("https://receivy.example/pay/fixture"),
      paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }),
      savePaymentMethod: jest.fn().mockResolvedValue({ id: "method", provider: "pix", kind: "email", value: "pix@example.com", label: "Pix" }),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.changeText(await screen.findByLabelText("Nova chave Pix"), "pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar nova chave" }));
    await screen.findByText("✓ E-mail · pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Publicar com este meio" }));

    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("charge", false, "method"));

    expect(client.savePaymentMethod).toHaveBeenCalledWith({ provider: "pix", kind: "email", value: "pix@example.com" });
  });

  it("keeps debtor finance read-only and copies the literal Pix key", async () => {
    const client = { charge: jest.fn().mockResolvedValue(charge()), cancel: jest.fn(), pay: jest.fn(), publicLink: jest.fn(), publicChargeUrl: jest.fn() };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Aluguel")).toBeOnTheScreen();
    expect(screen.getByText("Parcela 2 de 3")).toBeOnTheScreen();
    expect(screen.getByText("Valor a pagar")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Copiar Chave Pix" }));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("pix@example.com");
  });

  it("copies the InfinitePay link for the payer", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Payable, payment: { provider: PaymentProvider.InfinitePay, kind: null, value: "loja", label: "InfinitePay" }, paymentLink: { url: "https://checkout/abc", state: PaymentLinkState.Ready } })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.press(await screen.findByLabelText("Copiar link de pagamento"));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("https://checkout/abc");
  });

  it("asks for a new link when the last one failed", async () => {
    const ensure = jest.fn().mockResolvedValue(charge({ paymentLink: { url: "https://checkout/new", state: PaymentLinkState.Ready } }));
    const client = {
      charge: jest.fn().mockResolvedValue(
        charge({
          direction: Direction.Receivable,
          ownedByViewer: true,
          payment: { provider: PaymentProvider.InfinitePay, kind: null, value: "loja", label: "InfinitePay" },
          paymentLink: { url: null, state: PaymentLinkState.Failed },
        }),
      ),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      ensurePaymentLink: ensure,
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.press(await screen.findByLabelText("Gerar link de novo"));

    await waitFor(() => expect(ensure).toHaveBeenCalledWith("charge"));
  });

  it("shows a disabled tile while the InfinitePay link is still being generated", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(
        charge({
          direction: Direction.Receivable,
          ownedByViewer: true,
          payment: { provider: PaymentProvider.InfinitePay, kind: null, value: "loja", label: "InfinitePay" },
          paymentLink: { url: null, state: PaymentLinkState.Pending },
        }),
      ),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    const tile = await screen.findByLabelText("Gerando link");

    expect(tile).toBeOnTheScreen();
    expect(tile.props.accessibilityState.disabled).toBe(true);
  });

  it("never shows the viewer's own photo next to the counterpart when the counterpart has none", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(
        charge({
          ownedByViewer: false,
          counterpartAvatar: null,
          recipient: { userId: "u1", name: "Ana", email: "ana@example.com", avatar: { url: "https://bucket.test/viewer", version: "v1" } },
        }),
      ),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Ana")).toBeOnTheScreen();
    expect(screen.queryByTestId("initials-avatar-photo")).toBeNull();
  });

  it.each([
    [ChargeState.Paid, "Esta cobrança já foi paga. Nenhuma nova transferência é necessária."],
    [ChargeState.Cancelled, "Esta cobrança foi cancelada e não deve ser paga."],
  ])("does not instruct payment for a %s payable charge", async (state, guidance) => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ state, cancelledAt: state === "cancelled" ? "2026-09-01" : null, paidAt: state === "paid" ? "2026-09-01" : null })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText(guidance)).toBeOnTheScreen();
    expect(screen.queryByText(/antes de transferir|Pague usando/)).toBeNull();
    expect(screen.queryByRole("button", { name: /comprovante/i })).toBeNull();
  });

  it("lets the debtor send a proof and opens the preview afterwards", async () => {
    const onOpenProof = jest.fn();
    const client = {
      charge: jest.fn().mockResolvedValueOnce(charge()).mockResolvedValue(charge({ proofState: ProofState.Pending, proof: proof() })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn().mockResolvedValue(TICKET),
      // After the PUT the screen completes the upload and shows the charge the API answers with.
      completeProofUpload: jest.fn().mockResolvedValue(charge({ proofState: ProofState.Pending, proof: proof() })),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };
    const picker = jest.requireMock("expo-document-picker") as { getDocumentAsync: jest.Mock };
    const upload = jest.requireMock("expo/fetch") as { fetch: jest.Mock };

    picker.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/proof.pdf", name: "comprovante.pdf", mimeType: "application/pdf", size: 14, file: {} }] });
    upload.fetch.mockResolvedValue({ ok: true });

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} onOpenProof={onOpenProof} />);

    expect(await screen.findByText("JPG, PNG ou PDF de até 10 MB.")).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole("button", { name: "Enviar comprovante" }).at(-1)!);

    await waitFor(() => expect(onOpenProof).toHaveBeenCalled(), { timeout: 3000 });

    expect(client.startProofUpload).toHaveBeenCalledWith("charge", { filename: "comprovante.pdf", mime: "application/pdf", size: 14 });
    expect(upload.fetch).toHaveBeenCalledWith(TICKET.uploadUrl, expect.objectContaining({ method: "PUT", headers: { "content-type": "application/pdf" } }));
    expect(await screen.findByText("comprovante.pdf")).toBeOnTheScreen();
    expect(screen.getByText("Em revisão")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Substituir comprovante" })).toBeNull();
  });

  it("offers a replacement only after the last proof was rejected", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ proofState: ProofState.Rejected, proof: proof({ state: ProofState.Rejected, reason: "Ilegível" }) })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Comprovante rejeitado: Ilegível. Você pode enviar outro arquivo.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Substituir comprovante" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Enviar novo comprovante" })).toBeOnTheScreen();
  });

  it("lets the debtor delete a pending proof and send another one", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ proofState: ProofState.Pending, proof: proof() })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
      withdrawProof: jest.fn().mockResolvedValue(undefined),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Apagar e enviar outro" }));

    await waitFor(() => expect(client.withdrawProof).toHaveBeenCalledWith("charge"));

    expect(await screen.findByText("Comprovante apagado. Envie outro quando quiser.")).toBeOnTheScreen();
    // The card and the quick action both offer a fresh upload once the file is gone.
    expect(screen.getAllByRole("button", { name: "Enviar comprovante" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Apagar e enviar outro" })).toBeNull();
  });

  it("accepts the pending proof when the creditor marks the charge as paid", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());

    const pending = proof({ sentByViewer: false });
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, proofState: ProofState.Pending, proof: pending })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, state: ChargeState.Paid, paidAt: "2026-09-08T12:00:00Z", proofState: ProofState.Accepted, proof: { ...pending, state: ProofState.Accepted, reviewedAt: "2026-09-08T12:00:00Z" } })),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Valor a receber")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Marcar como pago" }));

    await waitFor(() => expect(client.reviewProof).toHaveBeenCalledWith("charge", "accepted"));

    expect(client.pay).not.toHaveBeenCalled();
    expect(await screen.findByText("Comprovante aceito e pagamento registrado.")).toBeOnTheScreen();
  });

  it("marks a charge without proof as paid directly and reminds the debtor", async () => {
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga" || button.text === "Enviar lembrete")?.onPress?.());

    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable })),
      cancel: jest.fn(),
      pay: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, state: ChargeState.Paid, paidAt: "2026-09-08T12:00:00Z" })),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Lembrar" }));

    expect(Alert.alert).toHaveBeenCalledWith("Enviar lembrete?", expect.stringContaining("Avisa Ana por notificação no app ou por e-mail"), expect.any(Array));

    await waitFor(() => expect(notifications.remind).toHaveBeenCalledWith("charge"));

    expect(await screen.findByText("Lembrete enviado para Ana.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Marcar como pago" }));

    await waitFor(() => expect(client.pay).toHaveBeenCalledWith("charge"));

    expect(client.reviewProof).not.toHaveBeenCalled();
    expect(await screen.findByText("Pagamento integral registrado.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).toBeNull();
  });

  it("reopens a paid charge after confirmation", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Reabrir")?.onPress?.());

    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, state: ChargeState.Paid, paidAt: "2026-09-08T12:00:00Z" })),
      startProofUpload: jest.fn(),
      cancel: jest.fn(),
      pay: jest.fn(),
      reopen: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable })),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Reabrir" }));

    await waitFor(() => expect(client.reopen).toHaveBeenCalledWith("charge"));

    expect(await screen.findByRole("button", { name: "Marcar como pago" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Reabrir" })).toBeNull();
  });

  it("hides the reminder when the debtor cannot be reached", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, counterpartReachable: false })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByRole("button", { name: "Compartilhar" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Lembrar" })).toBeNull();
  });

  it("lets the owner of a conta a pagar copy the key, send the proof and mark it paid", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());

    const own = charge({ direction: Direction.Payable, ownedByViewer: true, counterpartName: "Você", recipient: { userId: null, name: "Você", email: null }, debtorId: null });
    const client = {
      charge: jest.fn().mockResolvedValue(own),
      cancel: jest.fn(),
      pay: jest.fn().mockResolvedValue({ ...own, state: "paid", paidAt: "2026-09-08T12:00:00Z" }),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Minha conta")).toBeOnTheScreen();
    expect(screen.getByText("A pagar")).toBeOnTheScreen();
    expect(screen.getByText("Conta só sua")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Copiar Chave Pix" })).toBeOnTheScreen();
    // The tile and the proof card both offer the upload.
    expect(screen.getAllByRole("button", { name: "Enviar comprovante" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar e compartilhar link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lembrar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    expect(screen.queryByText("A chave Pix ainda não está disponível. Combine o pagamento com o credor.")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Marcar como pago" }));

    await waitFor(() => expect(client.pay).toHaveBeenCalledWith("charge"));

    expect(client.reviewProof).not.toHaveBeenCalled();
    expect(await screen.findByText("Pagamento integral registrado.")).toBeOnTheScreen();
  });

  it("gives the payee of a conta a pagar only the proof and the paid mark", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable, ownedByViewer: false, counterpartName: "Bruno", proofState: ProofState.Pending, proof: proof({ sentByViewer: false }) })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Vai pagar para você")).toBeOnTheScreen();
    expect(screen.getByText("Bruno")).toBeOnTheScreen();
    expect(screen.queryByText("Minha conta")).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Comprovante" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Copiar Chave Pix" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar comprovante" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lembrar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("lets the debtor declare a payment after confirming", async () => {
    const declared = charge({ proofState: ProofState.Pending, proofKind: ProofKind.Declaration, proof: proof({ kind: ProofKind.Declaration, file: null }) });
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ confirmationRequired: true })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      declarePayment: jest.fn().mockResolvedValue(declared),
      startProofUpload: jest.fn(),
      completeProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
      withdrawProof: jest.fn(),
    };

    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Já paguei")?.onPress?.());

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Já paguei" }));

    expect(Alert.alert).toHaveBeenCalledWith("Informar pagamento?", "Ana vai receber um aviso para confirmar o recebimento.", expect.any(Array));
    expect(client.declarePayment).toHaveBeenCalledWith("charge");
    expect(await screen.findByText(/aguardando confirmação de Ana/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeOnTheScreen();
  });

  it("lets the creditor refuse a declared payment with a reason", async () => {
    const declared = charge({
      direction: Direction.Receivable,
      ownedByViewer: true,
      proofState: ProofState.Pending,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null, sentByViewer: false }),
    });
    const client = {
      charge: jest.fn().mockResolvedValue(declared),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      completeProofUpload: jest.fn(),
      reviewProof: jest.fn().mockResolvedValue(declared),
      downloadProof: jest.fn(),
      withdrawProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText(/Ana informou que pagou/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Confirmar recebimento" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Não recebi" }));
    await fireEvent.changeText(screen.getByLabelText("Motivo opcional"), "Não caiu");
    await fireEvent.press(screen.getAllByRole("button", { name: "Não recebi" }).at(-1)!);

    expect(client.reviewProof).toHaveBeenCalledWith("charge", "rejected", "Não caiu");
  });

  it("lets the creditor mark as paid by hand after refusing a declared payment", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());

    const refused = charge({
      direction: Direction.Receivable,
      ownedByViewer: true,
      proofState: ProofState.Rejected,
      proofKind: ProofKind.Declaration,
      proof: proof({ kind: ProofKind.Declaration, file: null, state: ProofState.Rejected, reason: "Não caiu", reviewedAt: "2026-09-06T10:00:00Z", sentByViewer: false }),
    });
    const client = {
      charge: jest.fn().mockResolvedValue(refused),
      cancel: jest.fn(),
      pay: jest.fn().mockResolvedValue({ ...refused, state: ChargeState.Paid, paidAt: "2026-09-08T12:00:00Z" }),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      completeProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
      withdrawProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText(/Ana informou que pagou/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Confirmar recebimento" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Marcar como pago" }));

    await waitFor(() => expect(client.pay).toHaveBeenCalled());

    expect(client.reviewProof).not.toHaveBeenCalled();
  });

  it("pauses and resumes the notices of one charge, keeping Lembrar", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: Direction.Receivable })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      setChargeNotify: jest.fn(async (_id: string, notify: boolean) => charge({ direction: Direction.Receivable, notify })),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Não notificar esta cobrança" }));

    await waitFor(() => expect(client.setChargeNotify).toHaveBeenCalledWith("charge", false));

    expect(await screen.findByText("Avisos desta cobrança pausados.")).toBeOnTheScreen();
    expect(screen.getByText("Sem avisos")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Lembrar" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Voltar a notificar" }));

    await waitFor(() => expect(client.setChargeNotify).toHaveBeenLastCalledWith("charge", true));

    expect(await screen.findByText("Avisos reativados.")).toBeOnTheScreen();
    expect(screen.queryByText("Sem avisos")).toBeNull();
  });

  it("offers no notice switch to whoever owes", async () => {
    const client = { charge: jest.fn().mockResolvedValue(charge()), cancel: jest.fn(), pay: jest.fn(), publicLink: jest.fn(), publicChargeUrl: jest.fn(), setChargeNotify: jest.fn() };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Valor a pagar")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).toBeNull();
  });

  it("badges a registro and hides Lembrar, the link, the proof and Não notificar", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(
        charge({
          direction: Direction.Receivable,
          ownedByViewer: true,
          counterpartName: "Empresa X",
          recipient: { userId: null, name: "Empresa X", email: null },
          debtorId: null,
          sharingState: SharingState.Closed,
          kind: BillingKind.Record,
        }),
      ),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      startProofUpload: jest.fn(),
      reviewProof: jest.fn(),
      setChargeNotify: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Registro")).toBeOnTheScreen();
    expect(screen.getByText("Empresa X")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Marcar como pago" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Lembrar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Não notificar esta cobrança" })).toBeNull();
    expect(screen.queryByRole("header", { name: "Comprovante" })).toBeNull();
  });
});
