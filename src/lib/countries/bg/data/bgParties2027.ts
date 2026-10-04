import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Five seat-winning lists in the April 2026 election (131/39/37/21/12).
 * The 2027 game starts from this latest completed election, with no claimed
 * 2027 result. Positions are gameplay estimates, not election statistics.
 * https://results.cik.bg/pe202604/hnm.64.html
 */
function party(
  seedOrder: number,
  name: string,
  abbreviation: string,
  color: string,
  economicPosition: number,
  socialPosition: number
): PartySeed {
  return {
    seedOrder,
    countryId: "BG",
    name,
    abbreviation,
    color,
    economicPosition,
    socialPosition,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["2027-default"],
    regimeStatus: "approved",
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  };
}
export const bgParties2027: PartySeed[] = [
  party(1, "Progressive Bulgaria", "PB", "#7B3F61", -1, 1),
  party(2, "GERB–SDS", "GERB-SDS", "#0056A6", 2, 1),
  party(3, "We Continue the Change–Democratic Bulgaria", "PP-DB", "#5B79D0", 1, -2),
  party(4, "Movement for Rights and Freedoms", "DPS", "#0066AA", 1, 0),
  party(5, "Revival", "V", "#3B6B47", 0, 5),
];
export default bgParties2027;
