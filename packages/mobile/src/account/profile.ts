import type { AuthUser } from "@receivy/common";
import { accountClient } from "@/account/client";
import { authClient } from "@/auth/client";

type ProfileStoreDeps = {
  getAccessToken: () => string | null | undefined;
  fetchProfile: () => Promise<AuthUser>;
};

type CachedProfile = {
  token: string;
  user: AuthUser;
};

/**
 * Caches the signed-in profile for the lifetime of one access token. A new
 * login or a refresh rotates the token, which naturally invalidates the cache,
 * so the onboarding guard never trusts a profile from a previous session.
 */
export function createProfileStore({ getAccessToken, fetchProfile }: ProfileStoreDeps) {
  let cached: CachedProfile | null = null;

  function hasSession() {
    return Boolean(getAccessToken());
  }

  function remember(user: AuthUser) {
    const token = getAccessToken();

    if (!token) {
      return;
    }

    cached = { token, user };
  }

  async function load(): Promise<AuthUser> {
    const token = getAccessToken();

    if (cached && cached.token === token) {
      return cached.user;
    }

    const user = await fetchProfile();

    remember(user);

    return user;
  }

  return { hasSession, load, remember };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;

export const profileStore = createProfileStore({
  getAccessToken: () => authClient.getAccessToken(),
  fetchProfile: () => accountClient.profile(),
});
