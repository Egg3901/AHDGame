"use client";

/**
 * Compact "new" marker for first-visit feature discovery on tabs and controls.
 * Plain accent text, not a filled chip: it flags the item without outranking
 * the label it sits beside.
 */
export function NewFeatureBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`ml-1 text-[10px] font-medium text-primary ${className}`.trim()}
      aria-label="New feature"
    >
      new
    </span>
  );
}
