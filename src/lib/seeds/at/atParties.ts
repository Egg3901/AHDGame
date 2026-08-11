import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Austria default political parties.
 *
 *  - 1953: ÖVP (Raab, grand-coalition senior partner) + SPÖ + VdU (the
 *    national-liberal "third camp", FPÖ's predecessor) + KPÖ (relevant only
 *    under Soviet occupation).
 *  - 1979: SPÖ (Kreisky's third absolute majority) + ÖVP + FPÖ.
 *  - 1991: same three-party core (SPÖ/ÖVP/FPÖ, continuous since 1956/1966/1955
 *    respectively) plus Die Grünen, in parliament since 1986.
 *
 * Positions -5..+5. Each entry is gated via `validForPresets`.
 */
export const atParties: PartySeed[] = [
  // ─── 1979 Kreisky era (continuous into 1991) ───────────────────────────
  {
    seedOrder: 1,
    countryId: "AT",
    name: "Sozialistische Partei Österreichs",
    abbreviation: "SPÖ",
    color: "#E30613",
    economicPosition: -2, // Austro-Keynesianism, big nationalised sector
    socialPosition: -1,
    memberCount: 0,
    isDefault: true,
    // Same party governs continuously through the 1990 Vranitzky election.
    validForPresets: ["1979-default", "1991-default"],
    regimeStatus: "approved",
    treasury: 850_000,
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
    countryId: "AT",
    name: "Österreichische Volkspartei",
    abbreviation: "ÖVP",
    color: "#191919",
    economicPosition: 2,
    socialPosition: 2, // Catholic-conservative Lager
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1979-default", "1991-default"],
    regimeStatus: "approved",
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
    seedOrder: 3,
    countryId: "AT",
    name: "Freiheitliche Partei Österreichs",
    abbreviation: "FPÖ",
    color: "#0056A2",
    economicPosition: 2,
    socialPosition: 2, // the national-liberal third camp
    memberCount: 0,
    isDefault: true,
    // Continuous into 1991, pre-Haider (leader from Sept 1986) liberal wing
    // still fresh off 1986's split; positions kept at the 1979 baseline.
    validForPresets: ["1979-default", "1991-default"],
    regimeStatus: "approved",
    treasury: 350_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  // ─── 1991 Second Republic addition ─────────────────────────────────────
  {
    // Entered the Nationalrat in 1986; fourth parliamentary force by 1990.
    seedOrder: 4,
    countryId: "AT",
    name: "Die Grünen",
    abbreviation: "Grüne",
    color: "#5DA226",
    economicPosition: -1, // ecological-left, redistribution + regulation
    socialPosition: -3, // socially liberal, anti-nuclear founding cause
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1991-default"],
    regimeStatus: "approved",
    treasury: 200_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  // ─── 1953 occupied republic ───────────────────────────────────────────
  {
    seedOrder: 10,
    countryId: "AT",
    name: "Österreichische Volkspartei",
    abbreviation: "ÖVP",
    color: "#191919",
    economicPosition: 1, // grand-coalition corporatism, Raab-Kamitz course
    socialPosition: 2,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
    regimeStatus: "approved",
    treasury: 700_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 11,
    countryId: "AT",
    name: "Sozialistische Partei Österreichs",
    abbreviation: "SPÖ",
    color: "#E30613",
    economicPosition: -2,
    socialPosition: -1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
    regimeStatus: "approved",
    treasury: 650_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 12,
    countryId: "AT",
    name: "Verband der Unabhängigen",
    abbreviation: "VdU",
    color: "#0056A2",
    economicPosition: 2,
    socialPosition: 2, // third-camp nationals and amnestied ex-NSDAP voters
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
    regimeStatus: "approved",
    treasury: 300_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 13,
    countryId: "AT",
    name: "Kommunistische Partei Österreichs",
    abbreviation: "KPÖ",
    color: "#C62828",
    economicPosition: -5,
    socialPosition: -1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
    regimeStatus: "approved",
    treasury: 250_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];

export default atParties;
