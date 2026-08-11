"use client";

import { useState, type ReactNode } from "react";

/**
 * Renders one National-Details sub-section (Government / Politics / Economy /
 * Other). When `collapsible` is set, the section header becomes a click-to-expand
 * toggle with a chevron and the items are hidden until opened; otherwise the
 * header + items render statically (the original flat behaviour).
 *
 * Row rendering is left to the caller via `children`, so each navbar can supply
 * its own row style (the desktop NationDropdown uses icon links; the redesigned
 * ExperimentalNavbar uses MenuRow). `labelClassName` styles the header to match
 * the surrounding menu.
 */
export function CollapsibleNavSection({
  title,
  collapsible = false,
  defaultOpen = false,
  labelClassName = "",
  className,
  children,
}: {
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  labelClassName?: string;
  /** Applied to the section's outer wrapper (e.g. spacing between sections). */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <div className={className}>
        <div className={labelClassName}>{title}</div>
        {children}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 text-left transition-colors hover:text-foreground ${labelClassName}`}
      >
        <span>{title}</span>
        {/* Explicit `text-muted` (full opacity) rather than inheriting the
            label's own faint color (labelClassName is often `text-muted/70`
            or dimmer) — the label can stay subtle while the chevron itself
            must read clearly as "this is a button", matching the weight of
            the top-level section chevrons ({@link Chevron} in
            experimentalNavPrimitives). */}
        <svg
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && children}
    </div>
  );
}
