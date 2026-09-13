import { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { Pressable, Text } from "react-native";
import { useThemeColors } from "@/theme/colors";

type CopyButtonProps = {
  value: string;
  accessibilityLabel: string;
  label?: string;
  /** `link` is the small inline action; `outline` the bordered button of the settings list. */
  variant?: "link" | "outline";
  /** Called when the clipboard refuses the write; the button then stays on its idle label. */
  onRefused?: () => void;
};

const COPIED_MS = 3_000;

const copyMark = require("../../../assets/images/auth/copy.svg");
const checkMark = require("../../../assets/images/auth/check.svg");

/** Copies `value` and confirms inline as "Copiado" for a few seconds before returning to its label. */
export function CopyButton({ value, accessibilityLabel, label = "Copiar", variant = "link", onRefused }: CopyButtonProps) {
  const colors = useThemeColors();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  async function copy() {
    // `setStringAsync` reports a refused clipboard by resolving `false`, so the
    // confirmation has to check the answer instead of trusting the await alone.
    let done = false;

    try {
      done = await Clipboard.setStringAsync(value);
    } catch {
      done = false;
    }

    if (!done) {
      onRefused?.();
      return;
    }

    setCopied(true);

    if (timer.current) {
      clearTimeout(timer.current);
    }

    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  const outline = variant === "outline";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: copied }}
      onPress={() => void copy()}
      className={outline ? "min-h-11 flex-row items-center gap-2 rounded-xl border border-outline/60 px-3" : "min-h-8 flex-row items-center gap-1 pl-2"}
    >
      <Image source={copied ? checkMark : copyMark} tintColor={colors.primaryStrong} style={outline ? { width: 14, height: 14 } : { width: 13, height: 13 }} />
      <Text className={outline ? "text-sm font-bold text-primary" : "text-[11px] font-semibold text-primary"}>{copied ? "Copiado" : label}</Text>
    </Pressable>
  );
}
