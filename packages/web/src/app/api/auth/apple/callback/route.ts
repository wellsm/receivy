import { relayProviderCallback } from "@/lib/auth/provider-callback";

export const dynamic = "force-dynamic";

/** Apple Return URL (form_post): `${WEB_APP_URL}/api/auth/apple/callback` (see docs/oauth-setup.md). */
export function POST(request: Request) {
  return relayProviderCallback(request, "apple");
}
