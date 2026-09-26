import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Romania 2027 democratic roster — the 1 December 2024 legislative result, the
 * latest completed parliamentary election (Permanent Electoral Authority
 * https://prezenta.roaep.ro and Central Electoral Bureau https://www.bec.ro):
 * Chamber (331) PSD 86, AUR 63, PNL 49, USR 40, SOS 28, POT 24, UDMR 22,
 * national minorities 19; Senate (134) PSD 36, AUR 28, PNL 22, USR 19,
 * SOS 12, UDMR 10, POT 7. The 19 minority seats are held by non-party
 * ethnic organizations, so they seed no party here. Positions on -5..+5.
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
    countryId: "RO",
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

export const roParties2027: PartySeed[] = [
  modern(1, "Partidul Social Democrat", "PSD", "#E30613", -2, 1),
  modern(2, "Alianța pentru Unirea Românilor", "AUR", "#8B6F1F", 0, 5),
  modern(3, "Partidul Național Liberal", "PNL", "#0066CC", 2, 1),
  modern(4, "Uniunea Salvați România", "USR", "#00AEEF", 1, -2),
  modern(5, "S.O.S. România", "SOS", "#5B2D8E", -1, 5),
  modern(6, "Partidul Oamenilor Tineri", "POT", "#E8722A", 0, 4),
  modern(7, "Uniunea Democrată Maghiară din România", "UDMR", "#009A44", 0, 1),
];
export default roParties2027;
