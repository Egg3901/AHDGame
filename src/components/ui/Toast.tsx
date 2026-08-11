"use client";

import { useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  onClose: () => void;
}

const variantStyles: Record<ToastVariant, string> = {
  success: "border-success/50 bg-success/10 text-success",
  error: "border-error/50 bg-error/10 text-error",
  info: "border-info/50 bg-info/10 text-info",
  warning: "border-warning/50 bg-warning/10 text-warning",
};

/**
 * Non-blocking toast notification. Auto-dismisses after duration.
 * Supports success, error, info, and warning variants.
 */
export function Toast({ message, variant = "success", duration = 4000, onClose }: ToastProps) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dismiss = () => {
    if (exiting) return;
    setExiting(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onClose, 220);
  };

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, duration);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        animation: exiting ? "toastOut 0.22s ease forwards" : "toastIn 0.25s ease forwards",
      }}
      className={`pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[100] -translate-x-1/2 flex w-max max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg sm:max-w-sm ${variantStyles[variant]}`}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="pointer-events-auto -mr-1 shrink-0 opacity-60 transition-opacity hover:opacity-100"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
