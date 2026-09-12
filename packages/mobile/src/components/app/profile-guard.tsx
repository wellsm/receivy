import { useEffect } from "react";
import { usePathname, useRouter } from "expo-router";
import { needsOnboarding } from "@receivy/common";
import { profileStore, type ProfileStore } from "@/account/profile";

const PUBLIC_PATHS = ["/login", "/onboarding", "/auth"];

export function isGuardedPath(pathname: string): boolean {
  return !PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

type ProfileGuardProps = {
  store?: Pick<ProfileStore, "hasSession" | "load">;
};

/**
 * Route-level middleware: whenever a signed-in person lands on an app screen
 * without a profile name, they are sent back to the onboarding screen. The
 * profile store caches the answer per access token, so this costs one request
 * per session, not one per navigation.
 */
export function ProfileGuard({ store = profileStore }: ProfileGuardProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isGuardedPath(pathname) || !store.hasSession()) {
      return;
    }

    let active = true;

    void store
      .load()
      .then((user) => {
        if (active && needsOnboarding(user)) {
          router.replace("/onboarding");
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [pathname, router, store]);

  return null;
}
