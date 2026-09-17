import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BillingCategory, BillingFrequency, BillingState, BillingKind, BillingRecurrence, ChargeState, chargeShareText, Direction, PendingChargesAction, PixKeyType, ProofState, SharingState, SplitMode, SplitPartKind, type BillingDetail, type ChargeDetail } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { BillingDetailScreen } from "@/components/screens/billing-detail-screen";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const writeText = vi.fn(async () => {});

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** userEvent installs its own clipboard stub on setup, so ours has to land afterwards. */
function setup() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  return user;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

const PIX = { keyType: PixKeyType.Phone, key: "11987654321", label: "" };

function charge(overrides: Partial<ChargeDetail> & { id: string; name: string }): ChargeDetail {
  const { name, ...rest } = overrides;

  return {
    description: "Jantar de despedida",
    amount: { amountCents: 6_000, currency: "BRL" },
    dueDate: "2026-11-15",
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Until,
    installment: 2,
    installmentCount: 3,
    counterpartName: name,
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: "u1", name, email: null },
    debtorId: "u1",
    pix: PIX,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    ...rest,
  };
}

const firstCycle = [
  charge({ id: "c1", name: "Lucas F.", dueDate: "2026-10-15", installment: 1, state: ChargeState.Paid, paidAt: "2026-10-14T22:42:00Z" }),
  charge({ id: "c2", name: "Mariana S.", dueDate: "2026-10-15", installment: 1, state: ChargeState.Paid, paidAt: "2026-10-15T11:15:00Z" }),
  charge({ id: "c3", name: "Carlos", dueDate: "2026-10-15", installment: 1, state: ChargeState.Paid, paidAt: "2026-10-15T12:00:00Z" }),
];

const secondCycle = [
  charge({ id: "c4", name: "Lucas F.", state: ChargeState.Paid, paidAt: "2026-11-14T22:42:00Z" }),
  charge({ id: "c5", name: "Mariana S.", state: ChargeState.Paid, paidAt: "2026-11-15T11:15:00Z" }),
  charge({ id: "c6", name: "Carlos" }),
];

function billing(overrides: Partial<BillingDetail> = {}): BillingDetail {
  return {
    id: "b1",
    recurrence: BillingRecurrence.Until,
    type: Direction.Receivable,
    contact: null,
    counterpart: null,
    pix: null,
    description: "Jantar de despedida",
    total: { amountCents: 18_000, currency: "BRL" },
    startDate: "2026-10-15",
    endDate: "2026-12-15",
    state: BillingState.Active,
    installmentCount: 3,
    nextDueDate: "2026-11-15",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    timezone: "America/Sao_Paulo",
    paymentMethodId: "pix-1",
    reminders: [],
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
    allocations: [],
    charges: [...firstCycle, ...secondCycle],
    previews: [],
    nextMaterialization: null,
    category: BillingCategory.Food,
    invite: null,
    guests: [],
    linkableContacts: [],
    ...overrides,
  };
}

type Handler = (path: string, init?: RequestInit) => Response | undefined;

/** Answers the detail and an empty wallet by default; `handler` overrides any call. */
function mockApi(detail: BillingDetail, handler: Handler = () => undefined): string[] {
  const calls: string[] = [];
  let current = detail;

  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);

    const custom = handler(path, init);

    if (custom) {
      return custom;
    }

    if (path === "/api/financial/billings/b1" && method === "GET") return Response.json(current);
    if (path === "/api/financial/billings/b1" && method === "PATCH") {
      current = { ...current, ...(JSON.parse(String(init?.body)) as Partial<BillingDetail>) };
      return Response.json(current);
    }
    if (path === "/api/financial/payment-methods") return Response.json({ paymentMethods: [] });
    if (path === "/api/financial/billings/b1/invite" && method === "POST") {
      return Response.json({ url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" });
    }
    if (path === "/api/financial/billings/b1/invite" && method === "DELETE") return new Response(null, { status: 204 });
    if (path.endsWith("/public-link") && method === "POST") return Response.json({ token: "tk", expiresAt: "2026-10-08T00:00:00Z" });
    if (path.endsWith("/reminders") && method === "POST") return Response.json({ queued: true });

    return Response.json({ message: "não mapeado" }, { status: 404 });
  });

  return calls;
}

async function open(detail = billing(), handler?: Handler) {
  const calls = mockApi(detail, handler);

  render(<BillingDetailScreen id="b1" />);
  await screen.findByRole("heading", { name: "Jantar de despedida" });

  return calls;
}

function patchBodies(): unknown[] {
  return vi
    .mocked(browserFetch)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

it("sums the current cycle in the hero and lists its participants with their status", async () => {
  // Pinned before the second cycle's due date (2026-11-15) so Carlos's charge reads "Pendente", not
  // "Vence hoje"/"Atrasado" once the real clock catches up to it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));

  await open();

  expect(screen.getByText("Parcelado (2/3)")).toBeInTheDocument();
  expect(screen.getByText("Ativa")).toBeInTheDocument();
  expect(screen.getByText("15/11/2026")).toBeInTheDocument();
  expect(screen.getByText("R$ 120,00")).toBeInTheDocument();
  expect(screen.getByText("66% liquidado")).toBeInTheDocument();
  expect(screen.getByText("Falta R$ 60,00")).toBeInTheDocument();
  expect(screen.getByText("11987654321")).toBeInTheDocument();
  expect(screen.getByText("Ciclo 2 de 3")).toBeInTheDocument();

  const lucas = screen.getByRole("button", { name: "Abrir cobrança de Lucas F." });
  expect(within(lucas).getByText("Pago em 14/11 às 19:42")).toBeInTheDocument();
  expect(within(lucas).getByText("Pago")).toBeInTheDocument();
  expect(screen.getByText("Pendente")).toBeInTheDocument();
  expect(screen.getByText("Aguardando pagamento")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compartilhar link de Carlos" })).toBeInTheDocument();
});

it("tags a pending charge as Atrasado, Vence hoje or Pendente depending on its due date, agreeing with the feed", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z")); // noon UTC = 09:00 in America/Sao_Paulo, same calendar day

  const overdue = billing({ nextDueDate: "2026-11-15", charges: [charge({ id: "c1", name: "Carlos", dueDate: "2026-11-15" })] });
  await open(overdue);
  expect(screen.getByText("Atrasado")).toBeInTheDocument();
  cleanup();

  const dueToday = billing({ nextDueDate: "2026-11-20", charges: [charge({ id: "c2", name: "Carlos", dueDate: "2026-11-20" })] });
  await open(dueToday);
  // The corner tag and the secondary line both read "Vence hoje" for a charge due today.
  expect(screen.getAllByText("Vence hoje")).toHaveLength(2);
  cleanup();

  const future = billing({ nextDueDate: "2027-01-31", charges: [charge({ id: "c3", name: "Carlos", dueDate: "2027-01-31" })] });
  await open(future);
  expect(screen.getByText("Pendente")).toBeInTheDocument();

  vi.useRealTimers();
});

it("still tags a paid charge Pago once its due date has passed", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));

  const paid = billing({
    nextDueDate: "2026-11-15",
    charges: [charge({ id: "c1", name: "Carlos", dueDate: "2026-11-15", state: ChargeState.Paid, paidAt: "2026-11-14T22:42:00Z" })],
  });
  await open(paid);

  expect(screen.getByText("Pago")).toBeInTheDocument();

  vi.useRealTimers();
});

it("asks the owner to review a sent proof instead of reminding the debtor", async () => {
  const detail = billing({ charges: [charge({ id: "c4", name: "Lucas F.", state: ChargeState.Paid }), charge({ id: "c6", name: "Carlos", proofState: ProofState.Pending })] });
  await open(detail);

  expect(screen.getByText("Em revisão")).toBeInTheDocument();
  expect(screen.getByText("Comprovante em revisão")).toBeInTheDocument();
  expect(screen.queryByText("Aguardando pagamento")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Lembrar Carlos" })).not.toBeInTheDocument();

  await userEvent.setup().click(screen.getByRole("button", { name: "Revisar comprovante de Carlos" }));

  expect(router.push).toHaveBeenCalledWith("/charges/c6");
});

it("accepts the proof under review when the owner marks that participant as paid from the row", async () => {
  const detail = billing({ charges: [charge({ id: "c4", name: "Lucas F.", state: ChargeState.Paid }), charge({ id: "c6", name: "Carlos", proofState: ProofState.Pending })] });
  const calls = await open(detail, (path, init) => {
    if (path === "/api/financial/charges/c6/proof/review" && init?.method === "POST") return Response.json(charge({ id: "c6", name: "Carlos", state: ChargeState.Paid, proofState: ProofState.Accepted }));
    return undefined;
  });
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Marcar Carlos como pago" }));
  await user.click(await screen.findByRole("button", { name: "Marcar paga" }));

  await vi.waitFor(() => expect(calls).toContain("POST /api/financial/charges/c6/proof/review"));
  expect(calls).not.toContain("POST /api/financial/charges/c6/pay");
  expect(calls).not.toContain("GET /api/financial/charges/c6/proofs");
  expect(await screen.findByText("Pagamento de Carlos registrado.")).toBeInTheDocument();
});

it("lists every cycle in the history, newest first", async () => {
  await open();

  expect(screen.getByText("Total: 2 ciclos")).toBeInTheDocument();
  expect(screen.getByText(/Parcela 2 de 3/)).toBeInTheDocument();
  expect(screen.getByText("2 de 3 participantes pagos")).toBeInTheDocument();
  expect(screen.getByText("Em andamento")).toBeInTheDocument();
  expect(screen.getByText(/Parcela 1 de 3/)).toBeInTheDocument();
  expect(screen.getByText("Todos os 3 pagaram")).toBeInTheDocument();
  expect(screen.getByText("Concluída")).toBeInTheDocument();
});

it("copies the Pix key and shares the link of a pending participant from its row", async () => {
  const calls = await open();
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Copiar chave Pix" }));
  expect(writeText).toHaveBeenCalledWith("11987654321");
  expect(await screen.findByText("Copiado")).toBeInTheDocument();

  expect(screen.queryByRole("button", { name: "Lembrar Carlos" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Compartilhar link de Carlos" }));
  expect(calls).toContain("POST /api/financial/charges/c6/public-link");
  expect(writeText).toHaveBeenCalledWith(chargeShareText(charge({ id: "c6", name: "Carlos" }), "http://localhost:3000/pay/tk"));
});

it("copies the payment link of the only pending participant", async () => {
  const calls = await open();
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Compartilhar link de pagamento" }));

  expect(calls).toContain("POST /api/financial/charges/c6/public-link");
  expect(writeText).toHaveBeenCalledWith(chargeShareText(charge({ id: "c6", name: "Carlos" }), "http://localhost:3000/pay/tk"));
  expect(await screen.findByRole("status")).toHaveTextContent("Link copiado");
});

it("asks whose link to share when more than one participant is pending", async () => {
  const detail = billing({ charges: [...firstCycle, charge({ id: "c4", name: "Lucas F." }), charge({ id: "c6", name: "Carlos" })] });
  const calls = await open(detail);
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Compartilhar link de pagamento" }));
  await user.click(await screen.findByRole("button", { name: "Link de Lucas F." }));

  expect(calls).toContain("POST /api/financial/charges/c4/public-link");
});

it("opens the charge and the edit route from the actions", async () => {
  await open();
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Abrir cobrança de Carlos" }));
  await user.click(screen.getByRole("button", { name: "Editar" }));

  expect(router.push).toHaveBeenCalledWith("/charges/c6");
  expect(router.push).toHaveBeenCalledWith("/billings/b1/edit");
});

it("creates, copies and revokes the invite", async () => {
  const calls = await open();
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Convidar" }));

  expect(calls).toContain("POST /api/financial/billings/b1/invite");
  expect(writeText).toHaveBeenCalledWith("Entre na cobrança Jantar de despedida no Receivy: http://localhost:3000/join/abc");
  expect(await screen.findByText("Convite ativo até 08/10")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Revogar convite" }));

  expect(calls).toContain("DELETE /api/financial/billings/b1/invite");
  expect(screen.queryByText("Convite ativo até 08/10")).not.toBeInTheDocument();
});

it("links a guest who joined by the link to a contact without e-mail", async () => {
  const guest = { id: "g1", userId: "u9", name: "José Silva", email: "ze@example.com", createdAt: "2026-10-02T00:00:00Z" };
  const resolved = billing();
  const sent: string[] = [];
  const calls = await open(billing({ guests: [guest], linkableContacts: [{ contactId: "c1", displayName: "Zé" }] }), (path, init) => {
    if (path === "/api/financial/billings/b1/guests/g1" && init?.method === "POST") {
      sent.push(String(init.body));
      return Response.json(resolved);
    }

    return undefined;
  });
  const user = setup();

  expect(screen.getByRole("heading", { name: "Aguardando você" })).toBeInTheDocument();
  expect(screen.getByText("ze@example.com")).toBeInTheDocument();
  expect(screen.getByText("Entrou pelo link. Quem é essa pessoa?")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Novo participante" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ignorar" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "É Zé" }));

  expect(calls).toContain("POST /api/financial/billings/b1/guests/g1");
  expect(sent).toEqual(['{"action":"link","contactId":"c1"}']);
  expect(screen.queryByRole("heading", { name: "Aguardando você" })).not.toBeInTheDocument();
});

it("shares an invite that already exists instead of issuing a new one", async () => {
  const calls = await open(billing({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } }));
  const user = setup();

  expect(screen.getByText("Convite ativo até 08/10")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Convidar" }));

  expect(calls).not.toContain("POST /api/financial/billings/b1/invite");
  expect(writeText).toHaveBeenCalled();
});

it("asks what to do with the pending charges before pausing a subscription", async () => {
  await open(billing({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined }));
  const user = setup();

  expect(screen.getByText("Recorrente mensal")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Pausar" }));

  const dialog = await screen.findByRole("dialog", { name: "Pausar conta?" });
  expect(patchBodies()).toEqual([]);

  await user.click(within(dialog).getByRole("button", { name: "Manter as deste mês" }));

  expect(patchBodies()).toEqual([{ state: "paused", pendingCharges: PendingChargesAction.Keep }]);
  expect(await screen.findByRole("button", { name: "Retomar" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
});

it("pauses right away when nothing is pending", async () => {
  await open(billing({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined, charges: firstCycle }));
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Pausar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(patchBodies()).toEqual([{ state: "paused" }]);
});

it("has no pause for a finite billing", async () => {
  await open();

  expect(screen.queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();
});

it("names the Pix key from the wallet while no charge has been generated", async () => {
  const detail = billing({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined, charges: [], paymentMethodId: "pix-2" });
  const wallet = [{ id: "pix-2", type: "pix", pixKeyType: "email", pixKey: "ana@example.com", label: "", isDefault: true, archivedAt: null, createdAt: "" }];

  await open(detail, (path) => (path === "/api/financial/payment-methods" ? Response.json({ paymentMethods: wallet }) : undefined));

  expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  expect(screen.queryByText("Sem chave Pix vinculada")).not.toBeInTheDocument();
});

it("ends cancelling the pending charges, revokes the invite and hides the actions", async () => {
  const calls = await open(billing({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } }));
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));

  expect(await screen.findByRole("dialog", { name: "Encerrar conta?" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Voltar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar pendentes (1)" }));

  expect(await screen.findByText("Encerrada")).toBeInTheDocument();
  expect(patchBodies()).toEqual([{ state: "ended", pendingCharges: PendingChargesAction.Cancel }]);
  expect(calls).toContain("DELETE /api/financial/billings/b1/invite");
  expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).not.toBeInTheDocument();
});

it("ends with the simple confirmation when nothing is pending", async () => {
  await open(billing({ charges: firstCycle }));
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  await user.click(within(await screen.findByRole("dialog", { name: "Encerrar conta?" })).getByRole("button", { name: "Encerrar" }));

  expect(await screen.findByText("Encerrada")).toBeInTheDocument();
  expect(patchBodies()).toEqual([{ state: "ended" }]);
});

it("shows a conta a pagar with its inline key and receiving contact, without invite, link or reminders", async () => {
  const detail = billing({
    type: Direction.Payable,
    contact: { id: "c1", userId: "u1", name: "Ana", avatar: null },
    counterpart: { id: "c1", userId: "u1", name: "Ana", avatar: null },
    pix: { keyType: PixKeyType.Email, key: "ana@example.com", label: "Nubank" },
    paymentMethodId: undefined,
    invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" },
    charges: [charge({ id: "c6", name: "Ana", direction: Direction.Payable, ownedByViewer: true })],
  });
  const calls = await open(detail);
  const user = setup();

  expect(screen.getByText("A pagar")).toBeInTheDocument();
  expect(screen.getByText("Total pago")).toBeInTheDocument();
  expect(screen.getByText("Meta da rodada")).toBeInTheDocument();
  expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cobranças" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Abrir cobrança de Ana" })).toBeInTheDocument();
  expect(screen.getByText("Aguardando pagamento")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Lembrar Ana" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Convite ativo/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Editar" })).toHaveAttribute("title", "Categoria, Pix e lembretes");

  await user.click(screen.getByRole("button", { name: "Copiar chave Pix" }));

  expect(writeText).toHaveBeenCalledWith("ana@example.com");
  expect(calls).not.toContain("GET /api/financial/payment-methods/pix-1");
});

it("names a conta a pagar without a contact or key as the owner's alone", async () => {
  await open(billing({ type: Direction.Payable, pix: null, paymentMethodId: undefined, charges: [charge({ id: "c6", name: "Você", direction: Direction.Payable, ownedByViewer: true })] }));

  expect(screen.getByText("Sem chave Pix")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Abrir cobrança de Só comigo" })).toBeInTheDocument();
});

it("marks a pending participant as paid only after confirmation and reloads", async () => {
  let paid = false;
  const calls = await open(billing(), (path, init) => {
    if (path === "/api/financial/billings/b1" && (init?.method ?? "GET") === "GET" && paid) {
      return Response.json(billing({ charges: [...firstCycle, ...secondCycle.slice(0, 2), charge({ id: "c6", name: "Carlos", state: ChargeState.Paid, paidAt: "2026-11-16T10:00:00Z" })] }));
    }

    if (path === "/api/financial/charges/c6/pay" && init?.method === "POST") {
      paid = true;
      return Response.json(charge({ id: "c6", name: "Carlos", state: ChargeState.Paid }));
    }

    return undefined;
  });
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Marcar Carlos como pago" }));

  const dialog = await screen.findByRole("dialog", { name: "Marcar como paga?" });
  expect(calls).not.toContain("POST /api/financial/charges/c6/pay");

  await user.click(within(dialog).getByRole("button", { name: "Marcar paga" }));

  expect(await screen.findByText("Pagamento de Carlos registrado.")).toBeInTheDocument();
  expect(calls).toContain("POST /api/financial/charges/c6/pay");
  expect(calls.filter((call) => call === "GET /api/financial/billings/b1")).toHaveLength(2);
  await waitFor(() => expect(screen.getAllByText("Todos os 3 pagaram")).toHaveLength(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Marcar Carlos como pago" })).not.toBeInTheDocument();
});

it("reopens a paid participant only after confirmation", async () => {
  const calls = await open(billing(), (path, init) => {
    if (path === "/api/financial/charges/c4/reopen" && init?.method === "POST") {
      return Response.json(charge({ id: "c4", name: "Lucas F." }));
    }

    return undefined;
  });
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Reabrir cobrança de Lucas F." }));

  const dialog = await screen.findByRole("dialog", { name: "Reabrir cobrança?" });
  expect(calls).not.toContain("POST /api/financial/charges/c4/reopen");

  await user.click(within(dialog).getByRole("button", { name: "Reabrir" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(calls).toContain("POST /api/financial/charges/c4/reopen");
  await waitFor(() => expect(calls.filter((call) => call === "GET /api/financial/billings/b1")).toHaveLength(2));
});

it("reports a billing that cannot be loaded and retries", async () => {
  let failed = false;

  mockApi(billing(), (path, init) => {
    if (path === "/api/financial/billings/b1" && (init?.method ?? "GET") === "GET" && !failed) {
      failed = true;
      return Response.json({ code: "unknown" }, { status: 500 });
    }

    return undefined;
  });

  render(<BillingDetailScreen id="b1" />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a cobrança.");

  const user = setup();
  await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

  expect(await screen.findByRole("heading", { name: "Jantar de despedida" })).toBeInTheDocument();
});

it("badges each charge with the notices off on its own row and shows the participant action once", async () => {
  await open(
    billing({
      charges: [
        charge({ id: "c6", name: "Carlos", notify: false }),
        charge({ id: "c7", name: "Carlos", state: ChargeState.Cancelled, cancelledAt: "2026-11-01T00:00:00Z" }),
      ],
      allocations: [{ kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 6_000, currency: "BRL" }, order: 0, notify: true }],
    }),
  );

  expect(screen.getAllByRole("button", { name: "Abrir cobrança de Carlos" })).toHaveLength(2);
  expect(screen.getAllByText("Sem avisos")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Não notificar Carlos" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Voltar a notificar Carlos" })).not.toBeInTheDocument();
});

it("turns the notices of a participant off after confirmation and back on without asking", async () => {
  const quietBilling = billing({
    charges: [charge({ id: "c6", name: "Carlos", notify: false })],
    allocations: [{ kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 6_000, currency: "BRL" }, order: 0, notify: false }],
  });
  const loudBilling = billing({ charges: [charge({ id: "c6", name: "Carlos", notify: true })], allocations: [{ ...quietBilling.allocations[0]!, notify: true }] });
  const bodies: string[] = [];
  const calls = await open(loudBilling, (path, init) => {
    if (path !== "/api/financial/billings/b1/participants/u1/notify" || init?.method !== "PUT") return undefined;

    bodies.push(String(init.body));

    return Response.json(JSON.parse(String(init.body)).notify ? loudBilling : quietBilling);
  });
  const user = setup();

  expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Não notificar Carlos" }));

  const dialog = await screen.findByRole("dialog", { name: "Não notificar Carlos?" });

  expect(within(dialog).getByText("Os lembretes automáticos das cobranças pendentes e futuras de Carlos nesta conta param.")).toBeInTheDocument();
  expect(calls).not.toContain("PUT /api/financial/billings/b1/participants/u1/notify");

  await user.click(within(dialog).getByRole("button", { name: "Não notificar" }));

  expect(await screen.findByText("Sem avisos")).toBeInTheDocument();
  expect(bodies).toEqual(['{"notify":false}']);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Voltar a notificar Carlos" }));

  expect(await screen.findByText("Avisos reativados para Carlos.")).toBeInTheDocument();
  expect(bodies).toEqual(['{"notify":false}', '{"notify":true}']);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("Sem avisos")).not.toBeInTheDocument();
});

it("heads a registro with its counterpart and hides the invite and the payment links", async () => {
  const salary = charge({
    id: "c8",
    name: "Empresa X",
    recipient: { userId: null, name: "Empresa X", email: null },
    debtorId: null,
    pix: null,
    sharingState: SharingState.Closed,
    kind: BillingKind.Record,
  });

  await open(
    billing({
      kind: BillingKind.Record,
      counterpart: { id: "c1", userId: "u1", name: "Empresa X", avatar: null },
      paymentMethodId: undefined,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
      charges: [salary],
    }),
  );

  expect(screen.getByText("De Empresa X")).toBeInTheDocument();
  expect(screen.getByText("Registro")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cobranças" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Participantes" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Marcar Empresa X como pago" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de Empresa X" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).not.toBeInTheDocument();
});

it("heads a registro a pagar with Para and names its rows after the counterpart", async () => {
  const rent = charge({
    id: "c9",
    name: "Imobiliária",
    direction: Direction.Payable,
    ownedByViewer: true,
    recipient: { userId: null, name: "Imobiliária", email: null },
    debtorId: null,
    pix: null,
    kind: BillingKind.Record,
  });

  const imobiliaria = { id: "c2", userId: "u2", name: "Imobiliária", avatar: null };

  await open(billing({ type: Direction.Payable, kind: BillingKind.Record, contact: imobiliaria, counterpart: imobiliaria, paymentMethodId: undefined, charges: [rent] }));

  expect(screen.getByText("Para Imobiliária")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Abrir cobrança de Imobiliária" })).toBeInTheDocument();
});

it("heads a registro nobody is named on with the word alone", async () => {
  await open(billing({ kind: BillingKind.Record, counterpart: null, paymentMethodId: undefined, charges: [] }));

  // The badge says "Registro" too; the headline is the paragraph that would otherwise read "De ".
  expect((await screen.findAllByText("Registro")).some(node => node.tagName === "P")).toBe(true);
  expect(screen.queryByText(/^De\s*$/)).not.toBeInTheDocument();
});

it("names the payer of a registro a receber that has no charge yet", async () => {
  await open(
    billing({
      kind: BillingKind.Record,
      counterpart: { id: "c1", userId: "u1", name: "Empresa X", avatar: null },
      paymentMethodId: undefined,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
      charges: [],
    }),
  );

  expect(await screen.findByText("De Empresa X")).toBeInTheDocument();
});
