"use client";

import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  /**
   * Either a plain string (rendered as `<h2>`) or a ReactNode for custom
   * header layouts (icon + title + subtitle, multi-line headers, etc.).
   */
  title: string | ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Tailwind max-width class for the dialog. Defaults to `max-w-md`. */
  maxWidthClass?: string;
  /**
   * Whether pressing Escape calls `onClose`. Default `true`.
   * Set to `false` for dialogs that must be dismissed deliberately
   * (e.g. multi-step flows partway through irreversible actions).
   */
  closeOnEscape?: boolean;
  /**
   * Switch the outer container from centered to top-aligned with
   * `overflow-y-auto py-8`, so long-form content (e.g. propose-bill
   * forms) scrolls without clipping. Default `false`.
   */
  scrollable?: boolean;
  /**
   * Right-aligned slot in the header row, rendered between the title
   * and the close-X. Useful for admin/status badges, GitHub links, etc.
   */
  headerActions?: ReactNode;
  /**
   * Class names applied to the body wrapper around `children`. Defaults
   * to `px-5 pb-5` (matches the inherited inner-padding layout). Pass
   * `"p-0"` (or any custom string) to opt out — useful for dialogs that
   * want edge-to-edge bordered sections inside the body.
   */
  bodyClassName?: string;
}

/**
 * Lightweight overlay dialog. Used for savings deposit/withdraw,
 * propose-bill forms, settings panels, and similar focused flows.
 */
export function Modal({
  open,
  title,
  children,
  onClose,
  maxWidthClass = "max-w-md",
  closeOnEscape = true,
  scrollable = false,
  headerActions,
  bodyClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  const layoutClass = scrollable ? "items-start py-8 overflow-y-auto" : "items-center";

  const renderedBodyClass = bodyClassName ?? "px-5 pb-5";

  return (
    <div
      className={`fixed inset-0 z-[100] flex ${layoutClass} justify-center p-4`}
      role="dialog"
      aria-modal
    >
      <button
        type="button"
        className="absolute inset-0 backdrop-blur-[1px]"
        style={{ background: "var(--modal-backdrop)" }}
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        className={`relative z-10 w-full ${maxWidthClass} rounded-xl border border-card-border bg-card shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          {typeof title === "string" ? (
            <h2 className="flex-1 min-w-0 text-lg font-semibold text-foreground">{title}</h2>
          ) : (
            <div className="flex-1 min-w-0">{title}</div>
          )}
          {headerActions !== undefined && <div className="shrink-0">{headerActions}</div>}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-muted hover:bg-card-elevated hover:text-foreground"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className={renderedBodyClass}>{children}</div>
      </div>
    </div>
  );
}
