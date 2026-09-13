type StatusTagProps = {
  label: string;
  tone: "success" | "warning" | "info" | "neutral" | "danger";
  /** Uppercase, square variant used beside amounts. */
  compact?: boolean;
};

const TONES = {
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  info: "border-info/30 bg-info-soft text-info",
  neutral: "border-outline/30 bg-surface-muted text-muted",
  danger: "border-danger/30 bg-danger-soft text-danger",
} as const;

/** The small state pill shared by cards, detail rows and history lines. */
export function StatusTag({ label, tone, compact = false }: StatusTagProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap border font-semibold ${TONES[tone]} ${
        compact ? "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" : "rounded-full px-2 py-0.5 text-[11px]"
      }`}
    >
      {label}
    </span>
  );
}
