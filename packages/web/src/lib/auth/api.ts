export function authApiUrl(path: string): URL {
  const base = process.env.EZ4_API_URL;
  if (!base) {
    throw new Error("EZ4_API_URL is not configured");
  }
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
}

export function authApiFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(authApiUrl(path), {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}
