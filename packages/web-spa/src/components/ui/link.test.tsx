import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BackButton } from "@/components/app/back-button";
import { Link } from "@/components/ui/link";
import { renderWithRouter } from "@/test/render";

afterEach(() => {
  cleanup();
});

describe("Link", () => {
  it("splits a query out of `to` so the router gets a pathname and a search", async () => {
    const { router } = renderWithRouter(<Link to="/billings/new?step=2">Nova conta</Link>);
    const link = await screen.findByRole("link", { name: "Nova conta" });

    expect(link).toHaveAttribute("href", "/billings/new?step=2");

    await act(async () => {
      fireEvent.click(link);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/billings/new"));

    expect(router.state.location.search).toEqual({ step: "2" });
  });

  it("merges an explicit search over the query in `to` and keeps the hash", async () => {
    renderWithRouter(
      <Link to="/billings/new?step=2&from=feed#split" search={{ step: "3" }}>
        Nova conta
      </Link>,
    );

    expect(await screen.findByRole("link", { name: "Nova conta" })).toHaveAttribute("href", "/billings/new?step=3&from=feed#split");
  });
});

describe("BackButton", () => {
  it("keeps a fallback with a query as its href and leaves a modified click to the browser", async () => {
    const { router } = renderWithRouter(<BackButton fallback="/billings/new?step=2" />, { path: "/contacts/c1/edit" });
    const link = await screen.findByRole("link", { name: /Voltar/ });

    expect(link).toHaveAttribute("href", "/billings/new?step=2");

    const handled = !fireEvent.click(link, { ctrlKey: true });

    expect(handled).toBe(false);
    expect(router.state.location.pathname).toBe("/contacts/c1/edit");
  });
});
