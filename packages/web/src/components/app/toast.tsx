"use client";

import { useEffect, useRef } from "react";

type ToastProps = {
  message: string;
  onDismiss: () => void;
  /** How long the pill stays, in milliseconds. */
  duration?: number;
};

/** A short confirmation at the bottom of the screen: goes away on its own, or on a tap. */
export function Toast({ message, onDismiss, duration = 3000 }: ToastProps) {
  // Screens pass an inline callback; the ref keeps a re-render from restarting the timer.
  const dismiss = useRef(onDismiss);

  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(), duration);

    return () => clearTimeout(timer);
  }, [message, duration]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[88px] z-50 flex justify-center px-4 md:bottom-6">
      <p role="status" onClick={onDismiss} className="pointer-events-auto m-0 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-surface shadow-lg">
        {message}
      </p>
    </div>
  );
}
