import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LoginForm", () => {
  it("uses email plus code and never asks for a password", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const user = userEvent.setup();
    render(<LoginForm nextPath="/" />);

    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Seu e-mail"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Receber código" }));

    expect(await screen.findByLabelText("Código de 6 dígitos")).toBeInTheDocument();
    expect(screen.getByText("Enviamos um código para ana@example.com.")).toBeInTheDocument();
  });

  it("shows the same actionable error for any rejected code", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ google: false, apple: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: "Código inválido ou expirado. Peça um novo código e tente novamente.",
      }), { status: 401, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<LoginForm nextPath="/" />);

    await user.type(screen.getByLabelText("Seu e-mail"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Receber código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "000000");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Código inválido ou expirado. Peça um novo código e tente novamente.",
    );
  });
});
