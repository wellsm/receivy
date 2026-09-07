import type {
  AuthSessionResponse,
  AuthUser,
  ConfirmEmailCodeBody,
  RequestEmailCodeBody,
  SessionTokens,
} from "@receivy/common";
import * as SecureStore from "expo-secure-store";

export const REFRESH_TOKEN_KEY = "receivy_refresh_token";

type Storage = Pick<
  typeof SecureStore,
  "deleteItemAsync" | "getItemAsync" | "setItemAsync"
>;

type AuthClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  storage?: Storage;
};

function endpoint(baseUrl: string, path: string): URL {
  return new URL(path.replace(/^\//, ""), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

export function createAuthClient({
  baseUrl,
  fetch: request = globalThis.fetch,
  storage = SecureStore,
}: AuthClientOptions) {
  let accessToken: string | null = null;
  let refreshInFlight: Promise<SessionTokens> | null = null;

  async function jsonRequest(path: string, init: RequestInit): Promise<Response> {
    return request(endpoint(baseUrl, path), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    });
  }

  async function saveSession(session: SessionTokens): Promise<void> {
    accessToken = session.accessToken;
    await storage.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
  }

  async function clearSession(): Promise<void> {
    accessToken = null;
    await storage.deleteItemAsync(REFRESH_TOKEN_KEY);
  }

  async function refreshOnce(): Promise<SessionTokens> {
    const refreshToken = await storage.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      await clearSession();
      throw new Error("Sessão expirada");
    }

    const response = await jsonRequest("auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      await clearSession();
      throw new Error("Sessão expirada");
    }

    const session = (await response.json()) as SessionTokens;
    await saveSession(session);
    return session;
  }

  function refresh(): Promise<SessionTokens> {
    if (!refreshInFlight) {
      refreshInFlight = refreshOnce().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  return {
    getAccessToken: () => accessToken,

    async oauthProviders(): Promise<{ google: boolean; apple: boolean; appleNative: boolean }> {
      try {
        const response = await jsonRequest("auth/oauth/providers", { method: "GET" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        return { google: data.google === true, apple: data.apple === true, appleNative: data.appleNative === true };
      } catch { return { google: false, apple: false, appleNative: false }; }
    },

    async startNativeApple(clientChallenge: string): Promise<{ state: string; nonce: string }> {
      const response = await jsonRequest("auth/apple/native/start", { method: "POST", body: JSON.stringify({ clientChallenge }) });
      if (!response.ok) throw new Error("Login Apple indisponível.");
      const result = await response.json();
      if (![result.state, result.nonce].every(value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value))) throw new Error("Retorno Apple inválido.");
      return result;
    },
    async exchangeNativeApple(input: { state: string; authorizationCode: string; codeVerifier: string; profile?: string }): Promise<AuthUser> {
      const response = await jsonRequest("auth/apple/native/exchange", { method: "POST", body: JSON.stringify({ ...input, deviceName: "Receivy iOS" }) });
      if (!response.ok) throw new Error("Não foi possível concluir o login Apple. Tente novamente mais tarde.");
      const session = await response.json() as AuthSessionResponse; await saveSession(session); return session.user;
    },

    async startOauth(input: { provider: "google" | "apple"; destination: string; clientChallenge: string }): Promise<string> {
      const response = await jsonRequest("auth/oauth/start", { method: "POST", body: JSON.stringify(input) });
      if (!response.ok) throw new Error("Não foi possível iniciar o login.");
      const data = await response.json();
      const url = new URL(data.authorizationUrl);
      const expected = input.provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize";
      if (`${url.origin}${url.pathname}` !== expected || url.username || url.password) throw new Error("Resposta de login inválida.");
      return url.toString();
    },

    async exchangeOauth(code: string, codeVerifier: string): Promise<AuthUser> {
      const response = await jsonRequest("auth/oauth/exchange", {
        method: "POST", body: JSON.stringify({ code, codeVerifier, deviceName: "Receivy mobile" }),
      });
      if (!response.ok) throw new Error("Não foi possível concluir o login. Tente novamente.");
      const session = await response.json() as AuthSessionResponse;
      await saveSession(session);
      return session.user;
    },

    async requestEmailCode(input: RequestEmailCodeBody): Promise<void> {
      const response = await jsonRequest("auth/email/code", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error("Não foi possível enviar o código agora.");
      }
    },

    async confirmEmailCode(input: ConfirmEmailCodeBody): Promise<AuthUser> {
      const response = await jsonRequest("auth/email/confirm", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error("Código inválido ou expirado. Peça um novo código e tente novamente.");
      }
      const session = (await response.json()) as AuthSessionResponse;
      await saveSession(session);
      return session.user;
    },

    refresh,

    async authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
      const send = () => jsonRequest(path, {
        ...init,
        headers: {
          ...init.headers,
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      let response = await send();
      if (response.status === 401) {
        await refresh();
        response = await send();
      }
      return response;
    },

    async logout(): Promise<void> {
      const refreshToken = await storage.getItemAsync(REFRESH_TOKEN_KEY);
      try {
        if (refreshToken) {
          await jsonRequest("auth/logout", {
            method: "POST",
            body: JSON.stringify({ refreshToken }),
          });
        }
      } finally {
        await clearSession();
      }
    },
  };
}

const apiUrl = process.env.EXPO_PUBLIC_EZ4_API_URL ?? "http://127.0.0.1:3735/local-receivy-api";
export const authClient = createAuthClient({ baseUrl: apiUrl });
