export const OAUTH_COOKIE = "__Host-receivy_oauth";

export function isProviderAuthorizationUrl(value: unknown, provider: "google" | "apple"): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const endpoint = provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://appleid.apple.com/auth/authorize";
    return `${url.origin}${url.pathname}` === endpoint && !url.username && !url.password;
  } catch { return false; }
}
