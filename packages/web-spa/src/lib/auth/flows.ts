import type { AuthSessionResponse, AuthUser, ConfirmEmailCodeBody } from "@receivy/common";
import { apiJson } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { clearSession, loadRefreshToken, storeSession } from "@/lib/auth/session";
import type { LoginProviders } from "./login-providers";
import { isProviderAuthorizationUrl, type OAuthProvider } from "./oauth";
import { createPkcePair, popOauthVerifier, saveOauthVerifier } from "./pkce";

const DEVICE_NAME = "Web";
const EMAIL_CODE_FAILED_MESSAGE = "Não foi possível enviar o código agora.";
const EMAIL_CONFIRM_INVALID_MESSAGE = "Código inválido ou expirado. Peça um novo código e tente novamente.";
const EMAIL_CONFIRM_FAILED_MESSAGE = "Não foi possível entrar agora.";
const OAUTH_START_FAILED_MESSAGE = "Não foi possível iniciar o login. Tente novamente.";

export async function requestEmailCode(email: string): Promise<void> {
  try {
    await apiJson<undefined>("auth/email/code", {
      auth: false,
      method: "POST",
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      throw error;
    }

    throw new ApiError(503, EMAIL_CODE_FAILED_MESSAGE);
  }
}

export async function confirmEmailCode(body: ConfirmEmailCodeBody): Promise<AuthUser> {
  try {
    const response = await apiJson<AuthSessionResponse>("auth/email/confirm", {
      auth: false,
      method: "POST",
      body: JSON.stringify({ ...body, deviceName: DEVICE_NAME }),
    });

    storeSession(response);

    return response.user;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
      throw new ApiError(401, EMAIL_CONFIRM_INVALID_MESSAGE);
    }

    throw new ApiError(error instanceof ApiError ? error.status : 503, EMAIL_CONFIRM_FAILED_MESSAGE);
  }
}

export async function startOauth(provider: OAuthProvider): Promise<string> {
  try {
    const { verifier, challenge } = await createPkcePair();

    saveOauthVerifier(verifier);

    const response = await apiJson<{ authorizationUrl: string }>("auth/oauth/start", {
      auth: false,
      method: "POST",
      body: JSON.stringify({
        provider,
        clientChallenge: challenge,
        destination: `${window.location.origin}/auth/oauth/callback`,
      }),
    });

    if (!isProviderAuthorizationUrl(response.authorizationUrl, provider)) {
      throw new Error("invalid authorization url");
    }

    return response.authorizationUrl;
  } catch {
    throw new ApiError(503, OAUTH_START_FAILED_MESSAGE);
  }
}

export async function completeOauth(code: string): Promise<AuthUser | null> {
  const verifier = popOauthVerifier();

  if (!verifier) {
    return null;
  }

  const response = await apiJson<AuthSessionResponse>("auth/oauth/exchange", {
    auth: false,
    method: "POST",
    body: JSON.stringify({ code, codeVerifier: verifier, deviceName: DEVICE_NAME }),
  });

  storeSession(response);

  return response.user;
}

export async function logout(): Promise<void> {
  const refreshToken = loadRefreshToken();

  try {
    if (refreshToken) {
      await apiJson<undefined>("auth/logout", {
        auth: false,
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    }
  } finally {
    clearSession();
  }
}

export async function currentUser(options: { quietExpiry?: boolean } = {}): Promise<AuthUser | null> {
  try {
    const response = await apiJson<{ user: AuthUser }>("auth/me", { quietExpiry: options.quietExpiry });

    return response.user;
  } catch {
    return null;
  }
}

export async function oauthProviders(): Promise<LoginProviders> {
  try {
    const response = await apiJson<{ google?: boolean; apple?: boolean }>("auth/oauth/providers", { auth: false });

    return { google: response.google === true, apple: response.apple === true };
  } catch {
    return { google: false, apple: false };
  }
}
