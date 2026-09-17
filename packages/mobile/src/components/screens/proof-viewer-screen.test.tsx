import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { BillingRecurrence, ChargeState, Direction, ProofKind, ProofMime, ProofState, SharingState, type ChargeDetail, type ChargeProof } from "@receivy/common";
import { ProofViewerScreen } from "@/components/screens/proof-viewer-screen";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(() => callback(), [callback]) };
});

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn().mockResolvedValue({ type: "dismiss" }) }));
jest.mock("react-native-pdf", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: (props: { source: { uri: string } }) => <View testID="pdf-view" accessibilityLabel={props.source.uri} /> };
});
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class {} }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

function charge(overrides: Partial<ChargeDetail> = {}): ChargeDetail {
  return {
    id: "charge",
    direction: Direction.Receivable,
    description: "Aluguel",
    amount: { amountCents: 2500, currency: "BRL" },
    dueDate: "2026-09-10",
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Once,
    installment: 1,
    installmentCount: 1,
    counterpartName: "Ana",
    proofState: ProofState.Pending,
    recipient: { userId: "u1", name: "Ana", email: "ana@example.com" },
    debtorId: "u1",
    pix: null,
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
    file: { name: "comprovante.png", mime: ProofMime.Png, size: 2048 },
    sentAt: "2026-09-05T14:32:00Z",
    reviewedAt: null,
    reason: null,
    sentByViewer: false,
    ...overrides,
  };
}

function clientWith(detail: ChargeDetail) {
  return {
    charge: jest.fn().mockResolvedValue(detail),
    startProofUpload: jest.fn(),
    completeProofUpload: jest.fn(),
    reviewProof: jest.fn().mockImplementation(async (_id: string, decision: ProofState.Accepted | ProofState.Rejected) => charge({ ...detail, proof: proof({ state: decision }) })),
    downloadProof: jest.fn().mockResolvedValue({ url: "https://files.test/proof.png", expiresIn: 60 }),
  };
}

describe("ProofViewerScreen", () => {
  it("shows the proof and lets the creditor accept it", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar pago")?.onPress?.());
    const onDone = jest.fn();
    const client = clientWith(charge({ proof: proof() }));

    await render(<ProofViewerScreen chargeId="charge" client={client} onDone={onDone} />);

    expect(await screen.findByText("comprovante.png")).toBeOnTheScreen();
    expect(client.downloadProof).toHaveBeenCalledWith("charge");
    expect(screen.getByLabelText("Comprovante comprovante.png")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Marcar como pago" }));

    await waitFor(() => expect(client.reviewProof).toHaveBeenCalledWith("charge", "accepted", undefined));
    expect(onDone).toHaveBeenCalled();
  });

  it("sends the optional reason along with a rejection", async () => {
    const onDone = jest.fn();
    const client = clientWith(charge({ proof: proof() }));

    await render(<ProofViewerScreen chargeId="charge" client={client} onDone={onDone} />);

    await fireEvent.changeText(await screen.findByLabelText("Motivo opcional"), "Valor diferente");
    await fireEvent.press(screen.getByRole("button", { name: "Rejeitar comprovante" }));

    await waitFor(() => expect(client.reviewProof).toHaveBeenCalledWith("charge", "rejected", "Valor diferente"));
    expect(onDone).toHaveBeenCalled();
  });

  it("lets the debtor replace a rejected proof and previews the new file", async () => {
    const rejected = charge({ direction: Direction.Payable, proofState: ProofState.Rejected, proof: proof({ state: ProofState.Rejected, reason: "Ilegível", file: { name: "antigo.pdf", mime: ProofMime.Pdf, size: 2048 }, sentByViewer: true }) });
    const replaced = charge({ direction: Direction.Payable, proofState: ProofState.Pending, proof: proof({ file: { name: "novo.png", mime: ProofMime.Png, size: 14 }, sentByViewer: true }) });
    const client = clientWith(rejected);
    const picker = jest.requireMock("expo-document-picker") as { getDocumentAsync: jest.Mock };
    const upload = jest.requireMock("expo/fetch") as { fetch: jest.Mock };

    // The screen opens on the rejected file; completing the upload answers with the new one.
    client.charge.mockResolvedValueOnce(rejected).mockResolvedValue(replaced);
    client.completeProofUpload.mockResolvedValue(replaced);
    picker.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/novo.png", name: "novo.png", mimeType: "image/png", size: 14, file: {} }] });
    upload.fetch.mockResolvedValue({ ok: true });
    client.startProofUpload.mockResolvedValue({ uploadUrl: "https://private.test/put", expiresAt: "2026-09-05T14:40:00Z" });

    await render(<ProofViewerScreen chargeId="charge" client={client} />);

    expect(await screen.findByText("antigo.pdf")).toBeOnTheScreen();
    expect(screen.getByTestId("pdf-view")).toBeOnTheScreen();
    expect(screen.getByText("Comprovante rejeitado: Ilegível. Você pode enviar outro arquivo.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Enviar novo comprovante" }));

    expect(await screen.findByText("novo.png", {}, { timeout: 4000 })).toBeOnTheScreen();
    expect(client.startProofUpload).toHaveBeenCalledWith("charge", { filename: "novo.png", mime: "image/png", size: 14 });
    expect(client.downloadProof).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Enviar novo comprovante" })).toBeNull();
  });

  it("explains when there is nothing to show", async () => {
    const client = clientWith(charge());

    await render(<ProofViewerScreen chargeId="charge" client={client} />);

    expect(await screen.findByText("Nenhum comprovante enviado.")).toBeOnTheScreen();
    expect(client.downloadProof).not.toHaveBeenCalled();
  });
});
