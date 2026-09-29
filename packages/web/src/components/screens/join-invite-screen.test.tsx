import { BillingCategory, BillingRecurrence, type PublicInviteView } from "@receivy/common";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JoinInviteScreen } from "@/components/screens/join-invite-screen";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.test");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const view: PublicInviteView = {
  creditorFirstName: "Lucas",
  description: "Churrasco",
  amount: { amountCents: 12_000, currency: "BRL" },
  recurrence: BillingRecurrence.Once,
  participantCount: 3,
  category: BillingCategory.Food,
  expired: false,
};

it("shows the invite summary and sends a signed out visitor to the login with the return path", async () => {
  renderWithRouter(<JoinInviteScreen token="tok-1" view={view} authenticated={false} />);

  expect(await screen.findByText("Lucas")).toBeInTheDocument();
  expect(screen.getByText("te convidou para", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("Churrasco")).toBeInTheDocument();
  expect(screen.getByText("Alimentação")).toBeInTheDocument();
  expect(screen.getByText("R$ 120,00")).toBeInTheDocument();
  expect(screen.getByText("3 pessoas")).toBeInTheDocument();
  expect(screen.getByText("À vista")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Entrar para participar" })).toHaveAttribute("href", "/login?next=%2Fjoin%2Ftok-1");
  expect(screen.queryByRole("button", { name: "Participar" })).not.toBeInTheDocument();
});

it("accepts the invite and opens the new charge", async () => {
  fetchMock.mockResolvedValue(Response.json({ billingId: "b1", chargeId: "c1", joinedSplit: true, awaitingOwner: false }));

  const user = userEvent.setup();

  renderWithRouter(<JoinInviteScreen token="tok-1" view={view} authenticated />);

  await user.click(await screen.findByRole("button", { name: "Participar" }));

  expect(fetchMock).toHaveBeenCalledWith("https://api.test/invites/tok-1/accept", expect.objectContaining({ method: "POST" }));
  expect(navigate).toHaveBeenCalledWith("/charges/c1", { replace: true });
  expect(window.sessionStorage.getItem("receivy.notice")).toBeNull();
});

it("stores a notice and goes to the feed when the split was not joined", async () => {
  fetchMock.mockResolvedValue(Response.json({ billingId: "b1", chargeId: null, joinedSplit: false, awaitingOwner: false }));

  const user = userEvent.setup();

  renderWithRouter(<JoinInviteScreen token="tok-1" view={view} authenticated />);

  await user.click(await screen.findByRole("button", { name: "Participar" }));

  expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  expect(window.sessionStorage.getItem("receivy.notice")).toBe("Você entrou como contato; o criador ajusta a divisão.");
});

it("stores the awaiting notice and goes to the feed while the owner has to confirm the guest", async () => {
  fetchMock.mockResolvedValue(Response.json({ billingId: "b1", chargeId: null, joinedSplit: false, awaitingOwner: true }));

  const user = userEvent.setup();

  renderWithRouter(<JoinInviteScreen token="tok-1" view={view} authenticated />);

  await user.click(await screen.findByRole("button", { name: "Participar" }));

  expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  expect(window.sessionStorage.getItem("receivy.notice")).toBe("Você entrou. O dono da conta vai confirmar sua participação e a cobrança aparece no seu feed.");
});

it("shows the conflict message returned by the API", async () => {
  fetchMock.mockResolvedValue(Response.json({ code: "CONFLICT" }, { status: 409 }));

  const user = userEvent.setup();

  renderWithRouter(<JoinInviteScreen token="tok-1" view={view} authenticated />);

  await user.click(await screen.findByRole("button", { name: "Participar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "O registro mudou ou esta ação já foi realizada. Atualize antes de tentar novamente.",
  );
  expect(navigate).not.toHaveBeenCalled();
});

it("shows the expired copy when the invite is gone", async () => {
  fetchMock.mockResolvedValue(Response.json({ code: "NOT_FOUND" }, { status: 404 }));

  const user = userEvent.setup();

  renderWithRouter(<JoinInviteScreen token="tok-1" view={view} authenticated />);

  await user.click(await screen.findByRole("button", { name: "Participar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Convite expirado. Peça um novo link.");
});

it("exposes nothing but the expired notice for an unusable invite", async () => {
  renderWithRouter(<JoinInviteScreen token="tok-1" view={{ expired: true }} authenticated />);

  expect(await screen.findByText("Convite expirado. Peça um novo link.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Participar" })).not.toBeInTheDocument();
  expect(screen.queryByText("Churrasco")).not.toBeInTheDocument();
  expect(screen.queryByText("R$ 120,00")).not.toBeInTheDocument();
  expect(screen.queryByText("Lucas")).not.toBeInTheDocument();
});
