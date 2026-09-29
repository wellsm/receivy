import { providerCallbackProxy } from "@/lib/dev-proxy";

describe("providerCallbackProxy", () => {
  it("targets the API origin and keeps the stage path on the callback", () => {
    const proxy = providerCallbackProxy("http://127.0.0.1:3735/local-receivy-api");

    expect(Object.keys(proxy)).toEqual(["/api/auth/google/callback", "/api/auth/apple/callback"]);
    expect(proxy["/api/auth/google/callback"]?.target).toBe("http://127.0.0.1:3735");
    expect(proxy["/api/auth/google/callback"]?.rewrite("/api/auth/google/callback?code=1&state=2")).toBe(
      "/local-receivy-api/api/auth/google/callback?code=1&state=2",
    );
    expect(proxy["/api/auth/apple/callback"]?.rewrite("/api/auth/apple/callback")).toBe("/local-receivy-api/api/auth/apple/callback");
  });

  it("copes with a trailing slash and a URL without a stage path", () => {
    expect(providerCallbackProxy("https://api.test/")["/api/auth/google/callback"]?.rewrite("/api/auth/google/callback")).toBe("/api/auth/google/callback");
    expect(providerCallbackProxy("https://api.test/s/")["/api/auth/apple/callback"]?.rewrite("/api/auth/apple/callback")).toBe("/s/api/auth/apple/callback");
  });

  it("is empty without a URL", () => {
    expect(providerCallbackProxy(undefined)).toEqual({});
    expect(providerCallbackProxy("")).toEqual({});
  });
});
