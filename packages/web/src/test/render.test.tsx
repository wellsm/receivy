import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Link } from "@/components/ui/link";
import { renderWithRouter } from "./render";

it("renders a Link that resolves to the given href", async () => {
  renderWithRouter(<Link to="/feed">Feed</Link>);

  expect(await screen.findByRole("link", { name: "Feed" })).toHaveAttribute("href", "/feed");
});
