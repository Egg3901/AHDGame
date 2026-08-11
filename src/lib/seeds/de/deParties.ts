import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * German default political parties.
 *
 * Economic/social positions on -5 to +5 scale, calibrated to German politics:
 *   SPD:      centre-left economically, progressive socially (grand-coalition staple)
 *   CDU:      centre-right economically, moderate-traditional socially
 *   CSU:      centre-right economically, traditional socially (Bavaria-only; CDU's sister)
 *   Grüne:    centre-left economically (ecological), very progressive socially
 *   FDP:      pro-market liberal economically, socially liberal
 *   Linke:    far-left economically, very progressive socially (eastern strongholds; 2019-only)
 *   AfD:      right-populist economically, very traditional socially (eastern strongholds; 2019-only)
 *   PDS:      far-left economically, secular-progressive socially (East-only successor to SED; 1991-only)
 *   DP:       national-conservative (1953-only; Adenauer coalition partner)
 *   GB/BHE:   expellee party (1953-only; entered Bundestag 1953)
 *
 * Major-party IDs in countries.ts reference: "spd" and "cdu" (CDU/CSU act as one
 * union faction for Fraktion purposes but remain two distinct parties in seed).
 *
 * Seeded as `isDefault: true` — they always exist and cannot be deleted.
 * seedOrder determines sequentialId assignment within DE.
 */
export const deParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "DE",
    name: "Sozialdemokratische Partei Deutschlands",
    abbreviation: "SPD",
    color: "#E3000F",
    economicPosition: -2,
    socialPosition: -2,
    memberCount: 0,
    isDefault: true,
    treasury: 1_500_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 2,
    countryId: "DE",
    name: "Christlich Demokratische Union",
    abbreviation: "CDU",
    color: "#000000",
    economicPosition: 2,
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    treasury: 1_500_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 3,
    countryId: "DE",
    name: "Christlich-Soziale Union in Bayern",
    abbreviation: "CSU",
    color: "#0080C8",
    economicPosition: 2,
    socialPosition: 2,
    memberCount: 0,
    isDefault: true,
    treasury: 500_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    // Founded 1980 / entered Bundestag 1983 — not present in 1953.
    // Keep 1979+ so existing Cold-War and modern DE rosters stay intact.
    seedOrder: 4,
    countryId: "DE",
    name: "Bündnis 90/Die Grünen",
    abbreviation: "GRN",
    color: "#64A12D",
    economicPosition: -2,
    socialPosition: -4,
    memberCount: 0,
    isDefault: true,
    treasury: 1_000_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: [
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
    ],
  },
  {
    seedOrder: 5,
    countryId: "DE",
    name: "Freie Demokratische Partei",
    abbreviation: "FDP",
    color: "#FFED00",
    economicPosition: 3,
    socialPosition: -1,
    memberCount: 0,
    isDefault: true,
    treasury: 750_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    // Deutsche Partei — national-conservative coalition partner of Adenauer's
    // CDU/CSU in the 2nd Bundestag (1953 election: 15 seats; Nohlen & Stöver).
    // Absorbed into the CDU by the early 1960s — 1953-only.
    seedOrder: 9,
    countryId: "DE",
    name: "Deutsche Partei",
    abbreviation: "DP",
    color: "#003366",
    economicPosition: 2,
    socialPosition: 3,
    memberCount: 0,
    isDefault: true,
    treasury: 400_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1953-default"],
  },
  {
    // Gesamtdeutscher Block/BHE — expellee party founded 1950; entered the
    // Bundestag in 1953 (27 seats). Represented Vertriebene from the lost
    // eastern territories. Collapsed after the mid-1950s — 1953-only.
    seedOrder: 10,
    countryId: "DE",
    name: "Gesamtdeutscher Block/BHE",
    abbreviation: "GB/BHE",
    color: "#8B4513",
    economicPosition: 1,
    socialPosition: 2,
    memberCount: 0,
    isDefault: true,
    treasury: 350_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1953-default"],
  },
  {
    // 2019-only: Die Linke was founded in 2007 from the merger of
    // Linkspartei.PDS and WASG. For 1991 the historical equivalent is
    // PDS (see seedOrder 8 below).
    seedOrder: 6,
    countryId: "DE",
    name: "Die Linke",
    abbreviation: "LNK",
    color: "#BE3075",
    economicPosition: -4,
    socialPosition: -3,
    memberCount: 0,
    isDefault: true,
    treasury: 500_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["2019-default", "2023-default"],
  },
  {
    // 2019-only: AfD was founded in 2013. No meaningful 1991 analogue —
    // the right-populist niche was occupied by REP / DVU at much smaller
    // scale and neither held Bundestag seats in 1990.
    seedOrder: 7,
    countryId: "DE",
    name: "Alternative für Deutschland",
    abbreviation: "AFD",
    color: "#009EE0",
    economicPosition: 2,
    socialPosition: 4,
    memberCount: 0,
    isDefault: true,
    treasury: 500_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["2019-default", "2023-default"],
  },
  {
    // 1991-only: PDS (Partei des Demokratischen Sozialismus) was the
    // direct successor to SED in former East Germany. Active 1989-2007,
    // when it merged with WASG to form Die Linke. Held 17 Bundestag
    // seats after the 1990 reunification election; concentrated in the
    // five "new Länder".
    seedOrder: 8,
    countryId: "DE",
    name: "Partei des Demokratischen Sozialismus",
    abbreviation: "PDS",
    color: "#8E44AD",
    economicPosition: -4,
    socialPosition: -3,
    memberCount: 0,
    isDefault: true,
    treasury: 500_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1991-default"],
  },
];
