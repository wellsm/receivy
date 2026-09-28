import type { ReactNode } from "react";

type ScreenFooterProps = {
  children: ReactNode;
  className?: string;
};

/** Sticky action bar of a screen, pinned to the bottom of the viewport. */
export function ScreenFooter({ children, className }: ScreenFooterProps) {
  const base = "sticky bottom-0 z-[5]";

  return <footer className={className ? `${base} ${className}` : base}>{children}</footer>;
}
