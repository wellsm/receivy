"use client";

import type { UserAvatar } from "@receivy/common";
import { useState } from "react";

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
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
      // A signed bucket URL that changes on every response: nothing for next/image to optimise or cache.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar.url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        onError={() => setFailed(avatar.url)}
        className="shrink-0 rounded-full bg-primary-soft/60 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold ${inverted ? "bg-primary text-on-primary" : "bg-primary-soft/60 text-primary-strong"}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initialOf(name)}
    </span>
  );
}
