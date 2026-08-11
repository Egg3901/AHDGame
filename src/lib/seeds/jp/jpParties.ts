import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Japan default political parties.
 *
 * Economic/social positions on -5 to +5 scale, calibrated to Japanese politics:
 *   LDP:      centre-right economically, socially conservative (dominant ruling party)
 *   CDP:      centre-left economically, progressive socially (main opposition; 2019-only)
 *   Komeito:  centrist economically and socially (LDP coalition partner, Soka Gakkai)
 *   JCP:      far-left economically, progressive socially
 *   Ishin:    right-leaning economically (neoliberal reform), mildly conservative socially (2019-only)
 *   DPFP:     centrist economically, mildly progressive socially (reformist centre; 2019-only)
 *   RYO:      Liberal Party / Jiyūtō — Yoshida's ruling conservatives in 1953
 *   JDP:      Japan Democratic Party / Hatoyama-Progressive lineage — 1953 opposition
 *   JSP:      left-economically, progressive socially (1953 + 1991 — main opposition pre-1996)
 *   DSP:      centrist economically, mildly conservative socially (1991-only — Sōhyō-aligned)
 *
 * seedOrder determines the sequentialId assignment order within JP.
 * Abbreviations must match party IDs used in getMajorPartiesForRegion and majorPartyIds.
 */
export const jpParties: PartySeed[] = [
  // ─── 1953 pre-LDP merger ───────────────────────────────────────────────
  {
    // Yoshida's Liberal Party (Jiyūtō) — ruling conservatives until the
    // Nov 1955 Liberal + Democratic merger that created the LDP.
    seedOrder: 20,
    countryId: "JP",
    name: "Liberal Party",
    abbreviation: "RYO",
    color: "#2BA547",
    economicPosition: 2,
    socialPosition: 2,
    foreignPolicy: 2, // San Francisco system; US alliance; rearmament cautious
    culture: 2,
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
    validForPresets: ["1953-default"],
  },
  {
    // Hatoyama / Progressive (Kaishintō) lineage — the other conservative
    // pole that becomes Japan Democratic Party (1954) then merges into LDP.
    seedOrder: 21,
    countryId: "JP",
    name: "Japan Democratic Party",
    abbreviation: "JDP",
    color: "#1B6B3A",
    economicPosition: 1,
    socialPosition: 2,
    foreignPolicy: 1, // more revisionist on US occupation settlement than Yoshida
    culture: 2,
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
    validForPresets: ["1953-default"],
  },
  {
    // Founded Nov 1955 via Liberal + Democratic merger — not present in 1953.
    seedOrder: 1,
    countryId: "JP",
    name: "Liberal Democratic Party",
    abbreviation: "LDP",
    color: "#2BA547",
    economicPosition: 2,
    socialPosition: 2,
    foreignPolicy: 2, // US alliance, SDF expansion, China-hawkish, Article-9 revisionist
    culture: 3, // traditional Japanese values, conservative on family / immigration
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
    // 2019-only: CDP was founded in 2017. The pre-2017 centre-left
    // opposition lineage is JSP (1945-1996) → DPJ (1998-2016) →
    // CDP+DPFP+others. For 1991 the main opposition is JSP (seedOrder 7).
    seedOrder: 2,
    countryId: "JP",
    name: "Constitutional Democratic Party",
    abbreviation: "CDP",
    color: "#1E4D8C",
    economicPosition: -2,
    socialPosition: -2,
    foreignPolicy: 0, // US alliance acceptable but pacifist-leaning, anti-Article-9-revision
    culture: -1, // progressive on gender / LGBT / selective dual nationality
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
    validForPresets: ["2019-default", "2023-default"],
  },
  {
    // Founded 1964 — not present in 1953.
    seedOrder: 3,
    countryId: "JP",
    name: "Komeito",
    abbreviation: "KMT",
    color: "#F5A623",
    economicPosition: 0,
    socialPosition: 0,
    foreignPolicy: -1, // Buddhist pacifist tradition; in coalition tempers LDP defence push
    culture: 0, // moderate, faith-based but inclusive
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
    countryId: "JP",
    name: "Japanese Communist Party",
    abbreviation: "JCP",
    color: "#D71920",
    economicPosition: -4,
    socialPosition: -3,
    foreignPolicy: -4, // strict Article-9 defenders, anti-US-bases, anti-alliance
    culture: -2, // left-progressive on gender / LGBT / immigration
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
    // 2019-only: Nippon Ishin no Kai was founded in 2010 by Toru
    // Hashimoto. No real 1991 analogue; the Kansai-regionalist niche
    // didn't exist in that form in the LDP-dominant era.
    seedOrder: 5,
    countryId: "JP",
    name: "Nippon Ishin no Kai",
    abbreviation: "ISH",
    color: "#39B54A",
    economicPosition: 3,
    socialPosition: 1,
    foreignPolicy: 2, // pro-Article-9-revision, defence-build-up, US-alliance-supportive
    culture: 1, // reformist but right-leaning on national identity
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
    // 2019-only: DPFP was founded in 2018. The 1991-era centrist /
    // Sōhyō-aligned union-affiliated party is DSP (seedOrder 8).
    seedOrder: 6,
    countryId: "JP",
    name: "Democratic Party for the People",
    abbreviation: "DPFP",
    color: "#FF6B00",
    economicPosition: 0,
    socialPosition: -1,
    foreignPolicy: 1, // pragmatic alliance-supportive, security-realist
    culture: 0, // centrist, mildly progressive on social issues
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
    // Japan Socialist Party (JSP / 日本社会党) — main opposition from
    // occupation through mid-1990s. Valid in 1953 (pre-LDP system) and
    // 1991 (last years before SDPJ/DPJ succession). Held 136 Shugiin
    // seats after the 1990 general election.
    seedOrder: 7,
    countryId: "JP",
    name: "Japan Socialist Party",
    abbreviation: "JSP",
    color: "#C8102E",
    economicPosition: -3,
    socialPosition: -2,
    foreignPolicy: -3, // pacifist tradition, anti-Article-9-revision, anti-US-bases
    culture: -2, // union-aligned progressive, secular
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
    validForPresets: ["1953-default", "1991-default"],
  },
  {
    // 1991-only: Democratic Socialist Party (DSP / 民社党), 1960-1994.
    // Centrist union-aligned (Dōmei labour federation), broke from JSP
    // over US-alliance acceptance. Merged into the New Frontier Party
    // (NFP) in 1994. Held 14 Shugiin seats after the 1990 election.
    seedOrder: 8,
    countryId: "JP",
    name: "Democratic Socialist Party",
    abbreviation: "DSP",
    color: "#0E5FAA",
    economicPosition: -1,
    socialPosition: -1,
    foreignPolicy: 1, // pro-US-alliance moderate, social-democratic-Atlanticist
    culture: 0, // moderate union-aligned, less radical than JSP on cultural issues
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
