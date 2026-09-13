"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

type BackButtonProps = {
  /** Where the screen sits in the hierarchy. Kept as the href so the control stays a real link:
   * it opens in a new tab, it can be copied, and it still works before hydration. A plain click
   * goes back one history entry instead, which is what the person expects after arriving here. */
  fallback: string;
  className?: string;
};

export function BackButton({ fallback, className }: BackButtonProps) {
  const router = useRouter();

  function goBack(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click is the person asking for the declared destination, not for history.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    router.back();
  }

  return (
    <Link href={fallback} onClick={goBack} className={className}>
      ← <span className="sr-only md:not-sr-only">Voltar</span>
    </Link>
  );
}
