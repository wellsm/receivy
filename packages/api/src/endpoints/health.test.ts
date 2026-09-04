import { describe, expect, it } from "vitest";
import { healthHandler } from "./health";

describe("healthHandler", () => {
  it("returns the stable public health contract", () => {
    expect(healthHandler()).toEqual({
      status: 200,
      body: { status: "ok", service: "receivy-api" },
    });
  });
});
