import type { LucideIcon } from "lucide-react";

type ActionTileProps = {
  label: string;
  icon: LucideIcon;
  /** `primary` is the main call to action of the row; `danger` a removal. */
  tone?: "neutral" | "primary" | "danger";
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
};

const STYLES = {
  neutral: { circle: "bg-surface-muted text-primary-strong", label: "font-medium text-ink" },
  primary: { circle: "bg-primary text-white", label: "font-bold text-primary" },
  danger: { circle: "bg-red-100 text-red-700", label: "font-medium text-red-700" },
} as const;

/** One square of the quick-actions row under a detail card: icon in a circle, label below. Lay them out in a `flex gap-2`. */
export function ActionTile({ label, icon: Icon, tone = "neutral", hint, disabled = false, onClick }: ActionTileProps) {
  const style = STYLES[tone];

  return (
    <button
      type="button"
      title={hint}
      disabled={disabled}
      onClick={onClick}
      className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-outline/30 bg-surface px-1 py-3 transition hover:border-primary/40 active:scale-[0.98] disabled:opacity-50"
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${style.circle}`}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className={`text-xs ${style.label}`}>{label}</span>
    </button>
  );
}
