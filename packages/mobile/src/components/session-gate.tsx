import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { needsOnboarding } from "@receivy/common";
import { profileStore, type ProfileStore } from "@/account/profile";
import { authClient } from "@/auth/client";
import { notificationClient } from "@/notifications/client";
import { registerPushDevice } from "@/notifications/register";
import { FeedScreen } from "./feed-screen";

type SessionGateProps = {
  client?: Pick<typeof authClient, "getAccessToken" | "refresh">;
  store?: Pick<ProfileStore, "load">;
};

type Stage = "restoring" | "checking-profile" | "ready";

export function SessionGate({ client = authClient, store = profileStore }: SessionGateProps) {
  const router = useRouter();
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
        <ActivityIndicator color="#0B513D" size="large" />
      </View>
    );
  }

  return (
    <FeedScreen
      onOpenBillings={() => router.push("/billings")}
      onOpenCharge={(id) => router.push({ pathname: "/charges/[id]", params: { id } })}
      onOpenSettings={() => router.push("/settings")}
      onOpenNotifications={() => router.push("/settings")}
    />
  );
}
