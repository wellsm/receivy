import { createPrivateKey, sign } from "node:crypto";
import { buildAuthorizationUrl, type OauthProvider } from "./oauth";
import type { OauthAttemptValues, OauthProviderClient } from "./oauth-flow";
import { verifyOidcIdToken, type OidcIdentity } from "./oidc";

type GoogleConfig = {
  callbackUri: string;
  clientId: string;
  clientSecret: string;
};

export type AppleConfig = {
  callbackUri: string;
  clientId: string;
  keyId: string;
  privateKeyBase64: string;
  teamId: string;
  nativeClientId?: string;
};

export type OauthProviderConfig = {
  apple?: AppleConfig;
  google?: GoogleConfig;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasStrings<T extends readonly string[]>(
  value: unknown,
  keys: T,
): value is JsonObject & Record<T[number], string> {
  return isRecord(value) && keys.every(
    (key) => typeof value[key] === "string" && value[key] !== "",
  );
}

export function decodeOauthProviderConfig(encoded: string): OauthProviderConfig {
  if (!encoded || encoded === "disabled") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!isRecord(parsed)) {
      return {};
    }

    return {
      ...(hasStrings(parsed.google, ["callbackUri", "clientId", "clientSecret"] as const)
        ? { google: parsed.google }
        : {}),
      ...(hasStrings(parsed.apple, [
        "callbackUri",
        "clientId",
        "keyId",
        "privateKeyBase64",
        "teamId",
      ] as const)
        ? { apple: { ...parsed.apple, nativeClientId: typeof parsed.apple.nativeClientId === "string" && parsed.apple.nativeClientId.length <= 320 ? parsed.apple.nativeClientId : undefined } }
        : {}),
    };
  } catch {
    return {};
  }
}

export function appleConfigurationAvailable(config: AppleConfig | undefined): boolean {
  if (!config) return false;
  try { const key = createPrivateKey(Buffer.from(config.privateKeyBase64, "base64").toString("utf8")); return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"; } catch { return false; }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppleClientSecret(config: AppleConfig, nowSeconds: number): string {
  const header = encode({ alg: "ES256", kid: config.keyId, typ: "JWT" });
  const payload = encode({
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 5 * 60,
    aud: "https://appleid.apple.com",
    sub: config.clientId,
  });
  const signature = sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    {
      key: createPrivateKey(
        Buffer.from(config.privateKeyBase64, "base64").toString("utf8"),
      ),
      dsaEncoding: "ieee-p1363",
    },
  );
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

async function readJson(response: Response): Promise<JsonObject> {
  if (!response.ok) {
    throw new Error("OAuth provider request failed");
  }
  const value: unknown = await response.json();
  if (!isRecord(value)) {
    throw new Error("OAuth provider response is invalid");
  }
  return value;
}

function appleName(profile: string | undefined): string | undefined {
  if (!profile) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(profile);
    if (!isRecord(parsed) || !isRecord(parsed.name)) {
      return undefined;
    }
    const first = typeof parsed.name.firstName === "string" ? parsed.name.firstName.trim() : "";
    const last = typeof parsed.name.lastName === "string" ? parsed.name.lastName.trim() : "";
    return [first, last].filter(Boolean).join(" ").slice(0, 120) || undefined;
  } catch {
    return undefined;
  }
}

export function createOauthProviderClient(
  provider: OauthProvider,
  config: OauthProviderConfig,
  request: typeof fetch = fetch,
  appleJournal?: { retain: (clientId: string, token: string) => Promise<string>; bind: (id: string, subject: string) => Promise<void> },
  native = false,
): OauthProviderClient | null {
  const selected = native && provider === "apple" && config.apple?.nativeClientId ? { ...config.apple, clientId: config.apple.nativeClientId } : config[provider];
  if (!selected) {
    return null;
  }
  if (provider === "apple" && (!appleJournal || !appleConfigurationAvailable(config.apple) || (native && !config.apple?.nativeClientId))) return null;

  return {
    authorizationUrl(values: OauthAttemptValues): string {
      return buildAuthorizationUrl(provider, {
        ...values,
        clientId: selected.clientId,
        redirectUri: selected.callbackUri,
      });
    },

    async verifyAuthorizationCode(input): Promise<OidcIdentity> {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const tokenUrl = provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : "https://appleid.apple.com/auth/token";
      const secret = "clientSecret" in selected
        ? selected.clientSecret
        : createAppleClientSecret(selected, nowSeconds);
      const tokenResponse = await readJson(await request(tokenUrl, {
        signal: AbortSignal.timeout(10000),
        redirect: "error",
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: selected.clientId,
          client_secret: secret,
          code: input.code,
          ...(provider === "google" ? { code_verifier: input.codeVerifier } : {}),
          grant_type: "authorization_code",
          ...(!native ? { redirect_uri: selected.callbackUri } : {}),
        }),
      }));
      let appleCredentialId: string | undefined;
      if (provider === "apple") {
        if (typeof tokenResponse.refresh_token !== "string" || !tokenResponse.refresh_token) throw new Error("Apple refresh credential is missing");
        try { appleCredentialId = await appleJournal!.retain(selected.clientId, tokenResponse.refresh_token); }
        catch {
          // Remote issuance cannot roll back with the DB. Compensate; never issue a local session.
          const outcome = await createAppleRevoker(config, request)({ clientId: selected.clientId, token: tokenResponse.refresh_token });
          console.error(JSON.stringify({ event: "apple_credential_journal_failed", compensation: outcome }));
          throw new Error("Apple credential persistence failed");
        }
      }
      if (typeof tokenResponse.id_token !== "string") {
        throw new Error("OAuth identity token is missing");
      }

      const jwksUrl = provider === "google"
        ? "https://www.googleapis.com/oauth2/v3/certs"
        : "https://appleid.apple.com/auth/keys";
      const jwks = await readJson(await request(jwksUrl, {
        signal: AbortSignal.timeout(10000), redirect: "error",
      }));
      if (!Array.isArray(jwks.keys)) {
        throw new Error("OAuth provider keys are invalid");
      }
      const identity = verifyOidcIdToken({
        algorithms: provider === "google" ? ["RS256"] : ["RS256", "ES256"],
        audience: selected.clientId,
        issuers: provider === "google"
          ? ["accounts.google.com", "https://accounts.google.com"]
          : ["https://appleid.apple.com"],
        jwks: { keys: jwks.keys },
        nonce: input.nonce,
        nowSeconds,
        token: tokenResponse.id_token,
      });
      const profileName = provider === "apple" ? appleName(input.profile) : undefined;
      if (appleCredentialId) await appleJournal!.bind(appleCredentialId, identity.subject);
      return { ...identity, ...(profileName && !identity.name ? { name: profileName } : {}), ...(appleCredentialId ? { appleCredentialId } : {}) };
    },
  };
}

export function createAppleRevoker(config: OauthProviderConfig, request: typeof fetch = fetch) {
  return async ({ token, clientId }: { token: string; clientId: string }): Promise<"revoked" | "transient" | "configuration_error"> => {
    const selected = config.apple;
    if (!selected || ![selected.clientId, selected.nativeClientId].includes(clientId)) return "configuration_error";
    try {
      const response = await request("https://appleid.apple.com/auth/revoke", { signal: AbortSignal.timeout(10000), redirect: "error", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: createAppleClientSecret({ ...selected, clientId }, Math.floor(Date.now() / 1000)), token, token_type_hint: "refresh_token" }) });
      if (response.status === 200) return "revoked";
      return response.status === 429 || response.status >= 500 ? "transient" : "configuration_error";
    } catch { return "transient"; }
  };
}
