import type { UserAvatar } from "@receivy/common";
import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
}

/** The signed URL changes on every response; the object path plus version only changes with the photo. */
export function avatarCacheKey(avatar: UserAvatar): string {
  const path = avatar.url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?", 1)[0] ?? avatar.url;

  return `${path}:${avatar.version}`;
}

type InitialsAvatarProps = {
  name: string;
  /** Diameter in pixels; the letter scales with it. */
  size?: number;
  inverted?: boolean;
  /** The person's photo; the initial shows when absent or when the image fails to load. */
  avatar?: UserAvatar | null;
};

/** Round monogram used by contact chips, the picker and the split rows; the photo takes its place when there is one. */
export function InitialsAvatar({ name, size = 28, inverted = false, avatar }: InitialsAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);

  if (avatar && failed !== avatar.url) {
    return (
      <Image
        testID="initials-avatar-photo"
        source={{ uri: avatar.url, cacheKey: avatarCacheKey(avatar) }}
        onError={() => setFailed(avatar.url)}
        contentFit="cover"
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }

  return (
    <View
      className={`items-center justify-center rounded-full ${inverted ? "bg-primary" : "bg-primary-soft/60"}`}
      style={{ width: size, height: size }}
    >
      <Text className={`font-extrabold ${inverted ? "text-on-primary" : "text-primary-strong"}`} style={{ fontSize: size * 0.42 }}>
        {initialOf(name)}
      </Text>
    </View>
  );
}
