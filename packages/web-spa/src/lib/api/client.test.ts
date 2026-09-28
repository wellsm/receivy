import { clearSession, getAccessToken, storeSession } from "@/lib/auth/session";
import { apiFetch, apiJson, SessionExpiredError } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.test/s");
  clearSession();
  localStorage.clear();
  storeSession({ accessToken: "a1", refreshToken: "r1", expiresIn: 900 });
});

describe("apiFetch", () => {
  it("sends the bearer and a json content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));

    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("charges?month=2026-09");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.test/s/charges?month=2026-09");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer a1");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json({ accessToken: "a2", refreshToken: "r2", expiresIn: 900 }))
      .mockResolvedValueOnce(json({ ok: true }));

    vi.stubGlobal("fetch", fetchMock);

    const response = await apiFetch("auth/me");

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.test/s/auth/refresh");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({ refreshToken: "r1" });
    expect(new Headers((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).get("authorization")).toBe("Bearer a2");
    expect(getAccessToken()).toBe("a2");
  });

  it("shares one refresh between concurrent 401s", async () => {
    let refreshes = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshes += 1;

        return json({ accessToken: "a2", refreshToken: "r2", expiresIn: 900 });
      }

      return getAccessToken() === "a2" ? json({}) : new Response(null, { status: 401 });
    });

    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([apiFetch("a"), apiFetch("b")]);

    expect(refreshes).toBe(1);
  });

  it("on 409 (another tab rotated) reloads the stored refresh token and retries", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        const { refreshToken } = JSON.parse(init?.body as string) as { refreshToken: string };

        if (refreshToken === "r1") {
          localStorage.setItem("receivy.session", JSON.stringify({ refreshToken: "r-other" }));

          return new Response(null, { status: 409 });
        }

        return json({ accessToken: "a3", refreshToken: "r3", expiresIn: 900 });
      }

      return getAccessToken() === "a3" ? json({}) : new Response(null, { status: 401 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const response = await apiFetch("charges");

    expect(response.ok).toBe(true);
    expect(getAccessToken()).toBe("a3");
  });

  it("clears the session and throws when the refresh is rejected", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(new Response(null, { status: 401 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("auth/me")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("receivy.session")).toBeNull();
  });

  it("never refreshes unauthenticated calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

    vi.stubGlobal("fetch", fetchMock);

    const response = await apiFetch("auth/email/confirm", { auth: false, method: "POST", body: "{}" });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).has("authorization")).toBe(false);
  });

  it("forwards the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));

    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("charges/1/pay", { method: "POST", idempotencyKey: "k1" });

    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get("idempotency-key")).toBe("k1");
  });

  it("keeps the session when the refresh call fails on the network", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockRejectedValueOnce(new TypeError("fetch failed"));

    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("auth/me")).rejects.toBeInstanceOf(TypeError);
    expect(getAccessToken()).toBe("a1");
    expect(localStorage.getItem("receivy.session")).toContain("r1");
  });

  it("gives up after two stale rounds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("charges")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("receivy.session")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("apiJson", () => {
  it("throws ApiError with the body message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "Contato não encontrado." }, 404)));

    await expect(apiJson("contacts/x")).rejects.toMatchObject({ status: 404, message: "Contato não encontrado." });
  });

  it("turns a network failure into the unavailable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(apiJson("contacts")).rejects.toMatchObject({ status: 503, message: "Serviço indisponível. Tente novamente." });
  });

  it("returns undefined on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiJson("contacts/x/archive", { method: "POST" })).resolves.toBeUndefined();
  });
});
