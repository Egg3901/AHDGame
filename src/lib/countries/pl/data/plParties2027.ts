import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Poland 2027 democratic roster — the October 2023 Sejm result, the latest
 * completed parliamentary election (National Electoral Commission):
 * https://sejmsenat2023.pkw.gov.pl/sejmsenat2023/
 * PiS 194, Civic Coalition (KO) 157, Third Way 65, New Left 26,
 * Confederation 18 (460 seats). Positions on the -5..+5 scale.
 */
function modern(
  seedOrder: number,
  name: string,
  abbreviation: string,
  color: string,
  economicPosition: number,
  socialPosition: number
): PartySeed {
  return {
    seedOrder,
    countryId: "PL",
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

export const plParties2027: PartySeed[] = [
  modern(1, "Prawo i Sprawiedliwość", "PiS", "#1B3A6B", 1, 4),
  modern(2, "Koalicja Obywatelska", "KO", "#FF7A00", 1, -2),
  modern(3, "Trzecia Droga", "TD", "#00A651", 0, 0),
  modern(4, "Nowa Lewica", "LEWICA", "#C1272D", -3, -3),
  modern(5, "Konfederacja", "KONF", "#0B1F4B", 4, 4),
];
export default plParties2027;
