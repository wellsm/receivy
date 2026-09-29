import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingRecurrence, ChargeState, Direction, ProofKind, ProofMime, ProofState, SharingState, type ChargeDetail, type ChargeProof } from "@receivy/common";
import { ProofViewerScreen } from "@/components/screens/proof-viewer-screen";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));

const API = "https://api.test";

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

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
    recipient: { userId: "u1", name: "Ana", email: null },
    debtorId: "u1",
    payment: null,
    paymentLink: null,
    receiptUrl: null,
    sharingState: SharingState.Ready,
    proof: proof(),
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01",
    ...overrides,
  };
}

/** Routes the API calls the screen makes; the charge answers unknown paths and `swap` changes what it says.
 * A URL outside the API (the signed bucket PUT) answers 204 and is recorded in `calls` verbatim. */
function serve(detail: ChargeDetail, extra: Record<string, (init?: RequestInit) => Response> = {}) {
  let current = detail;
  const calls: [string, RequestInit | undefined][] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.startsWith(`${API}/`)) {
      calls.push([url, init]);

      return new Response(null, { status: 204 });
    }

    const path = url.slice(API.length + 1);

    calls.push([path, init]);

    const key = `${init?.method ?? "GET"} ${path}`;
    const handler = Object.entries(extra).find(([route]) => route === key)?.[1];

    if (handler) {
      return handler(init);
    }

    if (key === "GET charges/charge/proof/download") {
      return Response.json({ url: `https://files.test/${current.proof?.file?.name}` });
    }

    return Response.json(current);
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    swap: (next: ChargeDetail) => {
      current = next;
    },
    calls,
  };
}

describe("ProofViewerScreen", () => {
  it("shows the proof and lets the creditor accept it", async () => {
    const review = vi.fn(() => Response.json(charge({ state: ChargeState.Paid, proofState: ProofState.Accepted, proof: proof({ state: ProofState.Accepted }) })));

    serve(charge(), { "POST charges/charge/proof/review": review });

    renderWithRouter(<ProofViewerScreen chargeId="charge" />);

    expect(await screen.findByRole("heading", { name: "comprovante.png" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Comprovante comprovante.png" })).toHaveAttribute("src", "https://files.test/comprovante.png");

    fireEvent.click(screen.getByRole("button", { name: "Marcar como pago" }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar pago" }));

    await waitFor(() => expect(review).toHaveBeenCalled());

    expect(navigate).toHaveBeenCalledWith("/charges/charge");
  });

  it("sends the optional reason along with a rejection", async () => {
    const review = vi.fn((init?: RequestInit) => Response.json(charge({ proofState: ProofState.Rejected, proof: proof({ state: ProofState.Rejected, reason: String(init?.body) }) })));

    serve(charge(), { "POST charges/charge/proof/review": review });

    renderWithRouter(<ProofViewerScreen chargeId="charge" />);

    fireEvent.change(await screen.findByLabelText("Motivo (opcional)"), { target: { value: "Valor diferente" } });
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar comprovante" }));

    await waitFor(() => expect(review).toHaveBeenCalled());

    expect(review.mock.calls[0]?.[0]?.body).toBe(JSON.stringify({ decision: "rejected", reason: "Valor diferente" }));
  });

  it("lets the debtor replace a rejected proof and previews the new file", async () => {
    const rejected = charge({ direction: Direction.Payable, proofState: ProofState.Rejected, proof: proof({ state: ProofState.Rejected, reason: "Ilegível", file: { name: "antigo.pdf", mime: ProofMime.Pdf, size: 2048 } }) });
    const replaced = charge({ direction: Direction.Payable, proof: proof({ file: { name: "novo.png", mime: ProofMime.Png, size: 3 }, sentByViewer: true }) });
    const { swap, calls } = serve(rejected, {
      "POST charges/charge/proof": () => {
        // The bucket event lands right after the PUT: the next read of the charge already carries the new file.
        swap(replaced);

        return Response.json({ uploadUrl: "https://upload.test/put", expiresAt: "2030-01-01" });
      },
    });

    renderWithRouter(<ProofViewerScreen chargeId="charge" />);

    expect(await screen.findByRole("heading", { name: "antigo.pdf" })).toBeInTheDocument();
    expect(screen.getByText("Comprovante rejeitado: Ilegível. Você pode enviar outro arquivo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como pago" })).not.toBeInTheDocument();

    const file = new File(["png"], "novo.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Enviar novo comprovante"), { target: { files: [file] } });

    expect(await screen.findByRole("heading", { name: "novo.png" })).toBeInTheDocument();
    expect(calls.some(([url, init]) => url === "https://upload.test/put" && init?.method === "PUT")).toBe(true);
    expect(screen.getByRole("img", { name: "Comprovante novo.png" })).toHaveAttribute("src", "https://files.test/novo.png");
    expect(screen.queryByRole("button", { name: "Enviar novo comprovante" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apagar e enviar outro" })).toBeInTheDocument();
  });

  it("lets the sender take back a pending proof and returns to the charge", async () => {
    const withdraw = vi.fn(() => new Response(null, { status: 204 }));

    serve(charge({ direction: Direction.Payable, proof: proof({ sentByViewer: true }) }), { "DELETE charges/charge/proof": withdraw });

    renderWithRouter(<ProofViewerScreen chargeId="charge" />);

    fireEvent.click(await screen.findByRole("button", { name: "Apagar e enviar outro" }));

    await waitFor(() => expect(withdraw).toHaveBeenCalled());

    expect(navigate).toHaveBeenCalledWith("/charges/charge");
  });

  it("explains when there is nothing to show", async () => {
    const { calls } = serve(charge({ proofState: null, proof: null }));

    renderWithRouter(<ProofViewerScreen chargeId="charge" />);

    expect(await screen.findByText("Nenhum comprovante enviado.")).toBeInTheDocument();
    expect(calls.some(([path]) => path === "charges/charge/proof/download")).toBe(false);
  });
});
