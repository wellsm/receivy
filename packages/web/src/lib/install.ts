import { useMemo, useSyncExternalStore } from "react";

const DISMISSED_KEY = "receivy.install.dismissed";
const DISMISSED_FOR_MS = 30 * 24 * 60 * 60 * 1000;
const STANDALONE = "(display-mode: standalone)";

/** How the site can be installed here: the browser's own prompt, or the steps an iPhone asks for. */
export const enum InstallOffer {
  Prompt = "prompt",
  Ios = "ios",
}

/** What the person answered to the browser's prompt. */
export const enum InstallOutcome {
  Accepted = "accepted",
  Dismissed = "dismissed",
}

/** Chrome's `beforeinstallprompt`: not in the DOM types, since only Chromium browsers fire it. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
};

let prompt: InstallPromptEvent | null = null;
/** Kept in memory too: with storage blocked the dismissal still holds for this page. */
let dismissedAt: number | null = null;
let watching = false;

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function onPrompt(event: Event): void {
  // Chrome would show its own banner at a moment it picks; ours waits for the person to be signed in.
  event.preventDefault();

  prompt = event as InstallPromptEvent;

  notify();
}

function onInstalled(): void {
  prompt = null;

  notify();
}

/**
 * The browser fires the prompt once, early, often before any screen that could offer it is mounted: `main.tsx`
 * starts listening at boot and the event is kept until someone asks for it.
 */
export function watchInstallPrompt(): void {
  if (watching) {
    return;
  }

  watching = true;

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
}

/** Forgets everything; the tests start each case from a page that was never offered anything. */
export function resetInstallPrompt(): void {
  window.removeEventListener("beforeinstallprompt", onPrompt);
  window.removeEventListener("appinstalled", onInstalled);

  watching = false;
  prompt = null;
  dismissedAt = null;

  notify();
}

function isStandalone(): boolean {
  const displayed = typeof window.matchMedia === "function" && window.matchMedia(STANDALONE).matches;

  // Safari on iOS answers through its own flag.
  return displayed || ("standalone" in window.navigator && window.navigator.standalone === true);
}

function isIos(): boolean {
  const { userAgent, platform, maxTouchPoints } = window.navigator;

  // An iPad presents itself as a Mac; the touch screen tells them apart.
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

function readDismissal(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(DISMISSED_KEY));

    return Number.isFinite(stored) && stored > 0 ? stored : dismissedAt;
  } catch {
    return dismissedAt;
  }
}

function rememberDismissal(): void {
  dismissedAt = Date.now();

  try {
    window.localStorage.setItem(DISMISSED_KEY, String(dismissedAt));
  } catch {
    // The dismissal still holds for this page; it just won't survive a reload.
  }
}

function currentOffer(): InstallOffer | null {
  const dismissed = readDismissal();

  if (isStandalone() || (dismissed !== null && Date.now() - dismissed < DISMISSED_FOR_MS)) {
    return null;
  }

  if (prompt) {
    return InstallOffer.Prompt;
  }

  return isIos() ? InstallOffer.Ios : null;
}

async function install(): Promise<void> {
  const asked = prompt;

  if (!asked) {
    return;
  }

  await asked.prompt();

  const { outcome } = await asked.userChoice;

  // The browser accepts one answer per event.
  prompt = null;

  if (outcome === InstallOutcome.Dismissed) {
    rememberDismissal();
  }

  notify();
}

function dismiss(): void {
  rememberDismissal();
  notify();
}

export type InstallOfferState = { offer: InstallOffer; install: () => Promise<void>; dismiss: () => void };

/** What to offer on this device right now, or null: already installed, dismissed lately, or not installable. */
export function useInstallOffer(): InstallOfferState | null {
  const offer = useSyncExternalStore(subscribe, currentOffer, () => null);

  return useMemo(() => (offer ? { offer, install, dismiss } : null), [offer]);
}
