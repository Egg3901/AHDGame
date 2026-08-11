"use client";

import Link from "next/link";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  /** Custom action element (overrides actionLabel/actionHref/onAction when provided) */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Reusable empty state with icon, copy, and optional CTA.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  action,
  className = "",
}: EmptyStateProps) {
  const hasAction = action ?? (actionLabel && (actionHref || onAction));
  return (
    <div className={`flex flex-col items-center justify-center py-8 text-center ${className}`}>
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-card-border/60 text-muted">
          {icon}
        </div>
      )}
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {hasAction && (
        <div className="mt-4">
          {action ??
            (actionHref ? (
              <Link
                href={actionHref}
                className="inline-block rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium transition-colors duration-150 hover:border-card-border/80 hover:bg-card/80"
              >
                {actionLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onAction}
                className="inline-block rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium transition-colors duration-150 hover:border-card-border/80 hover:bg-card/80"
              >
                {actionLabel}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
