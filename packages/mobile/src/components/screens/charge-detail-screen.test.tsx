import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { ChargeDetail, ProofDetail } from "@receivy/common";
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
    recipient: { name: "Ana", email: null },
    pix: { keyType: "email", key: "pix@example.com", label: "Principal" },
    sharingState: "ready",
    payment: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01",
    ...overrides,
  };
}

function proof(overrides: Partial<ProofDetail> = {}): ProofDetail {
  return {
    id: "proof",
    chargeId: "charge",
    state: "pending",
    createdAt: "2026-09-05T14:32:00Z",
    originalName: "comprovante.pdf",
    mime: "application/pdf",
    size: 184 * 1024,
    reason: null,
    closureReason: null,
    reviewedAt: null,
    ...overrides,
  };
}

const notifications = { remind: jest.fn().mockResolvedValue({ queued: true }) };

describe("ChargeDetailScreen", () => {
  it("creates and explicitly selects an owned Pix before sharing", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: "receivable", pix: null, sharingState: "pix_required" })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn().mockResolvedValue({ token: "fixture" }),
      publicChargeUrl: jest.fn().mockReturnValue("https://receivy.example/pay/fixture"),
      paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }),
      savePaymentMethod: jest.fn().mockResolvedValue({ id: "method", pixKeyType: "email", pixKey: "pix@example.com", label: "Pix" }),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);
    await fireEvent.changeText(await screen.findByLabelText("Nova chave Pix"), "pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar nova chave" }));
    await screen.findByText("✓ EMAIL · pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Publicar com este Pix" }));

    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("charge", false, "method"));
    expect(client.savePaymentMethod).toHaveBeenCalledWith({ pixKeyType: "email", pixKey: "pix@example.com" });
  });

  it("keeps debtor finance read-only and copies the literal Pix key", async () => {
    const client = { charge: jest.fn().mockResolvedValue(charge()), cancel: jest.fn(), pay: jest.fn(), publicLink: jest.fn(), publicChargeUrl: jest.fn() };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Aluguel")).toBeOnTheScreen();
    expect(screen.getByText("Parcela 2 de 3")).toBeOnTheScreen();
    expect(screen.getByText("Valor a pagar")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Marcar cobrança como paga" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Copiar chave Pix" }));

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("pix@example.com");
  });

  it.each([
    ["paid" as const, "Esta cobrança já foi paga. Nenhuma nova transferência é necessária."],
    ["cancelled" as const, "Esta cobrança foi cancelada e não deve ser paga."],
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
    const sent = proof();
    const client = {
      charge: jest.fn().mockResolvedValue(charge()),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      proofs: jest.fn().mockResolvedValue({ proofs: [] }),
      uploadIntent: jest.fn(),
      finalizeProof: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };
    const picker = jest.requireMock("expo-document-picker") as { getDocumentAsync: jest.Mock };
    const upload = jest.requireMock("expo/fetch") as { fetch: jest.Mock };

    picker.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/proof.pdf", name: "comprovante.pdf", mimeType: "application/pdf", size: 14, file: {} }] });
    upload.fetch.mockResolvedValue({ ok: true });
    client.uploadIntent.mockResolvedValue({ id: "intent", uploadUrl: "https://private.test/put" });
    client.finalizeProof.mockResolvedValue(sent);

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} onOpenProof={onOpenProof} />);

    expect(await screen.findByText("JPG, PNG ou PDF de até 10 MB.")).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole("button", { name: "Enviar comprovante" }).at(-1)!);

    await waitFor(() => expect(onOpenProof).toHaveBeenCalled());
    expect(client.finalizeProof).toHaveBeenCalledWith("charge", "intent");
    expect(await screen.findByText("comprovante.pdf")).toBeOnTheScreen();
    expect(screen.getByText("Em revisão")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Substituir comprovante" })).toBeNull();
  });

  it("offers a replacement only after the last proof was rejected", async () => {
    const client = {
      charge: jest.fn().mockResolvedValue(charge()),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      proofs: jest.fn().mockResolvedValue({ proofs: [proof({ state: "rejected", reason: "Ilegível" })] }),
      uploadIntent: jest.fn(),
      finalizeProof: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Comprovante rejeitado: Ilegível. Você pode enviar outro arquivo.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Substituir comprovante" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Enviar novo comprovante" })).toBeOnTheScreen();
  });

  it("accepts the pending proof when the creditor marks the charge as paid", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());
    const pending = proof();
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: "receivable" })),
      cancel: jest.fn(),
      pay: jest.fn(),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      proofs: jest.fn().mockResolvedValue({ proofs: [pending] }),
      uploadIntent: jest.fn(),
      finalizeProof: jest.fn(),
      reviewProof: jest.fn().mockResolvedValue({ ...pending, state: "accepted" }),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    expect(await screen.findByText("Valor a receber")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Marcar cobrança como paga" }));

    await waitFor(() => expect(client.reviewProof).toHaveBeenCalledWith("charge", "proof", "accepted"));
    expect(client.pay).not.toHaveBeenCalled();
    expect(await screen.findByText("Comprovante aceito e pagamento registrado.")).toBeOnTheScreen();
  });

  it("marks a charge without proof as paid directly and reminds the debtor", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());
    const client = {
      charge: jest.fn().mockResolvedValue(charge({ direction: "receivable" })),
      cancel: jest.fn(),
      pay: jest.fn().mockResolvedValue(charge({ direction: "receivable", state: "paid", paidAt: "2026-09-08T12:00:00Z" })),
      publicLink: jest.fn(),
      publicChargeUrl: jest.fn(),
      proofs: jest.fn().mockResolvedValue({ proofs: [] }),
      uploadIntent: jest.fn(),
      finalizeProof: jest.fn(),
      reviewProof: jest.fn(),
      downloadProof: jest.fn(),
    };

    await render(<ChargeDetailScreen id="charge" client={client} notifications={notifications} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Lembrar Pix" }));
    await waitFor(() => expect(notifications.remind).toHaveBeenCalledWith("charge"));
    expect(await screen.findByText("Lembrete enviado para Ana.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Marcar pago" }));

    await waitFor(() => expect(client.pay).toHaveBeenCalledWith("charge"));
    expect(client.reviewProof).not.toHaveBeenCalled();
    expect(await screen.findByText("Pagamento integral registrado.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar cobrança como paga" })).toBeNull();
  });
});
