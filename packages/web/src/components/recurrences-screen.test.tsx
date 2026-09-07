import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { RecurrencesScreen } from "./recurrences-screen";
import type { RecurrenceInput } from "@receivy/common";
vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function draftApi(existing?: object) {
  const saved: RecurrenceInput[] = [];
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    if (path.startsWith("/api/people"))
      return Response.json({
        people: [{ id: "p1", name: "Ana" }],
        nextCursor: null,
      });
    if (path.includes("payment-methods"))
      return Response.json({ paymentMethods: [] });
    if (path.includes("auth/me"))
      return Response.json({ user: { timezone: "America/Sao_Paulo" } });
    if (init?.method === "POST" || init?.method === "PATCH") {
      const input = JSON.parse(String(init.body));
      saved.push(input);
      return Response.json({
        ...input,
        id: "r1",
        state: "active",
        previews: [],
        nextMaterialization: null,
      });
    }
    return Response.json({ recurrences: existing ? [existing] : [] });
  });
  return saved;
}
async function newDraft() {
  const user = userEvent.setup();
  render(<RecurrencesScreen />);
  await user.click(
    await screen.findByRole("button", { name: "Nova recorrência" }),
  );
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  return user;
}
it("retains the intermediate minus sign during sequential reminder typing", async () => {
  const saved = draftApi();
  const user = await newDraft();
  const offset = screen.getAllByLabelText("Dias em relação ao vencimento")[0]!;
  await user.clear(offset);
  await user.type(offset, "-");
  expect(offset).toHaveValue("-");
  await user.type(offset, "5");
  expect(offset).toHaveValue("-5");
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  await user.click(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(saved[0]?.reminders?.[0]?.offsetDays).toBe(-5);
});
it("invalidates review after adding a reminder and saves only the re-reviewed draft", async () => {
  const saved = draftApi();
  const user = await newDraft();
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  expect(
    screen.getByRole("button", { name: "Salvar recorrência" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Adicionar lembrete" }));
  expect(
    screen.queryByRole("button", { name: "Salvar recorrência" }),
  ).not.toBeInTheDocument();
  const offset = screen.getAllByLabelText("Dias em relação ao vencimento")[3]!;
  await user.clear(offset);
  await user.type(offset, "-5");
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  await user.click(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(saved[0]?.reminders).toHaveLength(4);
  expect(saved[0]?.reminders?.some((r) => r.offsetDays === -5)).toBe(true);
});
it("renders an unavailable selected participant so it can be replaced", async () => {
  const saved = draftApi({
    id: "r1",
    description: "Arquivada",
    totalCents: 10000,
    frequency: "monthly",
    day: 31,
    startDate: "2026-09-07",
    timezone: "America/Sao_Paulo",
    state: "paused",
    split: { mode: "equal", parts: [{ kind: "person", personId: "archived" }] },
    reminders: [],
    previews: [],
    nextMaterialization: null,
  });
  const user = userEvent.setup();
  render(<RecurrencesScreen />);
  await user.click(
    await screen.findByRole("button", { name: "Abrir Arquivada" }),
  );
  await user.click(screen.getByRole("button", { name: "Editar" }));
  const unavailable = await screen.findByRole("checkbox", {
    name: /Contato indisponível/,
  });
  expect(unavailable).toBeChecked();
  await user.click(unavailable);
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  await user.click(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(saved[0]?.split.parts).toEqual([{ kind: "person", personId: "p1" }]);
});
it("creates an exact recurring split and freezes retry payload after a lost response", async () => {
  const posts: RequestInit[] = [];
  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    if (path.startsWith("/api/people"))
      return Response.json({
        people: [{ id: "p1", name: "Ana" }],
        nextCursor: null,
      });
    if (path.includes("payment-methods"))
      return Response.json({ paymentMethods: [] });
    if (path.includes("auth/me"))
      return Response.json({ user: { timezone: "America/Sao_Paulo" } });
    if (init.method === "POST") {
      posts.push(init);
      return posts.length === 1
        ? Response.json({ code: "INTERNAL_ERROR", message: "Resposta perdida" }, { status: 503 })
        : Response.json({
            id: "r1",
            ...JSON.parse(String(init.body)),
            state: "active",
            previews: [],
            nextMaterialization: "2026-10-28",
          });
    }
    return Response.json({ recurrences: [] });
  });
  render(<RecurrencesScreen />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Nova recorrência" }),
  );
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.type(screen.getByLabelText("Valor total"), "100,01");
  await user.type(screen.getByLabelText("Descrição"), "Internet");
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  expect(screen.getByText(/50,01/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Serviço temporariamente indisponível. Tente novamente.",
  );
  expect(screen.getByLabelText("Descrição")).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Tentar salvar novamente" }),
  );
  expect(posts[1]?.body).toBe(posts[0]?.body);
  expect(posts[1]?.headers).toEqual(posts[0]?.headers);
  expect(JSON.parse(String(posts[0]?.body))).toMatchObject({
    totalCents: 10001,
    frequency: "monthly",
    timezone: "America/Sao_Paulo",
  });
  expect(await screen.findByText("Simulação de 90 dias")).toBeInTheDocument();
});
it("requires confirmation to end and never offers payment on a virtual preview", async () => {
  const rule = {
    id: "r1",
    description: "Internet",
    totalCents: 10000,
    frequency: "monthly",
    day: 31,
    startDate: "2026-09-07",
    timezone: "America/Sao_Paulo",
    state: "active",
    split: { mode: "equal", parts: [{ kind: "owner" }] },
    reminders: [],
    previews: [
      {
        recurrenceId: "r1",
        description: "Internet",
        amount: { amountCents: 5000, currency: "BRL" },
        occurrenceDate: "2026-09-30",
      },
    ],
    nextMaterialization: "2026-09-30",
  };
  vi.mocked(browserFetch).mockImplementation(async (_path, init) =>
    init?.method === "POST"
      ? Response.json({ ...rule, state: "ended", previews: [] })
      : Response.json({ recurrences: [rule] }),
  );
  render(<RecurrencesScreen />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Abrir Internet" }),
  );
  expect(screen.getByText(/Ainda não é cobrança/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /pagar|comprovante/i }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  await user.click(
    screen.getByRole("button", { name: "Confirmar encerramento" }),
  );
  expect(await screen.findByText(/Encerrada/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Editar" }),
  ).not.toBeInTheDocument();
});
it("retains an editable draft after a definitive rejection and round-trips annual percentage settings", async () => {
  const rule = {
    id: "r1",
    description: "Anuidade",
    totalCents: 10001,
    frequency: "yearly",
    month: 2,
    day: 29,
    startDate: "2026-01-01",
    timezone: "America/Sao_Paulo",
    state: "paused",
    split: {
      mode: "percentage",
      parts: [
        { kind: "person", personId: "p1", basisPoints: 3333 },
        { kind: "owner", basisPoints: 6667 },
      ],
    },
    reminders: [{ offsetDays: -5, enabled: true, channel: "auto" }],
    previews: [],
    nextMaterialization: null,
  };
  let saved: unknown;
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    if (path.startsWith("/api/people"))
      return Response.json({
        people: [{ id: "p1", name: "Ana" }],
        nextCursor: null,
      });
    if (path.includes("payment-methods"))
      return Response.json({ paymentMethods: [] });
    if (init?.method === "PATCH") {
      saved = JSON.parse(String(init.body));
      return Response.json(
        { code: "NOT_FOUND", message: "Contato indisponível" },
        { status: 404 },
      );
    }
    return Response.json({ recurrences: [rule] });
  });
  render(<RecurrencesScreen />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Abrir Anuidade" }),
  );
  await user.click(screen.getByRole("button", { name: "Editar" }));
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.click(screen.getByRole("checkbox", { name: "Ana" }));
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  await user.click(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Este registro não está disponível.",
  );
  expect(screen.getByLabelText("Descrição")).toBeEnabled();
  expect(saved).toMatchObject({
    totalCents: 10001,
    frequency: "yearly",
    month: 2,
    day: 29,
    startDate: "2026-01-01",
    split: rule.split,
    reminders: rule.reminders,
  });
});
