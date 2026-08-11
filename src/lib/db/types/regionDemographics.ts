import type { CountryId } from "@/lib/constants/countries";

/**
 * Single-year age×sex population stock (SSOT) for one region.
 *
 * `ages.male` / `ages.female` are each length 101: index 0..100, where index
 * 100 absorbs the "100+" tail. This vector is the canonical population stock —
 * all coarse groupings, working-age, childbearing pool, median age, sex ratio,
 * and dependency ratio are DERIVED views computed on read (see cohortVector.ts),
 * never stored (design §4.1). Lives in its own collection (NOT inline on the hot
 * `states` doc) per the project's OOM/turn-stall history (R4/F-9).
 */
export interface RegionDemographics {
  _id: string; // region id (matches states._id)
  countryId: CountryId;
  ages: { male: number[]; female: number[] }; // each length 101
  lastUpdated: Date;
}
