import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { needsOnboarding } from "@receivy/common";
import { profileStore, type ProfileStore } from "@/account/profile";
import { authClient } from "@/auth/client";
import { notificationClient } from "@/notifications/client";
import { registerPushDevice } from "@/notifications/register";
import { useThemeColors } from "@/theme/colors";

type SessionGateProps = {
  client?: Pick<typeof authClient, "getAccessToken" | "refresh">;
  store?: Pick<ProfileStore, "load">;
  children: ReactNode;
};

type Stage = "restoring" | "checking-profile" | "ready";

/**
 * Layout-level gate of the protected group: restores the stored session, sends a
 * signed-in person with a pending account to onboarding and only then renders the app
 * navigator. Every protected route mounts under it, so a cold deep link is covered too.
 */
export function SessionGate({ client = authClient, store = profileStore, children }: SessionGateProps) {
  const router = useRouter();
  const colors = useThemeColors();
  const [stage, setStage] = useState<Stage>(() => (client.getAccessToken() ? "checking-profile" : "restoring"));
  const pushRegistered = useRef(false);

  useEffect(() => {
    if (stage !== "restoring") {
      return;
    }

    let active = true;

    void client.refresh().then(
      () => active && setStage("checking-profile"),
      () => active && router.replace("/login"),
    );

    return () => {
      active = false;
    };
  }, [client, router, stage]);

  useEffect(() => {
    if (stage !== "checking-profile") {
      return;
    }

    let active = true;

    void store.load().then(
      (user) => {
        if (!active) {
          return;
        }

        if (needsOnboarding(user)) {
          router.replace("/onboarding");

          return;
        }

        setStage("ready");
      },
      // The home screen reports its own errors; an unreachable profile must not lock the app.
      () => active && setStage("ready"),
    );

    return () => {
      active = false;
    };
  }, [router, stage, store]);

  useEffect(() => {
    if (stage !== "ready" || pushRegistered.current) {
      return;
    }

    pushRegistered.current = true;

    // Best-effort: a denied permission or a build without push credentials must not disturb the session.
    void registerPushDevice(notificationClient.register).catch(() => {});
  }, [stage]);

  if (stage !== "ready") {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return children;
}
