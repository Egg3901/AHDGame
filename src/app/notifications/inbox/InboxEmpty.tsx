/**
 * InboxEmpty — "Inbox zero" empty state card shown when there are no items.
 */

interface InboxEmptyProps {
  /** Optional label for the active filter, e.g. "Crisis" or "All" */
  filterLabel?: string;
  /** Priority tab empty state — nothing needs your input right now */
  variant?: "default" | "priority";
}

export function InboxEmpty({ filterLabel, variant = "default" }: InboxEmptyProps) {
  const isPriority = variant === "priority";

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      {/* Envelope icon */}
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-card-elevated text-muted">
        <svg
          className="h-7 w-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d={
              isPriority
                ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                : "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            }
          />
        </svg>
      </span>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {isPriority ? "Nothing needs you right now" : "All caught up"}
        </p>
        <p className="text-xs text-muted">
          {isPriority
            ? "No pending votes, events, crises, nominations, or unread mail."
            : filterLabel && filterLabel !== "All"
              ? `No ${filterLabel.toLowerCase()} notifications right now.`
              : "No notifications or messages right now."}
        </p>
      </div>
    </div>
  );
}
