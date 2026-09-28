import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("allows only local absolute paths", () => {
    expect(safeNextPath("/billings/1?x=1")).toBe("/billings/1?x=1");
    expect(safeNextPath(null)).toBe("/feed");
    expect(safeNextPath("https://evil")).toBe("/feed");
    expect(safeNextPath("//evil")).toBe("/feed");
    expect(safeNextPath("/\\evil")).toBe("/feed");
  });
});
