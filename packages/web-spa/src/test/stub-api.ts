import { vi } from "vitest";

type Handler = (init: RequestInit) => Response | Promise<Response>;

/**
 * Stubs `fetch` with the routes a test declares, keyed "METHOD /path". Anything else answers an
 * explicit 404, so a request the test did not expect fails visibly instead of getting a 200.
 */
export function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const handler = routes[`${init.method ?? "GET"} ${new URL(url).pathname}`];

    return handler ? handler(init) : new Response(JSON.stringify({ message: "not declared" }), { status: 404 });
  });

  vi.stubEnv("VITE_API_URL", "https://api.test");
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

export function requested(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${new URL(url).pathname}`);
}
