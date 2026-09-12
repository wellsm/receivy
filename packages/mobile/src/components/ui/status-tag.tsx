import { Text } from "react-native";
import type { ChargeTone as Tone } from "@receivy/common";

type StatusTagProps = {
  label: string;
  tone: Tone;
  /** Uppercase, square variant used beside amounts. */
  compact?: boolean;
};

const TONES: Record<Tone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  neutral: "border-outline/30 bg-surface-muted text-muted",
  danger: "border-red-200 bg-red-50 text-red-700",
};

/** The small state pill shared by the charge hero, the proof card and the viewer; mirrors the web `StatusTag`. */
export function StatusTag({ label, tone, compact = false }: StatusTagProps) {
  const shape = compact ? "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" : "rounded-full px-2 py-0.5 text-[11px] font-semibold";

  return <Text className={`border ${TONES[tone]} ${shape}`}>{label}</Text>;
}
