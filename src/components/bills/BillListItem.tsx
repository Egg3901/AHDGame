import type { ReactNode } from "react";

/**
 * Surface chrome for one bill (or bill + footer) in a legislative record list.
 * Keeps rows from blending into `bg-background` on dark themes while preserving
 * the Dispatch left-rail accent on {@link BillCard}.
 */
export function BillListItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-xl border border-card-border bg-card shadow-card ${className}`.trim()}
    >
      {children}
    </article>
  );
}

/** Vertical stack of {@link BillListItem} cards with consistent gap. */
export function BillListStack({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`flex flex-col gap-3 ${className}`.trim()}>{children}</div>;
}
