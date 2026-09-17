import { describe, expect, it } from "vitest";
import {
  ACCESS_COOKIE,
  authCookieOptions,
  REFRESH_COOKIE,
  safeNextPath,
} from "./cookies";

describe("web auth cookies", () => {
  it("uses __Host cookies with strict browser-only boundaries", () => {
    expect(ACCESS_COOKIE).toBe("__Host-receivy_access");
    expect(REFRESH_COOKIE).toBe("__Host-receivy_refresh");
    expect(authCookieOptions(900)).toEqual({
      httpOnly: true,
      maxAge: 900,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(authCookieOptions(900)).not.toHaveProperty("domain");
  });
});

describe("safeNextPath", () => {
  it("allows only local absolute paths", () => {
    expect(safeNextPath("/contacts?from=login")).toBe("/contacts?from=login");
    expect(safeNextPath("https://evil.example/steal")).toBe("/feed");
    expect(safeNextPath("//evil.example/steal")).toBe("/feed");
    expect(safeNextPath("/\\evil.example/steal")).toBe("/feed");
    expect(safeNextPath("javascript:alert(1)")).toBe("/feed");
    expect(safeNextPath(null)).toBe("/feed");
  });
});
