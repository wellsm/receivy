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
