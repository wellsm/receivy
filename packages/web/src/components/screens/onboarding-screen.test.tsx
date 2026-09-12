import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingForm } from "./onboarding-form";

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

beforeEach(() => replace.mockReset());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("only enables Continuar for a non-blank name", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<OnboardingForm />);

  const button = screen.getByRole("button", { name: "Continuar" });
  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "   " } });
  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  expect(button).toBeEnabled();
});

it("saves the trimmed name with the device timezone and continues to the app", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    requests.push(JSON.parse(init?.body as string));
    return Response.json({ user: { name: "Ana" } });
  }));
  render(<OnboardingForm />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "  Ana  " } });
  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  expect(requests).toEqual([
    { name: "Ana", locale: "pt-BR", country: "BR", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  ]);
});

it("keeps the person on the screen when saving fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  render(<OnboardingForm />);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.submit(screen.getByRole("button", { name: "Continuar" }).closest("form") as HTMLFormElement);

  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar seu nome. Tente novamente.");
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
});
