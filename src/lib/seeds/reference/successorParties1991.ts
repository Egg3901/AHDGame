import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Organizations active at the January 1991 scenario start. These are
 * separate from the 1953/1979 one-party lists, which are era gated.
 *
 * Historical rosters: IPU 1990 Czechoslovak election
 * https://data.ipu.org/election-summary/HTML/2083_90.htm;
 * Hungarian National Archives 1990 parliament
 * https://mnl.gov.hu/mnl/pml/virtualis_kiallitas/1990_es_orszaggyulesi_valasztasok_mnl_pml;
 * Romanian 1990 parliament (University of Bucharest archive)
 * https://muzeu.unibuc.ro/ro/fpu30-rezultatele-alegerilor-parlamentare-din-20-mai-1990/;
 * Polish 1990 transition chronology
 * https://dokumenty-przelomu.isppan.waw.pl/historia/;
 * Bulgarian 1991 electoral study
 * https://www.iri.org/sites/default/files/fields/field_eo_report/bulgarias_1991_parliamentary_and_local_elections.pdf;
 * Russian opposition: https://oac.cdlib.org/findaid/ark:/13030/kt2h4nd9f0;
 * Yugoslav federal reform alliance: https://hrcak.srce.hr/index.php/clanak/371561;
 * Montenegro's June 1991 party rename: https://dps.me/istorijat/.
 * Ideological positions and colors are scenario authoring, not source claims.
 */
function party(
  countryId: CountryId,
  name: string,
  abbreviation: string,
  color: string,
  economicPosition: number,
  socialPosition: number,
  seedOrder: number,
  regimeStatus: PartySeed["regimeStatus"] = null
): PartySeed {
  return {
    countryId,
    name,
    abbreviation,
    color,
    economicPosition,
    socialPosition,
    seedOrder,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1991-default"],
    regimeStatus,
    treasury: 250_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  };
}

export const SUCCESSOR_PARTIES_1991: Partial<Record<CountryId, PartySeed[]>> = {
  RU: [
    party("RU", "Communist Party of the Soviet Union", "CPSU", "#B11C2B", -4, 1, 1, "ruling"),
    party("RU", "Democratic Russia", "DR", "#2675B9", 2, -2, 2),
    party("RU", "Democratic Party of Russia", "DPR", "#304681", 2, 0, 3),
  ],
  PL: [
    party("PL", "Solidarity Citizens' Committees", "KO", "#D94B39", 1, -1, 1, "ruling"),
    party("PL", "Centre Agreement", "PC", "#315B9B", 2, 2, 2),
    party("PL", "Polish Peasant Party", "PSL", "#3C8E44", -1, 1, 3),
    party("PL", "Social Democracy of the Republic of Poland", "SdRP", "#B53646", -2, -1, 4),
    party("PL", "Confederation for Independent Poland", "KPN", "#8D6335", 1, 3, 5),
    party("PL", "Citizens' Movement for Democratic Action", "ROAD", "#E1A72A", 1, -2, 6),
  ],
  CS: [
    party("CS", "Civic Forum", "OF", "#2586B1", 2, -2, 1, "ruling"),
    party("CS", "Public Against Violence", "VPN", "#3BA7A0", 1, -2, 2),
    party("CS", "Communist Party of Czechoslovakia", "KSČ", "#BD2832", -4, 0, 3),
    party("CS", "Christian Democratic Movement", "KDH", "#E0A22D", 1, 3, 4),
  ],
  HU: [
    party("HU", "Hungarian Democratic Forum", "MDF", "#477C3B", 1, 2, 1, "ruling"),
    party("HU", "Alliance of Free Democrats", "SZDSZ", "#2C77B8", 2, -2, 2),
    party("HU", "Independent Smallholders' Party", "FKgP", "#819B35", 1, 2, 3),
    party("HU", "Hungarian Socialist Party", "MSZP", "#C4303D", -2, -1, 4),
    party("HU", "Alliance of Young Democrats", "Fidesz", "#E5A52E", 2, -2, 5),
    party("HU", "Christian Democratic People's Party", "KDNP", "#9A8A43", 1, 3, 6),
  ],
  RO: [
    party("RO", "National Salvation Front", "FSN", "#D9B43B", -1, 0, 1, "ruling"),
    party("RO", "National Liberal Party", "PNL", "#3279B7", 3, -1, 2),
    party("RO", "National Peasants' Christian Democratic Party", "PNȚCD", "#4B8E4D", 1, 3, 3),
    party("RO", "Democratic Alliance of Hungarians in Romania", "UDMR", "#3C986D", 0, 0, 4),
  ],
  BG: [
    party("BG", "Bulgarian Socialist Party", "BSP", "#B92F3B", -2, 0, 1, "ruling"),
    party("BG", "Union of Democratic Forces", "SDS", "#2F75B5", 2, -1, 2),
    party("BG", "Movement for Rights and Freedoms", "DPS", "#4786A2", 0, -1, 3),
    party("BG", "Bulgarian Agrarian National Union", "BZNS", "#6D9A42", -1, 1, 4),
  ],
  YU: [
    party("YU", "Alliance of Reform Forces of Yugoslavia", "SRSJ", "#5C88B5", 1, -1, 1, "ruling"),
    party("YU", "Socialist Party of Serbia", "SPS", "#B9353F", -2, 2, 2),
    party("YU", "Croatian Democratic Union", "HDZ", "#2A6CA3", 1, 3, 3),
    party("YU", "Party of Democratic Action", "SDA", "#399B60", 0, 2, 4),
    party("YU", "Democratic Opposition of Slovenia", "DEMOS", "#4B8D7B", 2, 0, 5),
    party("YU", "League of Communists of Montenegro", "SKCG", "#A6404B", -1, 1, 6),
    party(
      "YU",
      "VMRO-Democratic Party for Macedonian National Unity",
      "VMRO-DPMNE",
      "#9B702E",
      1,
      3,
      7
    ),
  ],
};
