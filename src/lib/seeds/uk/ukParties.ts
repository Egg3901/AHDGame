import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * UK default political parties.
 *
 * Economic/social positions on -5 to +5 scale, calibrated to UK politics:
 *   Labour:    centre-left economically, progressive socially
 *   Tories:    centre-right economically, traditional socially
 *   Lib Dems:  centrist economically, socially liberal
 *   SNP:       centre-left, progressive but defined by independence
 *   Plaid:     centre-left, Welsh language/independence focused
 *   Greens:    far-left economically, very progressive socially
 *   Reform:    right-wing populist, very socially conservative
 *   DUP:       right-wing economically, very socially conservative (NI unionist)
 *   Sinn Féin: left-wing economically, progressive socially (NI nationalist/republican)
 *   Liberals:  historic Liberal Party (1953-only) — free-trade centrist third party
 *
 * Era gating (`validForPresets`): Lib Dems (1988), Greens (1990) and the DUP
 * (1971) don't exist in the 1953 preset; the historic Liberal Party exists
 * ONLY in 1953. Reform UK is 2019-only; UUP is 1991-only.
 *
 * These are seeded as `isDefault: true` for the UK — they always exist
 * and cannot be deleted (equivalent to Democrat/Republican in the US game).
 * seedOrder determines the sequentialId assignment order within the UK.
 */
export const ukParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "UK",
    name: "Labour Party",
    abbreviation: "LAB",
    color: "#E4003B",
    economicPosition: -2,
    socialPosition: -3,
    foreignPolicy: -1, // NATO-aligned but multilateral, EU-friendly post-Brexit re-engagement
    culture: -2, // multicultural, secular, pro-immigration
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
  },
  {
    seedOrder: 2,
    countryId: "UK",
    name: "Conservative Party",
    abbreviation: "CON",
    color: "#0087DC",
    economicPosition: 2,
    socialPosition: 2,
    foreignPolicy: 2, // Atlanticist, post-Brexit autonomy, defence-spending hawk
    culture: 2, // mild traditionalism, immigration-restrictive
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
  },
  {
    // Founded 1988 (SDP–Liberal merger) — anachronistic in 1953, where the
    // historic Liberal Party (seedOrder 11) stands in its place.
    seedOrder: 3,
    countryId: "UK",
    name: "Liberal Democrats",
    abbreviation: "LD",
    color: "#FAA61A",
    economicPosition: 0,
    socialPosition: -2,
    foreignPolicy: -1, // pro-EU re-join, multilateralist, NATO-supportive
    culture: -3, // cosmopolitan, pro-immigration, civil liberties
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
    seedOrder: 4,
    countryId: "UK",
    name: "Scottish National Party",
    abbreviation: "SNP",
    color: "#FFF95D",
    economicPosition: -2,
    socialPosition: -2,
    foreignPolicy: -2, // anti-Trident, EU-rejoin focus, peace-tradition
    culture: -2, // civic nationalist, pro-immigration, multicultural
    memberCount: 0,
    isDefault: true,
    treasury: 250_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 5,
    countryId: "UK",
    name: "Plaid Cymru",
    abbreviation: "PC",
    color: "#3F8428",
    economicPosition: -2,
    socialPosition: -2,
    foreignPolicy: -2, // anti-nuclear, EU-leaning, Welsh autonomy
    culture: -1, // Welsh civic nationalism, pro-language but inclusive
    memberCount: 0,
    isDefault: true,
    treasury: 250_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    // Green Party (England & Wales) took its current name in 1990 (PEOPLE /
    // Ecology Party from 1973) — no environmental party existed in 1953.
    seedOrder: 6,
    countryId: "UK",
    name: "Green Party",
    abbreviation: "GRN",
    color: "#02A95B",
    economicPosition: -4,
    socialPosition: -4,
    foreignPolicy: -3, // anti-war, NATO-skeptic, anti-arms-trade
    culture: -3, // multicultural, ecological, secular
    memberCount: 0,
    isDefault: true,
    treasury: 100_000,
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
    // 2019-only: Reform UK was founded in 2018-2019 (originally the Brexit
    // Party, renamed January 2021). Not a meaningful political force in
    // 1991 — Anti-Federalist League / Referendum Party era predecessors
    // were marginal single-issue groups, not stable party defaults.
    seedOrder: 7,
    countryId: "UK",
    name: "Reform UK",
    abbreviation: "RUK",
    color: "#12B6CF",
    economicPosition: 2,
    socialPosition: 4,
    foreignPolicy: 0, // anti-EU, NATO-ambivalent, anti-aid, transactional
    culture: 4, // anti-immigration, anti-woke, ethno-nationalist
    memberCount: 0,
    isDefault: true,
    treasury: 100_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["2019-default"],
  },
  {
    // Founded 1971 (Paisley) — in 1953 Northern Ireland unionism was the
    // Ulster Unionist bloc (represented via the Conservative whip; see
    // ukRegionPolling1951.ts NIR notes).
    seedOrder: 8,
    countryId: "UK",
    name: "Democratic Unionist Party",
    abbreviation: "DUP",
    color: "#D46A4C",
    economicPosition: 2,
    socialPosition: 4,
    foreignPolicy: 2, // pro-UK union, pro-NATO, transatlantic
    culture: 4, // Protestant traditionalism, anti-LGBT, anti-abortion
    memberCount: 0,
    isDefault: true,
    treasury: 250_000,
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
    seedOrder: 9,
    countryId: "UK",
    name: "Sinn Féin",
    abbreviation: "SF",
    color: "#326760",
    economicPosition: -3,
    socialPosition: -2,
    foreignPolicy: -2, // Irish neutrality tradition, anti-NATO, pro-Palestine
    culture: -1, // left-nationalist, civic Irish identity, increasingly progressive
    memberCount: 0,
    isDefault: true,
    treasury: 250_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    // 1991-only: UUP was the dominant unionist party in NI pre-1998. By
    // 2019 the DUP had overtaken them and the UUP held no Stormont
    // First Minister role, so the 2019 roster doesn't carry them.
    seedOrder: 10,
    countryId: "UK",
    name: "Ulster Unionist Party",
    abbreviation: "UUP",
    color: "#9999FF",
    economicPosition: 1,
    socialPosition: 2,
    foreignPolicy: 2, // pro-UK union, Atlanticist, NATO-aligned
    culture: 2, // moderate Protestant unionism, traditional but less hardline than DUP
    memberCount: 0,
    isDefault: true,
    treasury: 250_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1991-default"],
  },
  {
    // 1953-only: the historic Liberal Party — the third party of the early
    // 1950s, reduced to 6 seats and ~2.5% nationally at the 1951 GE, with
    // rural redoubts in Wales and the West Country. Free-trade centrist,
    // socially liberal for the era. Replaced as a default by the Liberal
    // Democrats (1988 merger) in later presets.
    seedOrder: 11,
    countryId: "UK",
    name: "Liberal Party",
    abbreviation: "LIB",
    color: "#FDBB30",
    economicPosition: 0, // free trade, anti-nationalisation but pro-welfare-state
    socialPosition: -1, // nonconformist-liberal, civil-liberties tradition
    foreignPolicy: -1, // internationalist, pro-UN, free-trade multilateralism
    culture: -1, // liberal for the era
    memberCount: 0,
    isDefault: true,
    treasury: 100_000, // tiny organization — near-bankrupt party of the early 50s
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1953-default"],
  },
];

export default ukParties;
