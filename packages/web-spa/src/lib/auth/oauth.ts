export const enum OAuthProvider {
  Google = "google",
  Apple = "apple",
}

export function isProviderAuthorizationUrl(value: unknown, provider: OAuthProvider): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    const endpoint = provider === OAuthProvider.Google
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://appleid.apple.com/auth/authorize";

    return `${url.origin}${url.pathname}` === endpoint && !url.username && !url.password;
  } catch { return false; }
}
