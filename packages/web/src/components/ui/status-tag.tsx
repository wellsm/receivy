type StatusTagProps = {
  label: string;
  tone: "success" | "warning" | "info" | "neutral" | "danger";
  /** Uppercase, square variant used beside amounts. */
  compact?: boolean;
};

const TONES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  neutral: "border-outline/30 bg-surface-muted text-muted",
  danger: "border-red-200 bg-red-50 text-red-700",
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
