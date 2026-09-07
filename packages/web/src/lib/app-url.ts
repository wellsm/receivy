/**
 * Public origin of this web app, server-side only.
 *
 * Behind a reverse proxy or container (dev at https://receivy.wellsm.dev, prd
 * on the real domain) `request.url` carries the internal bind address, so the
 * CSRF origin check, the OAuth destination sent to the API and every absolute
 * redirect would point at the wrong host. `WEB_APP_URL` pins the effective
 * origin; without it (local `next dev`) the request origin is used unchanged.
 */
export function appOrigin(request: Request): string {
  const configured = process.env.WEB_APP_URL?.trim();
  if (configured) {
    let url: URL;
    try { url = new URL(configured); } catch { throw new Error("WEB_APP_URL must be an absolute URL"); }
    if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("WEB_APP_URL must be an http(s) origin without path, query or fragment");
    }
    return url.origin;
  }
  return new URL(request.url).origin;
}

export function appUrl(request: Request, path: string): URL {
  return new URL(path, `${appOrigin(request)}/`);
}
