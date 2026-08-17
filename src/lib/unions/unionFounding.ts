/**
 * What founding a union costs. Client-safe on purpose: the modal that collects
 * the name needs to state the price, and `commands/foundUnion.ts` cannot be
 * imported into a browser bundle because it reaches for the database.
 *
 * Both costs are political rather than personal. A union charter is organizing
 * work, so it draws on the campaign war chest and the founder's action points,
 * the same two resources `npps/commands/directAction` spends, instead of
 * personal wealth. That also stops a rich character from buying up an industry's
 * labour movement out of pocket while a well-organized poorer one cannot.
 */
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";
import type { CountryId } from "@/lib/constants/countries";
import { getFoundingFxRate } from "@/lib/corporations/foundingCosts";

/**
 * Modern (₳-anchor) registration fee, scaled into the world's era and the
 * founder's home currency exactly like a corporation founding fee, the same
 * "a flat currency figure is wrong in every era and country but one" problem
 * `unionServices.ts` documents.
 *
 * Set well below `CORPORATION_FOUNDING_COST` (1,000,000): a union is not
 * capitalizing a company, since a founded union's treasury starts at 0. It is a
 * registration fee for the right to contest an industry.
 */
export const UNION_FOUNDING_COST_ANCHOR = 20_000;

/**
 * Action points a founding costs. Deliberately below
 * `ORGANIZE_SECTOR_ACTION_COST` (15): chartering the union is the paperwork,
 * winning it a shop is the work.
 */
export const UNION_FOUNDING_ACTION_COST = 10;

/**
 * Name bounds, shared so the form and the command agree. They did not before:
 * the modal asked for 3 to 80 characters while the command enforced 2 to 60, so
 * a long name passed the form and came back rejected.
 */
export const MIN_UNION_NAME_LENGTH = 2;
export const MAX_UNION_NAME_LENGTH = 60;

/**
 * The registration fee in the founder's local currency, for this world's era.
 * One implementation shared by the command that charges it and the modal that
 * quotes it, so the two can never disagree about the price.
 */
export function unionFoundingCostLocal(params: {
  preset: string | undefined;
  countryId: CountryId;
  forexEnabled: boolean;
}): number {
  const rate = getFoundingFxRate(params.countryId, params.forexEnabled);
  return Math.round(getEraNominalAmount(UNION_FOUNDING_COST_ANCHOR, params.preset) * rate);
}
