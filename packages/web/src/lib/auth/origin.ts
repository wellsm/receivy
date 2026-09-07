import { appOrigin } from "../app-url";

/** CSRF gate for browser mutations: the Origin header must equal the public app origin. */
export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === appOrigin(request);
}
