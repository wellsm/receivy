"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

type BillingDialogProps = {
  title: string;
  /** Right-aligned note beside the title, such as "fecha R$ 53,90". */
  trailing?: ReactNode;
  /** The closing button label; absent hides it and Escape or the scrim close the panel. */
  doneLabel?: string;
  children: ReactNode;
  /** The control that opened the panel; focus goes back to it on close. */
  returnFocusTo?: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

/**
 * The panel a detail row lifts over the form: a bottom sheet up to `sm`, a centred dialog
 * from `sm` on. The split is pure CSS, so the markup is the same on both.
 */
export function BillingDialog({ title, trailing, doneLabel = "Pronto", children, returnFocusTo, onClose }: BillingDialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = returnFocusTo?.current ?? (document.activeElement as HTMLElement | null);
    panel.current?.focus();

    return () => {
      opener.current?.focus();
    };
  }, [returnFocusTo]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-scrim sm:items-center sm:px-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[88vh] w-full flex-col rounded-t-3xl border-t border-outline/30 bg-canvas px-5 pb-6 pt-3 shadow-2xl outline-none sm:max-w-lg sm:rounded-3xl sm:border sm:p-6"
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-outline sm:hidden" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="m-0 font-display text-xl font-bold text-ink">
            {title}
          </h2>
          {trailing}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-1">{children}</div>

        {doneLabel ? (
          <button type="button" onClick={onClose} className="mt-3 h-[52px] w-full rounded-2xl bg-ink text-[15px] font-bold text-surface">
            {doneLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
