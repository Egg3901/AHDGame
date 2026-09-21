import type { TechEffect } from "./effects";

/**
 * Media & Entertainment lane merge (issue #2234).
 *
 * The separate `media` and `entertainment` tech lanes merge into one
 * `media_entertainment` lane. Every lane segment keeps exactly its canonical
 * length (base 2/5, early fill 7, extra/extra2 2, v3 6), so each merged
 * decade still carries slots 1-15 with unique ids.
 *
 * Deterministic merge rule, applied per (decade, segment):
 * 1. Order each legacy segment list as authored, except the entertainment
 *    list is reordered anchor-first per ENTERTAINMENT_PICK_ORDER below.
 * 2. Base/fill/extra segments: interleave media-first (media[0],
 *    entertainment[0], media[1], ...) and truncate to the segment length.
 * 3. v3 segments: entries take the first three of the media-first
 *    interleave (media[0], entertainment[0], media[1]); capstones follow in
 *    entry order (media[3], entertainment[3], media[4]), so each surviving
 *    capstone still requires its own entry under the slot N → N-3 prereq.
 * 4. Rewrite unlock effects: `streaming_media` and `live_service` both
 *    repoint to the canonical `streaming` strategy, matching
 *    `canonicalMediaStrategyForLegacy`.
 *
 * Anchor pinning exists for exactly one segment: 1950 base takes Record
 * Labels (entertainment index 1) over Television Studios (index 0), because
 * Record Labels is the music_label technology gate. Without the pin, pure
 * alternation would drop the anchor and strand the music model.
 *
 * Pure authoring helpers: plain data in, plain data out. No DB, clock,
 * randomness, or env.
 */

export const MEDIA_ENTERTAINMENT_LANE = "media_entertainment";

export const LEGACY_MEDIA_LANES = ["media", "entertainment"] as const;

export type LegacyMediaLane = (typeof LEGACY_MEDIA_LANES)[number];

/** Structural lane spec: nodes.ts and v3 NodeSpecs both satisfy this. */
export interface LaneSpec {
  name: string;
  description: string;
  effects: TechEffect[];
  cashRevenueFraction?: number;
}

export type LaneSegment = "base" | "fill" | "extra" | "extra2" | "v3";

/** Early decades author 2 base slots + 7 fill slots; later decades 5 + 2 + 2. */
const EARLY_DECADES: ReadonlySet<string> = new Set(["1940", "1950", "1960", "1970"]);

/** Later decades with the 5/2/2 base/extra/extra2 layout. */
const LATER_DECADES: ReadonlySet<string> = new Set([
  "1979",
  "1989",
  "1999",
  "2009",
  "2019",
  "2029",
]);

/**
 * Non-identity entertainment pick orders, keyed `${decade}:${segment}`.
 * Entries list entertainment indices in pick order; every other segment
 * keeps authored order.
 */
const ENTERTAINMENT_PICK_ORDER: Record<string, readonly number[]> = {
  // Pin Record Labels (the music_label gate anchor) over Television Studios.
  "1950:base": [1, 0],
};

function orderEntertainment<T>(specs: readonly T[], decadeId: string, segment: LaneSegment): T[] {
  const order = ENTERTAINMENT_PICK_ORDER[`${decadeId}:${segment}`];
  if (!order) return [...specs];
  const picked: T[] = [];
  for (const pick of order) {
    const spec: T | undefined = specs[pick];
    if (spec !== undefined) picked.push(spec);
  }
  // Any index the override does not name keeps its authored relative order.
  const pickedIndexes = new Set(order);
  for (let index = 0; index < specs.length; index++) {
    if (pickedIndexes.has(index)) continue;
    const spec: T | undefined = specs[index];
    if (spec !== undefined) picked.push(spec);
  }
  return picked;
}

function interleaveMediaFirst<T>(
  media: readonly T[],
  entertainment: readonly T[],
  length: number
): T[] {
  const out: T[] = [];
  const rounds = Math.max(media.length, entertainment.length);
  for (let i = 0; i < rounds && out.length < length; i++) {
    if (i < media.length && out.length < length) out.push(media[i]);
    if (i < entertainment.length && out.length < length) out.push(entertainment[i]);
  }
  return out;
}

/**
 * Repoint legacy strategy unlocks to the canonical catalog, matching
 * `canonicalMediaStrategyForLegacy` in mediaConsolidation/rules: both
 * `streaming_media` and `live_service` unlock `streaming`.
 */
function rewriteUnlockEffects(effects: readonly TechEffect[]): TechEffect[] {
  const out: TechEffect[] = [];
  for (const effect of effects) {
    if (
      effect.kind === "unlockStrategy" &&
      (effect.strategyId === "streaming_media" || effect.strategyId === "live_service")
    ) {
      out.push({ ...effect, strategyId: "streaming" });
    } else {
      out.push(effect);
    }
  }
  return out;
}

/**
 * Merge one lane segment: media-first interleave truncated to the media
 * segment length (both legacy lanes author the same segment lengths), with
 * unlock effects rewritten. Pure; never mutates its inputs.
 */
export function mergeLaneSegment<T extends LaneSpec>(
  media: readonly T[],
  entertainment: readonly T[],
  decadeId: string,
  segment: LaneSegment
): T[] {
  const ordered = orderEntertainment(entertainment, decadeId, segment);
  return interleaveMediaFirst(media, ordered, media.length).map((spec) => ({
    ...spec,
    effects: rewriteUnlockEffects(spec.effects),
  }));
}

/**
 * Merge one v3 decade (six entries + six capstones per legacy lane) into
 * six specs: entries media[0], entertainment[0], media[1], then the matching
 * capstones media[3], entertainment[3], media[4]. The builder maps these
 * positionally to slots 10-15, so slot 13 caps slot 10, 14 caps 11, 15 caps
 * 12 — each surviving capstone still follows its own entry.
 */
export function mergeV3Decade<T extends LaneSpec>(
  media: readonly T[],
  entertainment: readonly T[]
): T[] {
  const picks = [media[0], entertainment[0], media[1], media[3], entertainment[3], media[4]].filter(
    (spec) => spec !== undefined
  );
  return picks.map((spec) => ({ ...spec, effects: rewriteUnlockEffects(spec.effects) }));
}

/**
 * Merge two decade-keyed lane maps segment-wise. Decades present on only
 * one side pass through (rewritten); the merge never invents specs.
 */
export function mergeLaneMaps<T extends LaneSpec>(
  media: Record<string, T[]>,
  entertainment: Record<string, T[]>,
  segment: LaneSegment
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const decadeId of new Set([...Object.keys(media), ...Object.keys(entertainment)])) {
    out[decadeId] =
      segment === "v3"
        ? mergeV3Decade(media[decadeId] ?? [], entertainment[decadeId] ?? [])
        : mergeLaneSegment(media[decadeId] ?? [], entertainment[decadeId] ?? [], decadeId, segment);
  }
  return out;
}

// ─── Legacy tech-id canonicalization ─────────────────────────────────────────
// Persisted unlocks still carry `<media|entertainment>-<decade>-<slot>` ids.
// This maps each one onto the merged lane position the rule above assigns it.
// Base/fill/extra: media index i → merged 2i, entertainment index i → merged
// 2i+1, clamped to the segment end when alternation truncated the tail.
// v3 follows the entry/capstone picks: media [10, 12, -, 13, 15, -] and
// entertainment [11, -, -, 14, -, -] (- = truncated tail, clamps to 15).
// Unknown or non-legacy ids read as null (the caller keeps them as-is).

const LEGACY_TECH_ID_PATTERN = /^(media|entertainment)-(\d+)-(\d+)$/;

/** Merged slot per legacy v3 index; -1 marks the truncated tail. */
const V3_MERGED_SLOT: Record<LegacyMediaLane, readonly number[]> = {
  media: [10, 12, -1, 13, 15, -1],
  entertainment: [11, -1, -1, 14, -1, -1],
};

interface SegmentLayout {
  segment: LaneSegment;
  start: number;
  length: number;
}

function layoutFor(decadeId: string, slot: number): SegmentLayout | null {
  if (slot >= 10 && slot <= 15) return { segment: "v3", start: 10, length: 6 };
  if (EARLY_DECADES.has(decadeId)) {
    if (slot >= 1 && slot <= 2) return { segment: "base", start: 1, length: 2 };
    if (slot >= 3 && slot <= 9) return { segment: "fill", start: 3, length: 7 };
    return null;
  }
  if (LATER_DECADES.has(decadeId)) {
    if (slot >= 1 && slot <= 5) return { segment: "base", start: 1, length: 5 };
    if (slot >= 6 && slot <= 7) return { segment: "extra", start: 6, length: 2 };
    if (slot >= 8 && slot <= 9) return { segment: "extra2", start: 8, length: 2 };
    return null;
  }
  return null;
}

/**
 * Map one persisted legacy tech node id onto the canonical
 * `media_entertainment` lane, or null when the id is not a legacy
 * media/entertainment positional id. Deterministic and total over the
 * authored lanes: every legacy slot maps to a surviving canonical slot.
 */
export function mapLegacyMediaTechId(nodeId: unknown): string | null {
  if (typeof nodeId !== "string") return null;
  const match = LEGACY_TECH_ID_PATTERN.exec(nodeId);
  if (!match) return null;
  const lane = match[1] as LegacyMediaLane;
  const decadeId = match[2];
  const slot = Number(match[3]);
  const layout = layoutFor(decadeId, slot);
  if (!layout) return null;
  if (layout.segment === "v3") {
    const mapped = V3_MERGED_SLOT[lane][slot - layout.start] ?? -1;
    return `${MEDIA_ENTERTAINMENT_LANE}-${decadeId}-${mapped >= 0 ? mapped : 15}`;
  }
  let index = slot - layout.start;
  if (lane === "entertainment") {
    const order = ENTERTAINMENT_PICK_ORDER[`${decadeId}:${layout.segment}`];
    if (order) {
      const picked = order.indexOf(index);
      // An index the override displaced (Television Studios, 1950 base)
      // clamps onto the segment end like any other truncated tail.
      index = picked >= 0 ? picked : layout.length - 1;
    }
  }
  const mergedIndex =
    lane === "media"
      ? Math.min(2 * index, layout.length - 1)
      : Math.min(2 * index + 1, layout.length - 1);
  return `${MEDIA_ENTERTAINMENT_LANE}-${decadeId}-${layout.start + mergedIndex}`;
}
