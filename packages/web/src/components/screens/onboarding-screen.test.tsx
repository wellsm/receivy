import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingScreen } from "@/components/screens/onboarding-screen";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();
const API = "https://api.test";

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));

beforeEach(() => {
  navigate.mockReset();
  vi.stubEnv("VITE_API_URL", API);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open(ui: ReactElement) {
  const result = renderWithRouter(ui);

  await screen.findByLabelText("Nome");

  return result;
}

function stubProfilePatch() {
  const requests: unknown[] = [];

  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    requests.push(JSON.parse(init?.body as string));

    return Response.json({ user: { name: "Ana" } });
  }));

  return requests;
}

it("only enables Continuar for a non-blank name", async () => {
  vi.stubGlobal("fetch", vi.fn());
  await open(<OnboardingScreen />);

  const button = screen.getByRole("button", { name: "Continuar" });

  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "   " } });
  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  expect(button).toBeEnabled();
});

it("pre-fills the name the API already knows, so a contact added by someone else only confirms it", async () => {
  vi.stubGlobal("fetch", vi.fn());
  await open(<OnboardingScreen initialName="Ana Souza" />);

  expect(screen.getByLabelText("Nome")).toHaveValue("Ana Souza");
  expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
});

it("saves the trimmed name with the device timezone and continues to the app", async () => {
  const requests = stubProfilePatch();

  await open(<OnboardingScreen />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "  Ana  " } });
  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));

  expect(requests).toEqual([
    { name: "Ana", locale: "pt-BR", country: "BR", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  ]);
});

it("masks the optional phone and sends it as typed", async () => {
  const requests = stubProfilePatch();

  await open(<OnboardingScreen />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Telefone (Opcional)"), { target: { value: "11987654321" } });

  expect(screen.getByLabelText("Telefone (Opcional)")).toHaveValue("(11) 98765-4321");

  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));

  expect(requests).toEqual([
    { name: "Ana", phone: "(11) 98765-4321", locale: "pt-BR", country: "BR", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  ]);
});

it("keeps the person on the screen when saving fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  await open(<OnboardingScreen />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar seus dados. Tente novamente.");
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
});
