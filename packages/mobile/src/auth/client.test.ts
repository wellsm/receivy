import type { AuthSessionResponse } from "@receivy/common";
import { createAuthClient, REFRESH_TOKEN_KEY } from "./client";

const session: AuthSessionResponse = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 900,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "ana@example.com",
    name: null,
    avatarUrl: null,
    locale: "pt-BR",
    timezone: "America/Sao_Paulo",
    country: "BR",
    currency: "BRL",
  },
};

function storage(refreshToken: string | null = null) {
  return {
    getItemAsync: jest.fn().mockResolvedValue(refreshToken),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  };
}

describe("mobile auth client", () => {
  it("keeps access tokens in memory and persists only the refresh token", async () => {
    const secureStore = storage();
    const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(session), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = createAuthClient({
      baseUrl: "https://api.receivy.example",
      fetch,
      storage: secureStore,
    });

    await client.confirmEmailCode({ email: "ana@example.com", code: "123456" });

    expect(client.getAccessToken()).toBe("access-token");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, "refresh-token");
    expect(secureStore.setItemAsync).not.toHaveBeenCalledWith(expect.anything(), "access-token");
  });

  it("collapses concurrent refresh attempts into one network call", async () => {
    const secureStore = storage("refresh-token");
    const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      accessToken: "next-access",
      refreshToken: "next-refresh",
      expiresIn: 900,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createAuthClient({
      baseUrl: "https://api.receivy.example",
      fetch,
      storage: secureStore,
    });

    const [first, second] = await Promise.all([client.refresh(), client.refresh()]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(client.getAccessToken()).toBe("next-access");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, "next-refresh");
  });

  it("clears secure storage when refresh is rejected", async () => {
    const secureStore = storage("expired-refresh");
    const client = createAuthClient({
      baseUrl: "https://api.receivy.example",
      fetch: jest.fn().mockResolvedValue(new Response(null, { status: 401 })),
      storage: secureStore,
    });

    await expect(client.refresh()).rejects.toThrow("Sessão expirada");
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    expect(client.getAccessToken()).toBeNull();
  });

  it("refreshes once and retries an authorized request after a 401", async () => {
    const secureStore = storage("refresh-token");
    const fetch = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: "next-access",
        refreshToken: "next-refresh",
        expiresIn: 900,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createAuthClient({
      baseUrl: "https://api.receivy.example",
      fetch,
      storage: secureStore,
    });

    const response = await client.authenticatedFetch("auth/me");

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer next-access" }),
    }));
  });
});
