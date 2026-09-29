import type { AuthUser } from "@receivy/common";
import { onSessionExpired } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { clearSession, getAccessToken, loadRefreshToken, storeSession } from "@/lib/auth/session";
import {
  completeOauth,
  confirmEmailCode,
  currentUser,
  logout,
  oauthProviders,
  requestEmailCode,
  startOauth,
} from "./flows";
import { OAuthProvider } from "./oauth";
import { popOauthVerifier, saveOauthVerifier } from "./pkce";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const user: AuthUser = {
  id: "u1",
  email: "a@b.com",
  name: null,
  phone: null,
  avatar: null,
  status: "pending",
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  country: "BR",
  currency: "BRL",
} as AuthUser;

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.test/s");
  clearSession();
  localStorage.clear();
  sessionStorage.clear();
});

describe("requestEmailCode", () => {
  it("posts the email unauthenticated", async () => {
    // A stored session makes the "no authorization header" assertion able to fail.
    storeSession({ accessToken: "stale", refreshToken: "r0", expiresIn: 900 });

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    vi.stubGlobal("fetch", fetchMock);

    await requestEmailCode("a@b.com");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.test/s/auth/email/code");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.com" });
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("maps a server failure to the generic message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "boom" }, 500)));

    await expect(requestEmailCode("a@b.com")).rejects.toMatchObject({
      status: 503,
      message: "Não foi possível enviar o código agora.",
    });
  });
});

describe("confirmEmailCode", () => {
  it("stores the session and returns the user", async () => {
    // A stored session makes the "no authorization header" assertion able to fail.
    storeSession({ accessToken: "stale", refreshToken: "r0", expiresIn: 900 });

    const fetchMock = vi.fn().mockResolvedValue(json({ accessToken: "a1", refreshToken: "r1", expiresIn: 900, user }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await confirmEmailCode({ email: "a@b.com", code: "123456" });

    expect(result).toEqual(user);
    expect(getAccessToken()).toBe("a1");
    expect(loadRefreshToken()).toBe("r1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.test/s/auth/email/confirm");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.com", code: "123456", deviceName: "Web" });
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("maps an invalid code to a 401 with the specific message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ message: "bad code" }, 400));

    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmEmailCode({ email: "a@b.com", code: "000000" })).rejects.toMatchObject({
      status: 401,
      message: "Código inválido ou expirado. Peça um novo código e tente novamente.",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.com", code: "000000", deviceName: "Web" });
  });

  it("maps any other failure to the generic login message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    await expect(confirmEmailCode({ email: "a@b.com", code: "123456" })).rejects.toMatchObject({
      message: "Não foi possível entrar agora.",
    });
  });
});

describe("startOauth", () => {
  it("saves the verifier, posts the challenge and returns a valid authorization url", async () => {
    // A stored session makes the "no authorization header" assertion able to fail.
    storeSession({ accessToken: "stale", refreshToken: "r0", expiresIn: 900 });

    const fetchMock = vi.fn().mockResolvedValue(json({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }));

    vi.stubGlobal("fetch", fetchMock);

    const url = await startOauth(OAuthProvider.Google);

    expect(url).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1");

    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { provider: string; clientChallenge: string; destination: string };

    expect(requestUrl).toBe("https://api.test/s/auth/oauth/start");
    expect(body.provider).toBe("google");
    expect(body.clientChallenge).toHaveLength(43);
    expect(body.destination).toBe(`${window.location.origin}/auth/oauth/callback`);
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(popOauthVerifier()).not.toBeNull();
  });

  it("fails with the generic message when the API answers a foreign url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ authorizationUrl: "https://evil.example/steal" }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(startOauth(OAuthProvider.Google)).rejects.toMatchObject({
      status: 503,
      message: "Não foi possível iniciar o login. Tente novamente.",
    });

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(requestUrl).toBe("https://api.test/s/auth/oauth/start");
  });
});

describe("completeOauth", () => {
  it("exchanges the popped verifier and stores the session", async () => {
    // A stored session makes the "no authorization header" assertion able to fail.
    storeSession({ accessToken: "stale", refreshToken: "r0", expiresIn: 900 });

    saveOauthVerifier("verifier-1");

    const fetchMock = vi.fn().mockResolvedValue(json({ accessToken: "a2", refreshToken: "r2", expiresIn: 900, user }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await completeOauth("grant-code");

    expect(result).toEqual(user);
    expect(getAccessToken()).toBe("a2");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.test/s/auth/oauth/exchange");
    expect(JSON.parse(init.body as string)).toEqual({ code: "grant-code", codeVerifier: "verifier-1", deviceName: "Web" });
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("answers null without calling the API when there is no pending verifier", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    await expect(completeOauth("grant-code")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("posts the stored refresh token and clears the session", async () => {
    storeSession({ accessToken: "a1", refreshToken: "r1", expiresIn: 900 });

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    vi.stubGlobal("fetch", fetchMock);

    await logout();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.test/s/auth/logout");
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "r1" });
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(loadRefreshToken()).toBeNull();
  });

  it("clears the session even when there was nothing to revoke", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    await logout();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
  });
});

describe("currentUser", () => {
  it("returns the user on success", async () => {
    storeSession({ accessToken: "a1", refreshToken: "r1", expiresIn: 900 });

    const fetchMock = vi.fn().mockResolvedValue(json({ user }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(currentUser()).resolves.toEqual(user);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.test/s/auth/me");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer a1");
  });

  it("answers null on any failure, including a dead session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(currentUser()).resolves.toBeNull();
  });
});

describe("currentUser quiet expiry", () => {
  afterEach(() => {
    onSessionExpired(null);
  });

  it("does not fire the session-expired handler when asked for a quiet expiry", async () => {
    const handler = vi.fn();

    storeSession({ accessToken: "a1", refreshToken: "r1", expiresIn: 900 });
    onSessionExpired(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(currentUser({ quietExpiry: true })).resolves.toBeNull();

    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps firing it by default", async () => {
    const handler = vi.fn();

    storeSession({ accessToken: "a1", refreshToken: "r1", expiresIn: 900 });
    onSessionExpired(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(currentUser()).resolves.toBeNull();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("oauthProviders", () => {
  it("returns the providers the API reports", async () => {
    // A stored session makes the "no authorization header" assertion able to fail.
    storeSession({ accessToken: "stale", refreshToken: "r0", expiresIn: 900 });

    const fetchMock = vi.fn().mockResolvedValue(json({ google: true, apple: false }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(oauthProviders()).resolves.toEqual({ google: true, apple: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.test/s/auth/oauth/providers");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("answers both false on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    await expect(oauthProviders()).resolves.toEqual({ google: false, apple: false });
  });
});

describe("ApiError re-export sanity", () => {
  it("is the same class thrown by apiJson", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "boom" }, 500)));

    await expect(requestEmailCode("a@b.com")).rejects.toBeInstanceOf(ApiError);
  });
});
