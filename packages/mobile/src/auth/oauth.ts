import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
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
    if (provider === "apple" && Platform.OS === "ios") {
      if (!await AppleAuthentication.isAvailableAsync()) throw new Error("Login Apple indisponível neste dispositivo.");
      const challenge = await authClient.startNativeApple(clientChallenge);
      let credential: AppleAuthentication.AppleAuthenticationCredential;
      try { credential = await AppleAuthentication.signInAsync({ nonce: challenge.nonce, state: challenge.state, requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL] }); }
      catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ERR_REQUEST_CANCELED") return false; throw error; }
      if (credential.state !== challenge.state || !credential.authorizationCode) throw new Error("Retorno Apple inválido.");
      await authClient.exchangeNativeApple({ state: challenge.state, authorizationCode: credential.authorizationCode, codeVerifier: verifier, ...(credential.fullName ? { profile: JSON.stringify({ name: { firstName: credential.fullName.givenName, lastName: credential.fullName.familyName } }) } : {}) });
      return true;
    }
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
