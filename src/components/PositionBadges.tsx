/**
 * Unified position display component for economic/social/lean axes.
 *
 * Two modes:
 *  - "integer" (default): integer scale −5 to +5 (see POLICY_INTEGER_AXIS_RANGE in politics.ts), used for policy & legislation positions
 *  - "lean": continuous scale (~-2 to +2), used for state demographic lean values
 *
 * Color conventions:
 *  - Economic: blue (left/progressive) → muted (center) → red (right/conservative)
 *  - Social:   teal (liberal) → muted (moderate) → amber (traditional)
 */

import {
  getEconomicPositionName,
  getSocialPositionName,
  roundLabelBucket,
} from "@/lib/utils/politics";
import { getLeanLabel, getSocialLeanLabel } from "@/lib/utils/demographics";

export type PositionMode = "integer" | "lean";

export interface PositionBadgesProps {
  economic?: number | null;
  social?: number | null;
  /** "integer" (−5..+5, default) or "lean" (continuous ~−2..+2) */
  mode?: PositionMode;
  /** Tailwind alignment class for the outer column: "items-end" (default) or "items-start" */
  align?: "items-end" | "items-start" | "items-center";
  className?: string;
  /** Country id — used to apply the correct colour convention (blue=right for UK/DE) */
  countryId?: string;
}

// Countries that use European political colour convention: blue=right, red=left.
const EUROPEAN_COLOUR_COUNTRIES = new Set(["UK", "DE"]);

function econBadgeColor(v: number, _mode: PositionMode, countryId?: string): string {
  // Bucket on the shared 0.5 ruler so the badge colour agrees with the label.
  const bucket = roundLabelBucket(v);
  const isLeft = bucket < 0;
  const isRight = bucket > 0;
  const european = countryId && EUROPEAN_COLOUR_COUNTRIES.has(countryId);
  if (isLeft)
    return european
      ? "bg-red-500/15 text-red-500 border-red-500/40"
      : "bg-blue-500/15 text-blue-500 border-blue-500/40";
  if (isRight)
    return european
      ? "bg-blue-500/15 text-blue-500 border-blue-500/40"
      : "bg-red-500/15 text-red-500 border-red-500/40";
  return "bg-muted/20 text-muted-foreground border-border";
}

function socialBadgeColor(v: number, _mode: PositionMode): string {
  const bucket = roundLabelBucket(v);
  const isLib = bucket < 0;
  const isTrad = bucket > 0;
  if (isLib) return "bg-teal-500/15 text-teal-500 border-teal-500/40";
  if (isTrad) return "bg-amber-500/15 text-amber-500 border-amber-500/40";
  return "bg-muted/20 text-muted-foreground border-border";
}

function getEconLabel(v: number, mode: PositionMode): string {
  return mode === "lean" ? getLeanLabel(v) : getEconomicPositionName(v);
}

function getSocialLabel(v: number, mode: PositionMode): string {
  return mode === "lean" ? getSocialLeanLabel(v) : getSocialPositionName(v);
}

/** Shared grid: fixed label column + consistent badge width */
const POSITION_BADGE_ROW =
  "grid grid-cols-[4.75rem_minmax(4.5rem,max-content)] items-center gap-x-2";

export function PositionBadges({
  economic,
  social,
  mode = "integer",
  align = "items-end",
  className = "",
  countryId,
}: PositionBadgesProps) {
  const showEcon = economic != null;
  const showSocial = social != null;
  if (!showEcon && !showSocial) return null;

  const badgeBase =
    "inline-flex min-h-[1.5rem] items-center justify-center rounded border px-1.5 py-0.5 text-center text-xs font-semibold leading-tight";

  return (
    <div className={`flex flex-col ${align} gap-1.5 ${className}`}>
      {showEcon && (
        <div className={POSITION_BADGE_ROW}>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Economic
          </span>
          <span className={`${badgeBase} ${econBadgeColor(economic!, mode, countryId)}`}>
            {getEconLabel(economic!, mode)}
          </span>
        </div>
      )}
      {showSocial && (
        <div className={POSITION_BADGE_ROW}>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Social
          </span>
          <span className={`${badgeBase} ${socialBadgeColor(social!, mode)}`}>
            {getSocialLabel(social!, mode)}
          </span>
        </div>
      )}
    </div>
  );
}
