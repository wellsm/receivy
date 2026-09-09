import { authApiFetch } from "./api";

export type LoginProviders = { google: boolean; apple: boolean };

const NONE: LoginProviders = { google: false, apple: false };

/** Server-side lookup: the browser never asks the API which social logins are switched on. */
export async function loginProviders(): Promise<LoginProviders> {
  try {
    const response = await authApiFetch("auth/oauth/providers", { method: "GET" });

    if (!response.ok) {
      return NONE;
    }

    const data = (await response.json()) as { google?: unknown; apple?: unknown };

    return { google: data.google === true, apple: data.apple === true };
  } catch {
    return NONE;
  }
}
