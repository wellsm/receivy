import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { chargeShareText, type BillingDetail, type ChargeDetail } from "@receivy/common";
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
});

const PIX = { keyType: "phone" as const, key: "11987654321", label: "" };

function charge(overrides: Partial<ChargeDetail> & { id: string; name: string }): ChargeDetail {
  const { name, ...rest } = overrides;

  return {
    description: "Jantar de despedida",
    amount: { amountCents: 6_000, currency: "BRL" },
    dueDate: "2026-11-15",
    state: "pending",
    billingId: "b1",
    billingType: "until",
    installment: 2,
    installmentCount: 3,
    counterpartName: name,
    proofState: null,
    direction: "receivable",
    recipient: { userId: "u1", name, email: null },
    debtorUserId: "u1",
    pix: PIX,
    sharingState: "ready",
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    ...rest,
  };
}

const firstCycle = [
  charge({ id: "c1", name: "Lucas F.", dueDate: "2026-10-15", installment: 1, state: "paid", paidAt: "2026-10-14T22:42:00Z" }),
  charge({ id: "c2", name: "Mariana S.", dueDate: "2026-10-15", installment: 1, state: "paid", paidAt: "2026-10-15T11:15:00Z" }),
  charge({ id: "c3", name: "Carlos", dueDate: "2026-10-15", installment: 1, state: "paid", paidAt: "2026-10-15T12:00:00Z" }),
];

const secondCycle = [
  charge({ id: "c4", name: "Lucas F.", state: "paid", paidAt: "2026-11-14T22:42:00Z" }),
  charge({ id: "c5", name: "Mariana S.", state: "paid", paidAt: "2026-11-15T11:15:00Z" }),
  charge({ id: "c6", name: "Carlos" }),
];

function billing(overrides: Partial<BillingDetail> = {}): BillingDetail {
  return {
    id: "b1",
    type: "until",
    direction: "receivable",
    payee: null,
    pix: null,
    description: "Jantar de despedida",
    total: { amountCents: 18_000, currency: "BRL" },
    startDate: "2026-10-15",
    endDate: "2026-12-15",
    state: "active",
    installmentCount: 3,
    nextDueDate: "2026-11-15",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    timezone: "America/Sao_Paulo",
    paymentMethodId: "pix-1",
    reminders: [],
    split: { mode: "equal", parts: [{ kind: "user", userId: "u1" }] },
    allocations: [],
    charges: [...firstCycle, ...secondCycle],
    previews: [],
    nextMaterialization: null,
    category: "food",
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

it("sums the current cycle in the hero and lists its participants with their status", async () => {
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

it("asks the owner to review a sent proof instead of reminding the debtor", async () => {
  const detail = billing({ charges: [charge({ id: "c4", name: "Lucas F.", state: "paid" }), charge({ id: "c6", name: "Carlos", proofState: "pending" })] });
  await open(detail);

  expect(screen.getByText("Em revisão")).toBeInTheDocument();
  expect(screen.getByText("Comprovante em revisão")).toBeInTheDocument();
  expect(screen.queryByText("Aguardando pagamento")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Lembrar Carlos" })).not.toBeInTheDocument();

  await userEvent.setup().click(screen.getByRole("button", { name: "Revisar comprovante de Carlos" }));

  expect(router.push).toHaveBeenCalledWith("/charges/c6");
});

it("accepts the proof under review when the owner marks that participant as paid from the row", async () => {
  const detail = billing({ charges: [charge({ id: "c4", name: "Lucas F.", state: "paid" }), charge({ id: "c6", name: "Carlos", proofState: "pending" })] });
  const calls = await open(detail, (path, init) => {
    if (path === "/api/financial/charges/c6/proof/review" && init?.method === "POST") return Response.json(charge({ id: "c6", name: "Carlos", state: "paid", proofState: "accepted" }));
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

it("pauses and resumes only a subscription", async () => {
  const calls = await open(billing({ type: "indefinite", frequency: "monthly", installmentCount: undefined, endDate: undefined }));
  const user = setup();

  expect(screen.getByText("Recorrente mensal")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Pausar" }));

  expect(calls).toContain("PATCH /api/financial/billings/b1");
  expect(await screen.findByRole("button", { name: "Retomar" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
});

it("has no pause for a finite billing", async () => {
  await open();

  expect(screen.queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();
});

it("names the Pix key from the wallet while no charge has been generated", async () => {
  const detail = billing({ type: "indefinite", frequency: "monthly", installmentCount: undefined, endDate: undefined, charges: [], paymentMethodId: "pix-2" });
  const wallet = [{ id: "pix-2", type: "pix", pixKeyType: "email", pixKey: "ana@example.com", label: "", isDefault: true, archivedAt: null, createdAt: "" }];

  await open(detail, (path) => (path === "/api/financial/payment-methods" ? Response.json({ paymentMethods: wallet }) : undefined));

  expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  expect(screen.queryByText("Sem chave Pix vinculada")).not.toBeInTheDocument();
});

it("ends only after confirmation, revokes the invite and hides the actions", async () => {
  const calls = await open(billing({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } }));
  const user = setup();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));

  expect(await screen.findByRole("dialog", { name: "Encerrar conta?" })).toBeInTheDocument();
  expect(calls).not.toContain("PATCH /api/financial/billings/b1");

  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Encerrar" }));

  expect(await screen.findByText("Encerrada")).toBeInTheDocument();
  expect(calls).toContain("PATCH /api/financial/billings/b1");
  expect(calls).toContain("DELETE /api/financial/billings/b1/invite");
  expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).not.toBeInTheDocument();
});

it("shows a conta a pagar with its inline key and payee, without invite, link or reminders", async () => {
  const detail = billing({
    direction: "payable",
    payee: { userId: "u1", name: "Ana" },
    pix: { keyType: "email", key: "ana@example.com", label: "Nubank" },
    paymentMethodId: undefined,
    invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" },
    charges: [charge({ id: "c6", name: "Ana", direction: "payable", payer: "owner", ownedByViewer: true })],
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

it("names a conta a pagar without payee or key as the owner's alone", async () => {
  await open(billing({ direction: "payable", pix: null, paymentMethodId: undefined, charges: [charge({ id: "c6", name: "Você", direction: "payable", payer: "owner", ownedByViewer: true })] }));

  expect(screen.getByText("Sem chave Pix")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Abrir cobrança de Só comigo" })).toBeInTheDocument();
});

it("marks a pending participant as paid only after confirmation and reloads", async () => {
  let paid = false;
  const calls = await open(billing(), (path, init) => {
    if (path === "/api/financial/billings/b1" && (init?.method ?? "GET") === "GET" && paid) {
      return Response.json(billing({ charges: [...firstCycle, ...secondCycle.slice(0, 2), charge({ id: "c6", name: "Carlos", state: "paid", paidAt: "2026-11-16T10:00:00Z" })] }));
    }

    if (path === "/api/financial/charges/c6/pay" && init?.method === "POST") {
      paid = true;
      return Response.json(charge({ id: "c6", name: "Carlos", state: "paid" }));
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
