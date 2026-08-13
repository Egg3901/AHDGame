"use client";

import Link from "next/link";

/** One removable entry on the blacklist. */
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
    <span className="inline-flex items-center gap-2 rounded-full border border-card-border bg-card-elevated py-1 pl-3 pr-1 text-sm">
      {href ? (
        <Link href={href} className="text-primary hover:opacity-80">
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {canMutate && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-error/15 hover:text-error"
        >
          ×
        </button>
      )}
    </span>
  );
}
