import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingScreen } from "@/components/screens/onboarding-screen";

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

beforeEach(() => replace.mockReset());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubProfilePatch() {
  const requests: unknown[] = [];

  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    requests.push(JSON.parse(init?.body as string));

    return Response.json({ user: { name: "Ana" } });
  }));

  return requests;
}

it("only enables Continuar for a non-blank name", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<OnboardingScreen />);

  const button = screen.getByRole("button", { name: "Continuar" });

  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "   " } });
  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  expect(button).toBeEnabled();
});

it("pre-fills the name the API already knows, so a contact added by someone else only confirms it", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<OnboardingScreen initialName="Ana Souza" />);

  expect(screen.getByLabelText("Nome")).toHaveValue("Ana Souza");
  expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
});

it("saves the trimmed name with the device timezone and continues to the app", async () => {
  const requests = stubProfilePatch();

  render(<OnboardingScreen />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "  Ana  " } });
  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));

  expect(requests).toEqual([
    { name: "Ana", locale: "pt-BR", country: "BR", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  ]);
});

it("masks the optional phone and sends it as typed", async () => {
  const requests = stubProfilePatch();

  render(<OnboardingScreen />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Telefone (Opcional)"), { target: { value: "11987654321" } });

  expect(screen.getByLabelText("Telefone (Opcional)")).toHaveValue("(11) 98765-4321");

  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));

  expect(requests).toEqual([
    { name: "Ana", phone: "(11) 98765-4321", locale: "pt-BR", country: "BR", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  ]);
});

it("keeps the person on the screen when saving fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  render(<OnboardingScreen />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar seus dados. Tente novamente.");
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
});
