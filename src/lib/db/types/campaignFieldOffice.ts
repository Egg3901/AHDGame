import type { ObjectId } from "mongodb";

/**
 * A campaign's physical field office. One document per office.
 *
 * Offices are geographic: `regionId` is the election region (US state, UK
 * region, JP region) and `subdivisionId` pins the office to a subdivision
 * inside it (a US county FIPS) when the country's field-office scope is
 * "county". Region-scoped countries leave it null and may stack several
 * offices in one region.
 *
 * Offices belong to the campaign, so they live and die with it: the per-turn
 * upkeep phase sweeps offices whose campaign is gone, and the vote engines
 * read them per election. Effects ramp in over `FIELD_OFFICE_RAMP_TURNS`
 * from `openedTurn`, so a late office is worth less than an early one.
 */
export interface CampaignFieldOffice {
  _id: ObjectId;
  campaignId: ObjectId;
  electionId: ObjectId;
  /** Campaign candidate (character or NPP id), denormalized for engine lookups. */
  candidateId: ObjectId;
  countryId: string;
  regionId: string;
  /** County FIPS (US) or null for region-scoped offices. */
  subdivisionId: string | null;
  /** Display name of the subdivision or region, frozen at open time. */
  label: string;
  /** Subdivision electorate share of its region at open time (0..1); 0 for region scope. */
  electorateShare: number;
  /**
   * Candidate's relative strength in the subdivision at open time (0.25..1.75,
   * 1 = region average). See `fieldOfficeYield`. Frozen so a later party
   * repositioning does not silently re-price offices already on the ground.
   */
  yieldFactor: number;
  openedTurn: number;
  /** Local-currency funds paid to open. */
  openCostLocal: number;
  openedByCharacterId: ObjectId | null;
  createdAt: Date;
}
