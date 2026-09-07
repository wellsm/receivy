import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

import { createAppleRevoker, createOauthProviderClient, decodeOauthProviderConfig } from "./oauth-provider";

describe("OAuth provider configuration", () => {
  it.each(["google", "apple", "nativeApple"] as const)("exchanges and verifies a signed %s fixture", async (mode) => {
    const provider = mode === "google" ? "google" : "apple", native = mode === "nativeApple";
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const appleKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "RS256", kid: "fixture" });
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({
      iss: provider === "google" ? "https://accounts.google.com" : "https://appleid.apple.com",
      aud: native ? "native-client" : "client", sub: "person", email: "person@gmail.com",
      email_verified: provider === "google" ? true : "true", nonce: "nonce",
      iat: now, exp: now + 300,
    });
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url");
    let tokenBody: URLSearchParams | undefined;
    const request: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") {
        tokenBody = init.body as URLSearchParams;
        return Response.json({ id_token: `${header}.${payload}.${signature}`, refresh_token: "refresh-fixture" });
      }
      return Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256", use: "sig" }] });
    };
    const journal = { retain: vi.fn(async () => "journal"), bind: vi.fn(async () => {}) };
    const client = createOauthProviderClient(provider, {
      google: { clientId: "client", clientSecret: "secret", callbackUri: "https://api.example/google" },
      apple: { clientId: "client", nativeClientId: "native-client", callbackUri: "https://api.example/apple", keyId: "key", teamId: "team",
        privateKeyBase64: Buffer.from(appleKey.privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
      },
    }, request, journal, native);
    const identity = await client!.verifyAuthorizationCode({
      code: "authorization-code", codeVerifier: "verifier", nonce: "nonce",
      profile: JSON.stringify({ name: { firstName: "Ana", lastName: "Silva" } }),
    });
    expect(identity).toMatchObject({ subject: "person", email: "person@gmail.com", emailAuthoritative: true });
    expect(tokenBody?.get("code")).toBe("authorization-code");
    expect(tokenBody?.get("code_verifier")).toBe(provider === "google" ? "verifier" : null);
    if (provider === "apple") {
      expect(journal.retain).toHaveBeenCalledWith(native ? "native-client" : "client", "refresh-fixture");
      expect(journal.bind).toHaveBeenCalledWith("journal", "person");
      expect(identity.appleCredentialId).toBe("journal");
      expect(tokenBody?.get("redirect_uri")).toBe(native ? null : "https://api.example/apple");
      expect(identity.name).toBe("Ana Silva");
      expect(tokenBody?.get("client_secret")?.split(".")).toHaveLength(3);
    }
  });
  it("uses only the configured revocation endpoint and preserves retry/configuration outcomes", async () => {
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const config = { apple: { clientId: "client", nativeClientId: "native", callbackUri: "https://api.example/apple", keyId: "key", teamId: "team", privateKeyBase64: Buffer.from(key.privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64") } };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 400 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const revoke = createAppleRevoker(config, request);
    expect(await revoke({ clientId: "arbitrary", token: "fixture" })).toBe("configuration_error"); expect(request).not.toHaveBeenCalled();
    for (const status of ["transient", "configuration_error", "revoked"]) expect(await revoke({ clientId: "native", token: "fixture" })).toBe(status);
    expect(request.mock.calls.every(([url]) => url === "https://appleid.apple.com/auth/revoke")).toBe(true);
    expect((request.mock.calls[0]![1]!.body as URLSearchParams).get("token_type_hint")).toBe("refresh_token");
    expect(createOauthProviderClient("apple", config, request)).toBeNull();
  });
  it("keeps all providers disabled when credentials are absent", () => {
    expect(decodeOauthProviderConfig("disabled")).toEqual({});
    expect(decodeOauthProviderConfig("")).toEqual({});
  });

  it("accepts a base64url configuration only when required fields are present", () => {
    const encoded = Buffer.from(JSON.stringify({
      google: {
        callbackUri: "https://api.receivy.example/auth/google/callback",
        clientId: "google-client",
        clientSecret: "google-secret",
      },
    })).toString("base64url");

    expect(decodeOauthProviderConfig(encoded)).toEqual({
      google: {
        callbackUri: "https://api.receivy.example/auth/google/callback",
        clientId: "google-client",
        clientSecret: "google-secret",
      },
    });
    expect(decodeOauthProviderConfig(Buffer.from("{}").toString("base64url"))).toEqual({});
    expect(decodeOauthProviderConfig("not-base64-json")).toEqual({});
  });
});
