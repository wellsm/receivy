import type { PublicInviteView } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { JoinInvite } from "./join-invite";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const view: PublicInviteView = {
  creditorFirstName: "Lucas",
  description: "Churrasco",
  amount: { amountCents: 12_000, currency: "BRL" },
  type: "once",
  participantCount: 3,
  category: "food",
  expired: false,
};

it("shows the invite summary and sends a signed out visitor to the login with the return path", () => {
  render(<JoinInvite token="tok-1" view={view} authenticated={false} />);

  expect(screen.getByText("Lucas")).toBeInTheDocument();
  expect(screen.getByText("te convidou para", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("Churrasco")).toBeInTheDocument();
  expect(screen.getByText("Alimentação")).toBeInTheDocument();
  expect(screen.getByText("R$ 120,00")).toBeInTheDocument();
  expect(screen.getByText("3 pessoas")).toBeInTheDocument();
  expect(screen.getByText("À vista")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Entrar para participar" })).toHaveAttribute("href", "/login?next=/join/tok-1");
  expect(screen.queryByRole("button", { name: "Participar" })).not.toBeInTheDocument();
});

it("accepts the invite and opens the new charge", async () => {
  vi.mocked(browserFetch).mockResolvedValue(Response.json({ billingId: "b1", chargeId: "c1", joinedSplit: true }));
  const user = userEvent.setup();
  render(<JoinInvite token="tok-1" view={view} authenticated />);

  await user.click(screen.getByRole("button", { name: "Participar" }));

  expect(browserFetch).toHaveBeenCalledWith("/api/financial/invites/tok-1/accept", { method: "POST" });
  expect(routerMock.replace).toHaveBeenCalledWith("/charges/c1");
  expect(window.sessionStorage.getItem("receivy.notice")).toBeNull();
});

it("stores a notice and goes to the feed when the split was not joined", async () => {
  vi.mocked(browserFetch).mockResolvedValue(Response.json({ billingId: "b1", chargeId: null, joinedSplit: false }));
  const user = userEvent.setup();
  render(<JoinInvite token="tok-1" view={view} authenticated />);

  await user.click(screen.getByRole("button", { name: "Participar" }));

  expect(routerMock.replace).toHaveBeenCalledWith("/");
  expect(window.sessionStorage.getItem("receivy.notice")).toBe("Você entrou como contato; o criador ajusta a divisão.");
});

it("shows the conflict message returned by the API", async () => {
  vi.mocked(browserFetch).mockResolvedValue(Response.json({ code: "CONFLICT" }, { status: 409 }));
  const user = userEvent.setup();
  render(<JoinInvite token="tok-1" view={view} authenticated />);

  await user.click(screen.getByRole("button", { name: "Participar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "O registro mudou ou esta ação já foi realizada. Atualize antes de tentar novamente.",
  );
  expect(routerMock.replace).not.toHaveBeenCalled();
});

it("shows the expired copy when the invite is gone", async () => {
  vi.mocked(browserFetch).mockResolvedValue(Response.json({ code: "NOT_FOUND" }, { status: 404 }));
  const user = userEvent.setup();
  render(<JoinInvite token="tok-1" view={view} authenticated />);

  await user.click(screen.getByRole("button", { name: "Participar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Convite expirado. Peça um novo link.");
});

it("hides the action for an expired invite", () => {
  render(<JoinInvite token="tok-1" view={{ ...view, expired: true }} authenticated />);

  expect(screen.getByText("Convite expirado. Peça um novo link.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Participar" })).not.toBeInTheDocument();
});
