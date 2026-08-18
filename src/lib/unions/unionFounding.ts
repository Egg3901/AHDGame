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
import type { CountryId } from "@/lib/constants/countries";
import { getFoundingFxRate } from "@/lib/corporations/foundingCosts";

/**
 * Registration fee to charter a union, in CAMPAIGN FUNDS.
 *
 * NOT era-scaled, unlike a corporation founding fee, because campaign funds are
 * not era money. Sector wages and corporate revenue are deflated into the
 * world's era (a 1953 worker earns single digits a year), but campaign war
 * chests are not: live balances run from a few hundred thousand to several
 * million in the same 1953 world. Deflating this fee the way sector money is
 * deflated priced a union charter at ~287, roughly a twentieth of a percent of a
 * typical war chest, which is what "insanely low" was.
 *
 * 500,000 is deliberately a real political commitment: comparable to a whole
 * modest war chest, a serious dent in a large one. Founding a union is meant to
 * cost a politician something they would otherwise spend on themselves.
 */
export const UNION_FOUNDING_COST_CAMPAIGN_FUNDS = 500_000;

/**
 * Action points a founding costs. Chartering the union is the paperwork.
 * Winning a shop is a separate 1-AP treasury spend on the Sectors tab.
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
 * The registration fee in the founder's local currency. Only the FX leg applies,
 * since the fee is campaign money rather than era-deflated sector money. One
 * implementation shared by the command that charges it and the modal that quotes
 * it, so the two can never disagree about the price.
 *
 * `preset` is accepted and ignored so callers do not have to know which money
 * scale this is; removing it would just push the question onto every call site.
 */
export function unionFoundingCostLocal(params: {
  preset?: string | undefined;
  countryId: CountryId;
  forexEnabled: boolean;
}): number {
  const rate = getFoundingFxRate(params.countryId, params.forexEnabled);
  return Math.round(UNION_FOUNDING_COST_CAMPAIGN_FUNDS * rate);
}
