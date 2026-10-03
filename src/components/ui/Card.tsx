"use client";

// ─── Card ─────────────────────────────────────────────────────────────────────
// The standard frame for a bounded object the player acts on as a unit. Before
// this existed every page hand-rolled
// `rounded-xl border border-card-border bg-card p-4 sm:p-5`, which drifted
// section by section. Group ordinary content with a heading, spacing and a rule
// instead of a card, and pass `title` when a card needs a heading rather than
// nesting your own. A card has no colored edge: show a party or phase color as
// a small swatch beside the name it belongs to.

import React from "react";

type CardPadding = "none" | "sm" | "md" | "lg";

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-3 sm:p-4",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6",
};

export interface CardProps {
  children: React.ReactNode;
  /** Optional heading rendered in a bordered header strip above the body. */
  title?: React.ReactNode;
  /** Right-aligned content in the header strip (counts, links, toggles). */
  action?: React.ReactNode;
  /** Body padding. Use "none" when the child manages its own spacing. */
  padding?: CardPadding;
  /** Dashed border + centred text, for "nothing here yet" blocks. */
  variant?: "solid" | "dashed";
  className?: string;
}

export function Card({
  children,
  title,
  action,
  padding = "md",
  variant = "solid",
  className = "",
}: CardProps) {
  const border =
    variant === "dashed" ? "border border-dashed border-card-border" : "border border-card-border";

  return (
    <div className={`rounded-xl ${border} bg-card overflow-hidden ${className}`}>
      {title !== undefined && (
        <div className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-2.5 sm:px-5 sm:py-3">
          <div className="min-w-0 text-sm font-semibold">{title}</div>
          {action !== undefined && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={PADDING[padding]}>{children}</div>
    </div>
  );
}

/** Small sentence-case label above a chart or sub-block inside a Card. */
export function CardSubLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs font-medium text-muted">{children}</div>;
}
