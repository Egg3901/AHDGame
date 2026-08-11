"use client";

// ─── Card ─────────────────────────────────────────────────────────────────────
// The standard panel frame. Before this existed every page hand-rolled
// `rounded-xl border border-card-border bg-card p-4 sm:p-5`, which drifted
// section by section. Use `<Card>` for any bordered content block, and pass
// `title` when the block needs a heading rather than nesting your own.

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
  /** Accent stripe down the left edge — party colours, phase colours. */
  accentColor?: string;
  /** Dashed border + centred text, for "nothing here yet" blocks. */
  variant?: "solid" | "dashed";
  className?: string;
}

export function Card({
  children,
  title,
  action,
  padding = "md",
  accentColor,
  variant = "solid",
  className = "",
}: CardProps) {
  const border =
    variant === "dashed" ? "border border-dashed border-card-border" : "border border-card-border";
  const accent = accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : undefined;

  return (
    <div className={`rounded-xl ${border} bg-card overflow-hidden ${className}`} style={accent}>
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

/** Small uppercase label used above a chart or sub-block inside a Card. */
export function CardSubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted/70">{children}</div>
  );
}
