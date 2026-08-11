import type { CountryId } from "@/lib/constants/countries";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";

/**
 * A country's stock of military materiel, by the domain of unit it equips.
 *
 * Keyed on `UnitDomain` rather than an invented component taxonomy: every unit already
 * carries its domain and combat already partitions by it, so a unit knows which store feeds
 * it by construction and there is no mapping table to keep in sync.
 *
 * This is the legible form of "how strong is each arm of the service" — a starved navy shows
 * up as an empty `naval` row — but derived from what the country's industry has actually
 * delivered rather than from a score that decays on a clock. On a one-hour turn a decaying
 * score punishes sleeping; a stock only moves when something is built or issued.
 */
export interface NationalArsenal {
  countryId: CountryId;
  /** Lots in store per domain. Never negative. */
  stock: Record<UnitDomain, number>;
  /**
   * Volume-weighted mean grade (0..3) of the lots in store, per domain — what the country's
   * industry has been able to build, which becomes a newly-issued unit's `techTier`.
   *
   * Raised by delivering better materiel; UNCHANGED by drawing, since issuing kit does not
   * make the remaining kit worse. That asymmetry is why consumers must check stock before
   * trusting grade: a fully drained store keeps its last grade, and `equipUnit` guards
   * against stamping that tier onto a unit that received nothing.
   */
  grade: Record<UnitDomain, number>;
  updatedAt?: Date;
}

export const EMPTY_ARSENAL_STOCK: Record<UnitDomain, number> = {
  ground: 0,
  naval: 0,
  air: 0,
  rocket: 0,
  space: 0,
  marine: 0,
};
