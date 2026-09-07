import { relayProviderCallback } from "@/lib/auth/provider-callback";

export const dynamic = "force-dynamic";

/** Google redirect_uri: `${WEB_APP_URL}/api/auth/google/callback` (see docs/oauth-setup.md). */
export function GET(request: Request) {
  return relayProviderCallback(request, "google");
}
