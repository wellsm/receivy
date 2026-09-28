import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

afterEach(cleanup);

it("shows the initial without a photo", () => {
  const { container } = render(<InitialsAvatar name="ana" size={40} />);

  expect(container.textContent).toBe("A");
  expect(container.querySelector("img")).toBeNull();
});

it("shows the photo and falls back to the initial when it fails", () => {
  const { container } = render(<InitialsAvatar name="ana" size={40} avatar={{ url: "https://bucket.test/avatars/u1", version: "v1" }} />);
  const image = container.querySelector("img");

  expect(image?.getAttribute("src")).toBe("https://bucket.test/avatars/u1");
  expect(image?.getAttribute("width")).toBe("40");

  fireEvent.error(image!);

  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("A");
});
