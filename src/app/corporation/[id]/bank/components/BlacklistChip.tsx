"use client";

import Link from "next/link";

/** One removable entry on the refusal list, as a list row. */
export function BlacklistChip({
  label,
  href,
  onRemove,
  canMutate,
}: {
  label: string;
  href?: string;
  onRemove: () => void;
  canMutate: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-card-border/60 py-1 text-[13px]">
      {href ? (
        <Link href={href} className="min-w-0 truncate text-foreground hover:underline">
          {label}
        </Link>
      ) : (
        <span className="min-w-0 truncate text-foreground">{label}</span>
      )}
      {canMutate && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="shrink-0 text-[11px] text-muted hover:text-error"
        >
          Remove
        </button>
      )}
    </li>
  );
}
