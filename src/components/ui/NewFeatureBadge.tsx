"use client";

import { Badge } from "./Badge";

/** Compact "New" chip for first-visit feature discovery on tabs and controls. */
export function NewFeatureBadge({ className = "" }: { className?: string }) {
  return (
    <Badge
      color="primary"
      variant="solid"
      live
      className={`ml-1.5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${className}`.trim()}
      aria-label="New feature"
    >
      New
    </Badge>
  );
}
