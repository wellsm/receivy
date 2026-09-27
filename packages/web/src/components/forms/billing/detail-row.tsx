"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Children, type ReactNode, type RefObject } from "react";

/** The colour of the icon box: brand for what the person filled, neutral for what came from the default, green for money. */
export type DetailTone = "primary" | "muted" | "success";

const TONES: Record<DetailTone, string> = {
  primary: "bg-primary-soft text-primary-strong",
  muted: "bg-surface-muted text-muted",
  success: "bg-success-soft text-success",
};

type DetailRowProps = {
  icon: LucideIcon;
  tone?: DetailTone;
  label: string;
  value: string;
  /** "Alterar" on the creation column, "open" shows the chevron that lifts a dialog. */
  action?: "alter" | "open";
  /** What sits before the action: the participant avatars of the Divisão row. */
  trailing?: ReactNode;
  disabled?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  onClick?: () => void;
};

/** One line of the review column and the edit screen: an icon, a small label, the value and how to change it. */
export function DetailRow({ icon: Icon, tone = "primary", label, value, action = "open", trailing, disabled, buttonRef, onClick }: DetailRowProps) {
  const content = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-[11.5px] text-muted">{label}</span>
        <span className="text-[14.5px] font-bold text-ink">{value}</span>
      </span>
      {trailing}
    </>
  );

  if (!onClick) {
    return <div className="flex min-h-[68px] items-center gap-3 px-3.5 py-3">{content}</div>;
  }

  return (
    <button ref={buttonRef} type="button" aria-label={label} disabled={disabled} onClick={onClick} className="flex min-h-[68px] w-full items-center gap-3 bg-transparent px-3.5 py-3 text-left disabled:opacity-60">
      {content}
      {action === "alter" ? <span className="text-[13.5px] font-bold text-primary">Alterar</span> : <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />}
    </button>
  );
}

/** Rows stacked in one card, separated by hairlines. */
export function DetailCard({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);

  return (
    <div className="overflow-hidden rounded-[20px] border border-outline bg-surface">
      {rows.map((row, index) => (
        <div key={index} className={index ? "border-t border-outline/60" : ""}>
          {row}
        </div>
      ))}
    </div>
  );
}
