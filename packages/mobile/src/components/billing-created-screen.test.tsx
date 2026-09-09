import type { BillingDetail, ChargeDetail } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { BillingCreatedScreen } from "./billing-created-screen";

function charge(id: string, personId: string, name: string): ChargeDetail {
  return {
    id,
    billingId: "b1",
    recipient: { id: personId, name },
    amount: { amountCents: 5_000, currency: "BRL" },
    dueDate: "2026-09-10",
    state: "pending",
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
    paidAt: null,
    canceledAt: null,
    paymentMethod: null,
    publicLink: null,
    proofs: [],
    installment: 1,
    installmentCount: 1,
    category: "groceries",
  } as unknown as ChargeDetail;
}

function billing(overrides: Partial<BillingDetail> = {}): BillingDetail {
  return {
    id: "b1",
    type: "once",
    description: "Mercado QA",
    total: { amountCents: 10_000, currency: "BRL" },
    startDate: "2026-09-10",
    state: "active",
    nextDueDate: "2026-09-10",
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
    timezone: "America/Sao_Paulo",
    reminders: [],
    split: { mode: "equal", parts: [{ kind: "person", personId: "p1" }, { kind: "owner" }] },
    allocations: [],
    charges: [charge("c1", "p1", "Ana")],
    previews: [],
    nextMaterialization: null,
    category: "groceries",
    invite: null,
    ...overrides,
  };
}

function api(overrides: Record<string, unknown> = {}) {
  return {
    billing: jest.fn().mockResolvedValue(billing()),
    publicLink: jest.fn().mockResolvedValue({ token: "tok" }),
    publicChargeUrl: jest.fn().mockReturnValue("https://receivy.test/pay/tok"),
    invite: jest.fn().mockResolvedValue({ url: "https://receivy.test/convite/xyz", expiresAt: "2026-09-15T00:00:00Z" }),
    ...overrides,
  };
}

describe("BillingCreatedScreen", () => {
  beforeEach(() => jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never));
  afterEach(() => jest.restoreAllMocks());

  it("confirms the billing that was just created", async () => {
    const client = api();

    await render(<BillingCreatedScreen client={client as never} id="b1" onOpenCharge={jest.fn()} onBack={jest.fn()} />);

    expect(await screen.findByText("Cobrança criada")).toBeOnTheScreen();
    expect(screen.getByText("Mercado QA · R$ 100,00")).toBeOnTheScreen();
    expect(client.billing).toHaveBeenCalledWith("b1");
  });

  it("shares the public link of the single pending charge", async () => {
    const client = api();

    await render(<BillingCreatedScreen client={client as never} id="b1" onOpenCharge={jest.fn()} onBack={jest.fn()} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Compartilhar link" }));
    await waitFor(() => expect(Share.share).toHaveBeenCalled());

    expect(client.publicLink).toHaveBeenCalledWith("c1");
    expect(Share.share).toHaveBeenCalledWith({ title: "Cobrança Receivy", message: "https://receivy.test/pay/tok", url: "https://receivy.test/pay/tok" });
  });

  it("hides the public link when more than one person owes", async () => {
    const client = api({
      billing: jest.fn().mockResolvedValue(
        billing({
          split: { mode: "equal", parts: [{ kind: "person", personId: "p1" }, { kind: "person", personId: "p2" }] },
          charges: [charge("c1", "p1", "Ana"), charge("c2", "p2", "Bruno")],
        }),
      ),
    });

    await render(<BillingCreatedScreen client={client as never} id="b1" onOpenCharge={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Cobrança criada");

    expect(screen.queryByRole("button", { name: "Compartilhar link" })).toBeNull();
  });

  it("shares an invite for the billing", async () => {
    const client = api();

    await render(<BillingCreatedScreen client={client as never} id="b1" onOpenCharge={jest.fn()} onBack={jest.fn()} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Convidar" }));
    await waitFor(() => expect(client.invite).toHaveBeenCalledWith("b1"));

    expect(Share.share).toHaveBeenCalledWith({
      title: "Convite Receivy",
      message: "Entre na cobrança Mercado QA no Receivy: https://receivy.test/convite/xyz",
    });
  });

  it("opens the first charge and goes back to the list", async () => {
    const onOpenCharge = jest.fn();
    const onBack = jest.fn();

    await render(<BillingCreatedScreen client={api() as never} id="b1" onOpenCharge={onOpenCharge} onBack={onBack} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Ver cobrança" }));
    expect(onOpenCharge).toHaveBeenCalledWith("c1");

    await fireEvent.press(screen.getByRole("button", { name: "Voltar às cobranças" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("reports a billing it cannot load", async () => {
    const client = api({ billing: jest.fn().mockRejectedValue(new Error("Não foi possível carregar a cobrança.")) });

    await render(<BillingCreatedScreen client={client as never} id="b1" onOpenCharge={jest.fn()} onBack={jest.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a cobrança.");
    expect(screen.getByRole("button", { name: "Voltar às cobranças" })).toBeOnTheScreen();
  });
});
