import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Greece default political parties.
 *
 *  - 1953: Ellinikos Synagermos (Papagos, governing since Nov 1952) + EPEK
 *    (centrist) + EDA (the legal front of the banned communist left).
 *  - 1979: ND (Karamanlis, governing) + PASOK (Papandreou, surging) + KKE
 *    (legalised 1974).
 *  - 1991: same three-party core still governing the April 1990-formed
 *    Mitsotakis (ND) parliament. KKE ran the Nov 1989/Apr 1990 elections in
 *    the broader Synaspismos left coalition, but its own registration
 *    persisted throughout, so it is kept as the seeded entity.
 *
 * Positions -5..+5. Each entry is gated via `validForPresets`.
 */
export const grParties: PartySeed[] = [
  // ─── 1979 Third Republic (continuous into 1991) ────────────────────────
  {
    seedOrder: 1,
    countryId: "GR",
    name: "Nea Dimokratia",
    abbreviation: "ND",
    color: "#1268C3",
    economicPosition: 2, // liberal-conservative, EEC accession course
    socialPosition: 1,
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
    countryId: "GR",
    name: "Panellinio Sosialistiko Kinima",
    abbreviation: "PASOK",
    color: "#009A44",
    economicPosition: -3, // socialist "Allagi" programme
    socialPosition: -1,
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
    seedOrder: 3,
    countryId: "GR",
    name: "Kommounistiko Komma Elladas",
    abbreviation: "KKE",
    color: "#D50000",
    economicPosition: -5,
    socialPosition: -2,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1979-default", "1991-default"],
    regimeStatus: "approved",
    treasury: 400_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  // ─── 1953 kingdom ──────────────────────────────────────────────────────
  {
    seedOrder: 10,
    countryId: "GR",
    name: "Ellinikos Synagermos",
    abbreviation: "ES",
    color: "#123A6B",
    economicPosition: 2, // Markezinis stabilisation, pro-investment
    socialPosition: 2, // royalist, anti-communist order
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
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
    seedOrder: 11,
    countryId: "GR",
    name: "Ethniki Proodeftiki Enosis Kentrou",
    abbreviation: "EPEK",
    color: "#2E7D32",
    economicPosition: -1, // Plastiras centrism, reconciliation platform
    socialPosition: 0,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default"],
    regimeStatus: "approved",
    treasury: 550_000,
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
    countryId: "GR",
    name: "Eniaia Dimokratiki Aristera",
    abbreviation: "EDA",
    color: "#C62828",
    economicPosition: -4, // legal front of the banned KKE
    socialPosition: -2,
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
];

export default grParties;
