import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, appUrl } from "./app-url";

afterEach(() => vi.unstubAllEnvs());

describe("appOrigin", () => {
  const behindProxy = new Request("http://0.0.0.0:3000/api/auth/oauth/start");

  it("falls back to the request origin when WEB_APP_URL is unset (local dev)", () => {
    vi.stubEnv("WEB_APP_URL", "");
    expect(appOrigin(behindProxy)).toBe("http://0.0.0.0:3000");
  });

  it("pins the public origin behind a proxy and builds absolute URLs from it", () => {
    vi.stubEnv("WEB_APP_URL", "https://receivy.wellsm.dev");
    expect(appOrigin(behindProxy)).toBe("https://receivy.wellsm.dev");
    expect(appUrl(behindProxy, "/auth/oauth/callback").toString()).toBe("https://receivy.wellsm.dev/auth/oauth/callback");
  });

  it.each(["receivy.wellsm.dev", "https://receivy.wellsm.dev/app", "https://receivy.wellsm.dev/?x=1", "ftp://receivy.wellsm.dev"])(
    "rejects a misconfigured WEB_APP_URL (%s) instead of guessing", value => {
      vi.stubEnv("WEB_APP_URL", value);
      expect(() => appOrigin(behindProxy)).toThrow(/WEB_APP_URL/);
    });
});
