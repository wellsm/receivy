"use client";
import { useEffect, useState, type ReactNode } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { AccountSettings } from "./account-settings";
export function AccountOnboarding({ children }: { children: ReactNode }) {
  const [needsName, setNeedsName] = useState(false);
  useEffect(() => { let active = true; void browserFetch("/api/auth/me").then(async response => { if (response.ok && active) setNeedsName(!(await response.json()).user.name); }).catch(() => {}); return () => { active = false; }; }, []);
  return needsName ? <AccountSettings onboarding onComplete={() => setNeedsName(false)} /> : children;
}
