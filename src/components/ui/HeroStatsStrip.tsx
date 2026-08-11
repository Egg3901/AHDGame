import type { ReactNode } from "react";

export type HeroStatsStripVariant = "default" | "overlay";
export type HeroStatsStripLayout = "scroll" | "grid";

const VARIANT_SCROLL: Record<HeroStatsStripVariant, string> = {
  default:
    "flex items-stretch overflow-x-auto divide-x divide-card-border border-t border-card-border",
  overlay:
    "flex items-stretch overflow-x-auto divide-x divide-card-border/50 border-t border-card-border bg-card/50 backdrop-blur-sm",
};

/** Gap-px grid: tiles paint their own surface so long values wrap instead of colliding. */
const VARIANT_GRID: Record<HeroStatsStripVariant, string> = {
  default:
    "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px border-t border-card-border bg-card-border [&>*]:min-w-0 [&>*]:bg-card",
  overlay:
    "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px border-t border-card-border bg-card-border/50 backdrop-blur-sm [&>*]:min-w-0 [&>*]:bg-card/60",
};

export interface HeroStatsStripProps {
  children: ReactNode;
  className?: string;
  /** `overlay` matches the Campaign Operations hero (muted strip over the card edge). */
  variant?: HeroStatsStripVariant;
  /**
   * `scroll` — classic horizontal strip (default, used across the app).
   * `grid` — wraps into a 2→5 column mosaic; prefer on data-heavy mobile heroes
   * (e.g. corporation investor vitals) so long currency values cannot collide.
   */
  layout?: HeroStatsStripLayout;
}

/**
 * Stats row under a hero image — shared layout for major pages.
 * See `docs/engineering/ui-reuse-guidelines.md`.
 */
export function HeroStatsStrip({
  children,
  className = "",
  variant = "default",
  layout = "scroll",
}: HeroStatsStripProps) {
  const base = layout === "grid" ? VARIANT_GRID[variant] : VARIANT_SCROLL[variant];
  return <div className={`${base} ${className}`.trim()}>{children}</div>;
}
