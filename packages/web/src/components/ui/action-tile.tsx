import type { LucideIcon } from "lucide-react";

type ActionTileProps = {
  label: string;
  icon: LucideIcon;
  /** `primary` is the main call to action of the row; `danger` a removal. */
  tone?: "neutral" | "primary" | "danger";
  hint?: string;
  disabled?: boolean;
  /** A tile that navigates renders as a link, in the same tab, so the destination may send the visitor back. */
  href?: string;
  onClick?: () => void;
};

const STYLES = {
  neutral: { circle: "bg-surface-muted text-primary-strong", label: "font-medium text-ink" },
  primary: { circle: "bg-primary text-on-primary", label: "font-bold text-primary" },
  danger: { circle: "bg-danger-soft text-danger", label: "font-medium text-danger" },
} as const;

const TILE = "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-outline/30 bg-surface px-1 py-3 transition hover:border-primary/40 active:scale-[0.98]";

/** One square of the quick-actions row under a detail card: icon in a circle, label below. Lay them out in a `flex gap-2`. */
export function ActionTile({ label, icon: Icon, tone = "neutral", hint, disabled = false, href, onClick }: ActionTileProps) {
  const style = STYLES[tone];
  const content = (
    <>
      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${style.circle}`}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className={`text-xs ${style.label}`}>{label}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} title={hint} aria-disabled={disabled || undefined} className={`${TILE} no-underline ${disabled ? "pointer-events-none opacity-50" : ""}`}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" title={hint} disabled={disabled} onClick={onClick} className={`${TILE} disabled:opacity-50`}>
      {content}
    </button>
  );
}
