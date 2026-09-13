import { Text } from "react-native";
import type { ChargeTone as Tone } from "@receivy/common";

type StatusTagProps = {
  label: string;
  tone: Tone;
  /** Uppercase, square variant used beside amounts. */
  compact?: boolean;
};

const TONES: Record<Tone, string> = {
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  info: "border-info/30 bg-info-soft text-info",
  neutral: "border-outline/30 bg-surface-muted text-muted",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

/** The small state pill shared by the charge hero, the proof card and the viewer; mirrors the web `StatusTag`. */
export function StatusTag({ label, tone, compact = false }: StatusTagProps) {
  const shape = compact ? "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" : "rounded-full px-2 py-0.5 text-[11px] font-semibold";

  return <Text className={`border ${TONES[tone]} ${shape}`}>{label}</Text>;
}
