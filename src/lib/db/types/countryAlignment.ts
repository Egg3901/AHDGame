import type { ObjectId } from "mongodb";
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";
import type { AlignmentCountryKey } from "@/lib/constants/alignmentRoster";

/**
 * A world entity's standing between the era's poles.
 *
 * Keyed by `entityId`, NOT by CountryId: alignment has to cover every entity the
 * sphere system sponsors, and most of those (Jordan, Afghanistan, Laos, ...) are
 * macro-tier entities the game does not implement as playable countries. Every
 * playable CountryId is also an AlignmentCountryKey, so a country id can be
 * passed here directly.
 *
 * `shares` plus `nonAligned` always total exactly 100 — the invariant is
 * enforced by `normalizeShares`, which is the sole write path. Consumers can
 * therefore treat a row as a complete distribution without guarding.
 */
export interface CountryAlignment {
  _id: ObjectId;
  entityId: AlignmentCountryKey;
  /** Era whose poles `shares` is expressed in. Drives era-crossing detection. */
  eraKey: string;
  shares: Partial<Record<AlignmentPoleId, number>>;
  nonAligned: number;
  /** Prior turn's values, for the per-turn trend. Null on seed and on crossing. */
  previous: { shares: Partial<Record<AlignmentPoleId, number>>; nonAligned: number } | null;
  /**
   * First turn this entity's share in each pole reached the join threshold, per
   * pole. Cleared for a pole the moment the share drops back below it, so an
   * accession needs a SUSTAINED run. Keyed by pole rather than by organization
   * because every org on a pole asks the same question of it.
   */
  joinReadySince?: Partial<Record<AlignmentPoleId, number>> | null;
  turn: number;
  updatedAt: Date;
}
