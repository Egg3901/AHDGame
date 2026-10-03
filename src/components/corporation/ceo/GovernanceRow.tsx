"use client";

import { useId, useState, type ReactNode } from "react";
import { SmallButton } from "../dense/DenseKit";

/**
 * One governance action as a list row: what it is, where it stands now, and
 * the button that opens its form in place. Rows replace the stack of cards
 * the boardroom used to be, so the whole list fits on one screen and each
 * form opens directly under the line it belongs to.
 */
export function GovernanceRow({
  label,
  summary,
  actionLabel,
  tone = "default",
  onAction,
  disabled,
  disabledReason,
  children,
}: {
  label: string;
  /** The current state, in a few words. */
  summary: ReactNode;
  /** Button text. Omit for a read-only row. */
  actionLabel?: string;
  tone?: "default" | "danger";
  /** Act immediately (open a modal) instead of expanding a form. */
  onAction?: () => void;
  disabled?: boolean;
  /** Shown as the button's tooltip when disabled. */
  disabledReason?: string;
  /** The form revealed under the row. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const expands = children != null && onAction == null;

  return (
    <div className="border-b border-card-border/60 last:border-b-0">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 sm:flex-nowrap">
        <div
          className={`w-full shrink-0 text-[13px] font-medium sm:w-44 ${
            tone === "danger" ? "text-error" : "text-foreground"
          }`}
        >
          {label}
        </div>
        <div className="min-w-0 flex-1 text-xs text-muted">{summary}</div>
        {actionLabel && (
          <SmallButton
            tone={tone === "danger" ? "danger" : "default"}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            onClick={onAction ?? (() => setOpen((v) => !v))}
            ariaLabel={expands ? `${open ? "Close" : actionLabel}: ${label}` : undefined}
          >
            {expands && open ? "Close" : actionLabel}
          </SmallButton>
        )}
      </div>
      {expands && open && (
        <div id={panelId} className="pb-3 sm:pl-[11.75rem]">
          {children}
        </div>
      )}
    </div>
  );
}
