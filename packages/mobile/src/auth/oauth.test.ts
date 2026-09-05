import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { authClient } from "./client";
import { loginWithProvider } from "./oauth";

jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(), digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" }, CryptoEncoding: { BASE64: "base64" },
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn(), WebBrowserResultType: { CANCEL: "cancel" } }));
jest.mock("./client", () => ({ authClient: { startOauth: jest.fn(), exchangeOauth: jest.fn() } }));

describe("mobile OAuth binding", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(Crypto.getRandomBytesAsync).mockResolvedValue(new Uint8Array(32).fill(7));
    jest.mocked(Crypto.digestStringAsync).mockResolvedValue("a".repeat(43) + "=");
    jest.mocked(authClient.startOauth).mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("keeps the verifier in memory and uses it to exchange the returned code", async () => {
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: "success", url: "receivy://auth/callback?code=grant" });
    expect(await loginWithProvider("google")).toBe(true);
    expect(authClient.startOauth).toHaveBeenCalledWith({ provider: "google", destination: "receivy://auth/callback", clientChallenge: "a".repeat(43) });
    expect(authClient.exchangeOauth).toHaveBeenCalledWith("grant", "07".repeat(32));
  });

  it("does not exchange on cancellation or a different callback destination", async () => {
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({ type: WebBrowser.WebBrowserResultType.CANCEL });
    expect(await loginWithProvider("apple")).toBe(false);
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({ type: "success", url: "receivy://other/callback?code=grant" });
    await expect(loginWithProvider("apple")).rejects.toThrow("Retorno de login inválido");
    expect(authClient.exchangeOauth).not.toHaveBeenCalled();
  });
});
