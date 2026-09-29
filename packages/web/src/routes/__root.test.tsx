import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { parseSearch, stringifySearch } from "@/lib/router-search";
import { Route as rootRoute } from "./__root";

describe("root route", () => {
  it("shows the not-found message for an unknown path", async () => {
    const router = createRouter({
      routeTree: rootRoute.addChildren([]),
      parseSearch,
      stringifySearch,
      history: createMemoryHistory({ initialEntries: ["/nada"] }),
    });

    render(<RouterProvider router={router} />);

    await screen.findByText("Página não encontrada");
  });
});
