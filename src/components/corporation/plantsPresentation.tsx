"use client";

/**
 * Shared plants-tier presentation.
 *
 * Under `marketSystemMode >= "plants"` a sector is a set of PLANTS: capacity is
 * the thing you buy, output is the thing you make, and revenue is DERIVED from
 * the two. Six surfaces have to say that in the same vocabulary — the sectors
 * table, the CEO build summary, the national CEO panel, the expand-market
 * flow, the untapped-market card and the sector page. The formatting and the
 * colour bands live here so they cannot drift apart, which is what happened to
 * the money units before `moneyTimescale` centralised them.
 *
 * Unit convention, stated once: capacity, produced and sold units are all
 * OUTPUT UNITS PER DAY, the same 24-turn financial day `revenue` is stored on.
 * They never need rescaling against each other or against a money figure at
 * the same period.
 */

import {
  FILL_RATE_BAND_LABEL,
  FILL_RATE_BAND_SHORT,
  type FillRateBand,
} from "@/lib/corporations/financialFogOfWar";
import type { BuildQueueSummary } from "@/lib/corporations/sectorBuildQueue";
import type { CorporationType } from "@/lib/constants/corporations";
import { capitalizeFacility, facilityPlural } from "@/lib/constants/facilityVocabulary";
import { deliveryGuidance, type FreightClass } from "@/lib/logistics/freightClass";

/** Canonical noun for capacity across every plants surface. */
export const CAPACITY_UNIT_LABEL = "units/day";

/**
 * Format a unit count compactly. Capacity spans several orders of magnitude
 * across sector types, and a table of raw `1,284,003` numbers is unreadable at
 * a glance, so anything four digits or more collapses to k/M/B — the same
 * shape the money formatter uses, so the two columns scan alike.
 */
export function formatUnits(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString("en-US");
}

/** Fill rate as a whole-percent string. "—" when there is no fill rate. */
export function formatFillPercent(fill: number | null | undefined): string {
  if (fill == null || !Number.isFinite(fill)) return "—";
  return `${Math.round(fill * 100)}%`;
}

/**
 * Semantic token classes for a fill band.
 *
 * This is where the surface spends its boldness: across twenty rows the band
 * colour is the only thing a CEO needs to scan to find the plant that is
 * making things nobody is buying. Everything else on the row stays neutral so
 * this reads.
 */
export const FILL_BAND_CLASSES: Record<FillRateBand, string> = {
  high: "border-success/30 bg-success/10 text-success",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-error/30 bg-error/10 text-error",
};

/** Explanatory sentence for a band, for tooltips and the rival view. */
export function fillBandSentence(band: FillRateBand): string {
  return FILL_RATE_BAND_LABEL[band];
}

/** Short band word for a chip that has no room for a number. */
export function fillBandShort(band: FillRateBand): string {
  return FILL_RATE_BAND_SHORT[band];
}

/**
 * Fill-rate chip.
 *
 * Shows the exact percentage when the viewer has it (owner and insiders), and
 * the band word when they do not (rivals — the exact rate is attack-targeting
 * intel, see financialFogOfWar). Both render the same chip in the same colour,
 * so a rival can see the shape of the market without being handed the number.
 */
export function FillChip({
  fill,
  band,
  className = "",
}: {
  fill: number | null | undefined;
  band: FillRateBand | null | undefined;
  className?: string;
}) {
  if (band == null) {
    return (
      <span
        className={`text-xs tabular-nums text-muted/60 ${className}`.trim()}
        title="This sector produced nothing last turn, so it has no fill rate."
      >
        —
      </span>
    );
  }
  const exact = fill != null && Number.isFinite(fill);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${FILL_BAND_CLASSES[band]} ${className}`.trim()}
      title={
        exact
          ? `${fillBandSentence(band)}. Fill rate is the share of what this sector produced that it actually sold.`
          : `${fillBandSentence(band)}. You do not have access to this corporation's exact fill rate.`
      }
    >
      {exact ? formatFillPercent(fill) : fillBandShort(band)}
    </span>
  );
}

/**
 * Below this share, a delivery-limited fraction is rounding and gets no
 * qualifier. One threshold so the row, the sector page and the tooltips all
 * start saying "freight" at the same point.
 */
export const DELIVERY_LIMITED_MIN_SHARE = 0.01;

/**
 * Marker for a sector whose missing fill is a DELIVERY failure.
 *
 * The fill chip on its own reads as demand every time: a player sees 60% and
 * cuts output, when the fix is freight out of the state. This is the one piece
 * of the row that distinguishes "nobody wanted it" from "it could not get
 * there", which are opposite instructions about what to do next.
 */
export function DeliveryLimitedPill({
  fraction,
  freightClass,
  className = "",
}: {
  fraction: number | null | undefined;
  freightClass?: FreightClass | null;
  className?: string;
}) {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= DELIVERY_LIMITED_MIN_SHARE) {
    return null;
  }
  const { label, explanation, action } = deliveryGuidance(freightClass);
  return (
    <span
      className={`inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-warning ${className}`.trim()}
      title={`${label} limited. ${formatFillPercent(fraction)} of this sector's output could not reach buyers outside this state. ${explanation} ${action} Cutting production is not the fix.`}
    >
      {label}
    </span>
  );
}

/**
 * Small badge for capacity that is paid for and on its way.
 *
 * Mid-build is the state the old growth-slider UI had no way to show at all:
 * money had left the corporation and nothing on screen accounted for it. The
 * badge names both halves — how much, and how long.
 */
/**
 * The one sentence that explains the build-queue pill, shared by its tooltip and
 * its accessible name so a screen reader and a mouse user get the same words.
 */
export function buildQueueBadgeLabel(queue: BuildQueueSummary): string {
  const turns = queue.turnsRemaining;
  return (
    `${Math.round(queue.unitsOrdered).toLocaleString("en-US")} ${CAPACITY_UNIT_LABEL} of capacity is paid for and under construction` +
    (queue.orders > 1 ? ` across ${queue.orders} orders` : "") +
    (turns != null ? `. The next order lands in ${turns} turn${turns === 1 ? "" : "s"}.` : ".")
  );
}

export function BuildQueueBadge({
  queue,
  className = "",
}: {
  queue: BuildQueueSummary | null | undefined;
  className?: string;
}) {
  if (!queue || queue.unitsOrdered <= 0) return null;
  const turns = queue.turnsRemaining;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-semibold tabular-nums text-primary ${className}`.trim()}
      aria-label={buildQueueBadgeLabel(queue)}
      title={buildQueueBadgeLabel(queue)}
    >
      +{formatUnits(queue.unitsOrdered)}
      {/* Ticket #1141: a player read this pill as part of the freight badge next
          to it and asked what freight meant in sectors. The number and the bare
          "38T" said nothing on their own, and the explanation was hover-only, so
          it did not exist at all on touch. Name the thing on the face of it. */}
      <span className="font-normal opacity-80">building</span>
      {turns != null && (
        <span className="font-normal opacity-80">
          {turns}
          {"T"}
        </span>
      )}
    </span>
  );
}

/**
 * Pill marking a cold-stowed sector. Pairs with row dimming.
 *
 * `sectorType` is optional because a few callers render the pill in an
 * aggregate list with no single type; those get "facilities".
 */
export function MothballedPill({
  className = "",
  sectorType,
}: {
  className?: string;
  sectorType?: CorporationType;
}) {
  const sites = facilityPlural(sectorType);
  return (
    <span
      className={`inline-flex items-center rounded-full border border-card-border bg-card-muted/60 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-muted ${className}`.trim()}
      title={`Mothballed. ${capitalizeFacility(sites)} here produce nothing and pay reduced upkeep. Reactivating is free.`}
    >
      Mothballed
    </span>
  );
}

/** Deep link to a sector's build dialog. One convention, one place. */
export function sectorBuildUrl(corpId: string, sectorId: string): string {
  return `/corporation/${corpId}/sector/${sectorId}?build=1`;
}
