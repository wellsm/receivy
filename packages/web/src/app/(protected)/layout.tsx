import { needsOnboarding } from "@receivy/common";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentUser } from "@/lib/auth/current-user";

/**
 * Every app screen lives under this layout. The proxy already refreshed the
 * session cookies, so this render can ask the API who is signed in and send an
 * unnamed profile to the standalone onboarding screen before any shell renders.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  if (user && needsOnboarding(user)) {
    redirect("/onboarding");
  }

  return children;
}
