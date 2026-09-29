export type CallbackProxy = { target: string; changeOrigin: boolean; rewrite: (path: string) => string };

const CALLBACKS = ["/auth/google/callback", "/auth/apple/callback"];

/**
 * Dev-only stand-in for the CloudFront origins that send the provider callbacks to the API.
 * Sends each callback path to the origin of the API URL, under its stage path.
 */
export function providerCallbackProxy(apiUrl: string | undefined): Record<string, CallbackProxy> {
  if (!apiUrl) {
    return {};
  }

  const { origin, pathname } = new URL(apiUrl);
  const stage = pathname.replace(/\/+$/, "");

  return Object.fromEntries(CALLBACKS.map((path) => [path, { target: origin, changeOrigin: true, rewrite: (incoming: string) => `${stage}${incoming}` }]));
}
