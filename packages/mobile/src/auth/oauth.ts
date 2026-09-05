import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { authClient } from "./client";

const redirectUri = "receivy://auth/callback";
let inFlight = false;

export async function loginWithProvider(provider: "google" | "apple"): Promise<boolean> {
  if (inFlight) return false;
  inFlight = true;
  try {
    const bytes = await Crypto.getRandomBytesAsync(32);
    const verifier = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    });
    const clientChallenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const authorizationUrl = await authClient.startOauth({ provider, destination: redirectUri, clientChallenge });
    const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUri);
    if (result.type !== "success") return false;
    const url = new URL(result.url);
    if (`${url.protocol}//${url.host}${url.pathname}` !== redirectUri) throw new Error("Retorno de login inválido.");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Login não concluído. Tente novamente.");
    await authClient.exchangeOauth(code, verifier);
    return true;
  } finally { inFlight = false; }
}
