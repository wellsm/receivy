import { providerCallbackProxy } from "@/lib/dev-proxy";

describe("providerCallbackProxy", () => {
  it("targets the API origin and keeps the stage path on the callback", () => {
    const proxy = providerCallbackProxy("http://127.0.0.1:3735/local-receivy-api");

    expect(Object.keys(proxy)).toEqual(["/auth/google/callback", "/auth/apple/callback"]);
    expect(proxy["/auth/google/callback"]?.target).toBe("http://127.0.0.1:3735");
    expect(proxy["/auth/google/callback"]?.rewrite("/auth/google/callback?code=1&state=2")).toBe(
      "/local-receivy-api/auth/google/callback?code=1&state=2",
    );
    expect(proxy["/auth/apple/callback"]?.rewrite("/auth/apple/callback")).toBe("/local-receivy-api/auth/apple/callback");
  });

  it("copes with a trailing slash and a URL without a stage path", () => {
    expect(providerCallbackProxy("https://api.test/")["/auth/google/callback"]?.rewrite("/auth/google/callback")).toBe("/auth/google/callback");
    expect(providerCallbackProxy("https://api.test/s/")["/auth/apple/callback"]?.rewrite("/auth/apple/callback")).toBe("/s/auth/apple/callback");
  });

  it("is empty without a URL", () => {
    expect(providerCallbackProxy(undefined)).toEqual({});
    expect(providerCallbackProxy("")).toEqual({});
  });
});
