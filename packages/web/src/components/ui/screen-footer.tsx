import type { ReactNode } from "react";

type ScreenFooterProps = {
  children: ReactNode;
  className?: string;
};

/** Sticky action bar of a screen: 72px clears the mobile navigation on narrow viewports. */
export function ScreenFooter({ children, className }: ScreenFooterProps) {
  const base = "sticky bottom-[72px] z-[5] md:bottom-0";

  return <footer className={className ? `${base} ${className}` : base}>{children}</footer>;
}
