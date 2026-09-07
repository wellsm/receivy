import { useEffect } from "react";
import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { notificationUrl } from "@/notifications/open";
export function NotificationListener() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    let mounted = true;
    const seen = new Set<string>();
    const open = (response: Notifications.NotificationResponse | null) => {
      if (
        !mounted ||
        !response ||
        seen.has(response.notification.request.identifier)
      )
        return;
      seen.add(response.notification.request.identifier);
      const url = notificationUrl(
        response.notification.request.content.data?.url,
        process.env.EXPO_PUBLIC_WEB_URL,
      );
      if (url) void Linking.openURL(url).catch(() => undefined);
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => undefined);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return null;
}
