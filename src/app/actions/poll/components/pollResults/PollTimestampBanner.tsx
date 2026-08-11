"use client";

import { formatTimestamp } from "../../pollHelpers";
import type { StoredPoll } from "../../types";

export function PollTimestampBanner({ poll }: { poll: StoredPoll }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-card-border bg-card/50 px-4 py-2.5 text-xs text-muted">
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      Poll taken on{" "}
      <span className="font-medium text-foreground ml-1">{formatTimestamp(poll.takenAt)}</span>
      <span className="ml-auto text-muted/60 italic">
        Commission a new poll to refresh these results
      </span>
    </div>
  );
}
