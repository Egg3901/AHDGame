import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * France default political parties.
 *
 *  - 1953 (Fourth Republic): SFIO, MRP, RGR, RPF, PCF — the early-1950s
 *    Assembly landscape under unstable coalition cabinets.
 *  - 1979 (Fifth Republic, Giscard): RPR, UDF, PS, PCF.
 *  - 1991 (Fifth Republic, Mitterrand's second term, Rocard/Cresson
 *    government): same RPR/UDF/PS/PCF core plus the Front National, which
 *    broke through nationally from 1984 onward.
 *
 * Positions on -5..+5. Each entry is gated via `validForPresets`.
 */
export const frParties: PartySeed[] = [
  // ─── 1953 Fourth Republic ──────────────────────────────────────────────
  {
    seedOrder: 10,
    countryId: "FR",
    name: "Section française de l'Internationale ouvrière",
    abbreviation: "SFIO",
    color: "#E4002B",
    economicPosition: -2, // democratic-socialist; welfare + mixed economy
    socialPosition: -1,
    foreignPolicy: 0, // Atlanticist socialists; European Defence Community split
    culture: -1,
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
    countryId: "FR",
    name: "Mouvement républicain populaire",
    abbreviation: "MRP",
    color: "#F5A623",
    economicPosition: 0, // Christian-democratic; social Catholicism + market
    socialPosition: 2, // Catholic traditionalism
    foreignPolicy: 1, // European integration (Schuman, Bidault)
    culture: 2,
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
    countryId: "FR",
    name: "Rassemblement des gauches républicaines",
    abbreviation: "RGR",
    color: "#FFD700",
    economicPosition: 1, // Radical / centre; laissez-faire with colonial empire
    socialPosition: -1, // secular anticlerical tradition
    foreignPolicy: 1, // Atlanticist, pro-empire
    culture: -1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
    regimeStatus: "approved",
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
    seedOrder: 13,
    countryId: "FR",
    name: "Rassemblement du peuple français",
    abbreviation: "RPF",
    color: "#0055A4",
    economicPosition: 2, // Gaullist; anti-regime, strong executive
    socialPosition: 2, // national-conservative
    foreignPolicy: 2, // Gaullist independence, anti-EDC
    culture: 2,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
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
  // ─── 1979 Fifth Republic ───────────────────────────────────────────────
  {
    seedOrder: 1,
    countryId: "FR",
    name: "Rassemblement pour la République",
    abbreviation: "RPR",
    color: "#0066CC",
    economicPosition: 2, // Gaullist dirigiste-but-market centre-right
    socialPosition: 2, // national-conservative
    foreignPolicy: 2, // Gaullist independence, force de frappe
    culture: 2,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1979-default", "1991-default"],
    regimeStatus: "approved",
    treasury: 800_000,
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
    countryId: "FR",
    name: "Union pour la démocratie française",
    abbreviation: "UDF",
    color: "#00AEEF",
    economicPosition: 3, // liberal / pro-market (Giscard, Barre)
    socialPosition: 0, // centrist, socially liberal-ish
    foreignPolicy: 1, // Atlanticist-leaning, European integration
    culture: 0,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1979-default", "1991-default"],
    regimeStatus: "approved",
    treasury: 800_000,
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
    countryId: "FR",
    name: "Parti socialiste",
    abbreviation: "PS",
    color: "#FF6699",
    economicPosition: -2, // social-democratic; nationalizations in the 1972 Programme commun
    socialPosition: -1,
    foreignPolicy: 0,
    culture: -1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1979-default", "1991-default"],
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
    seedOrder: 4,
    countryId: "FR",
    name: "Parti communiste français",
    abbreviation: "PCF",
    color: "#CC0000",
    economicPosition: -4, // Marxist; ~20% of the vote in the late 1970s
    socialPosition: -1,
    foreignPolicy: -2, // Moscow-aligned (Eurocommunism debated)
    culture: -1,
    memberCount: 0,
    isDefault: true,
    // PCF continuous from Fourth → Fifth Republic; also valid in 1953/1991.
    validForPresets: ["1953-default", "1979-default", "1991-default"],
    regimeStatus: "approved",
    treasury: 600_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  // ─── 1991 Fifth Republic addition ──────────────────────────────────────
  {
    // First entered the Assembly with 35 seats under 1986's one-off PR
    // ballot; kept as an extra-parliamentary but electorally major force
    // through the 1988 majoritarian election and into 1991-92.
    seedOrder: 5,
    countryId: "FR",
    name: "Front National",
    abbreviation: "FN",
    color: "#1A2E5A",
    economicPosition: 1, // protectionist-nationalist, not classically free-market
    socialPosition: 4,
    foreignPolicy: 2, // nationalist, anti-EC integration
    culture: 4,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1991-default"],
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

export default frParties;
