const OAUTH_VERIFIER_KEY = "receivy.oauth";
const VERIFIER_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function challengeFor(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return toBase64Url(new Uint8Array(digest));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(VERIFIER_BYTES);

  crypto.getRandomValues(bytes);

  const verifier = toBase64Url(bytes);
  const challenge = await challengeFor(verifier);

  return { verifier, challenge };
}

export function saveOauthVerifier(verifier: string): void {
  try {
    sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);
  } catch {
    // sessionStorage may be unavailable (private mode); startOauth simply fails downstream.
  }
}

export function popOauthVerifier(): string | null {
  try {
    const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY);

    if (!verifier) {
      return null;
    }

    sessionStorage.removeItem(OAUTH_VERIFIER_KEY);

    return verifier;
  } catch {
    return null;
  }
}
