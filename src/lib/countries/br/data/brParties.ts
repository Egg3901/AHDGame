import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Brazil default political parties.
 *
 * Preset rosters:
 *   - 1953-default: PSD (Vargas-era 1945 party) / UDN / PTB — Second Republic.
 *   - 2019-default: PT / PL / MDB / UNIÃO / PSD — the modern post-2018 landscape.
 *   - 1991-default: PMDB / PFL / PDT / PDS / PTB / PRN / PSB / PCDOB + PT / PSD
 *     — the 1990-91 Câmara composition. PMDB was the dominant catch-all centrist
 *     party, PFL the post-Sarney conservatives, PDT the Brizolista labourists,
 *     PDS the ARENA successor, PRN was Collor's 1989 vehicle, PT the workers'
 *     party (then ~6% but rising), PSB the democratic socialists, PCdoB the
 *     Communist Party of Brazil. PT and modern PSD straddle 1979/1991/2019.
 *
 * Seeded as `isDefault: true` — they always exist and cannot be deleted.
 * seedOrder determines sequentialId assignment within BR.
 */
export const brParties: PartySeed[] = [
  // ─── 1953 Vargas-era Second Republic ───────────────────────────────────
  {
    // Historical PSD (1945–1965), NOT the modern 2011 PSD (seedOrder 5).
    seedOrder: 20,
    countryId: "BR",
    name: "Partido Social Democrático",
    abbreviation: "PSD",
    color: "#007A32",
    economicPosition: 0, // Vargas catch-all; rural bosses + industrialists
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    treasury: 1_200_000,
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
    seedOrder: 21,
    countryId: "BR",
    name: "União Democrática Nacional",
    abbreviation: "UDN",
    color: "#003399",
    economicPosition: 2, // anti-Vargas liberals; urban middle class
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    treasury: 900_000,
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
    // Vargas labourist PTB (1945–1965). Distinct era entry from the
    // 1991 PTB revival (seedOrder 14) which shares the abbreviation.
    seedOrder: 22,
    countryId: "BR",
    name: "Partido Trabalhista Brasileiro",
    abbreviation: "PTB",
    color: "#00A859",
    economicPosition: -2, // labourist / Getulista working-class base
    socialPosition: 0,
    memberCount: 0,
    isDefault: true,
    treasury: 800_000,
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
    // Founded 1980 — not present in 1953. Kept on 1979+ so Cold-War BR
    // continue to see the workers' party that later dominates 1991/2019.
    seedOrder: 1,
    countryId: "BR",
    name: "Partido dos Trabalhadores",
    abbreviation: "PT",
    color: "#EE2027",
    economicPosition: -3,
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
    validForPresets: ["1979-default", "1991-default", "2019-default"],
  },
  {
    // 2019-only: PL in its post-2006 incarnation is Bolsonaro's vehicle.
    // The 1991-era PL existed but was a small free-market party with
    // entirely different positioning; the 1991 roster lists no PL.
    seedOrder: 2,
    countryId: "BR",
    name: "Partido Liberal",
    abbreviation: "PL",
    color: "#004A99",
    economicPosition: 2,
    socialPosition: 3,
    memberCount: 0,
    isDefault: true,
    treasury: 1_200_000,
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
    // 2019-only: MDB is the rump that survived after PMDB shed the "P"
    // in 2017. For 1991 the equivalent is PMDB (seedOrder 10).
    seedOrder: 3,
    countryId: "BR",
    name: "MDB",
    abbreviation: "MDB",
    color: "#36A9E0",
    economicPosition: 0,
    socialPosition: 0,
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
    validForPresets: ["2019-default"],
  },
  {
    // 2019-only: União Brasil is the 2022 DEM+PSL merger. No 1991 analogue.
    seedOrder: 4,
    countryId: "BR",
    name: "União Brasil",
    abbreviation: "UNIÃO",
    color: "#003399",
    economicPosition: 1,
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    treasury: 900_000,
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
    // Modern PSD founded 2011 — not the Vargas-era PSD. Keep off 1953;
    // 1953 gets a separate historical PSD entry.
    seedOrder: 5,
    countryId: "BR",
    name: "PSD",
    abbreviation: "PSD",
    color: "#007A32",
    economicPosition: 1,
    socialPosition: 0,
    memberCount: 0,
    isDefault: true,
    treasury: 800_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1979-default", "1991-default", "2019-default"],
  },
  // ─── 1991-only defaults ────────────────────────────────────────────────
  {
    // 1991-only: PMDB was the dominant catch-all centrist party 1980-2017,
    // descending from the MDB tolerated-opposition of the military era.
    // 109 Câmara seats after the 1990 election. Dropped the "P" in 2017
    // (see MDB, seedOrder 3).
    seedOrder: 10,
    countryId: "BR",
    name: "Partido do Movimento Democrático Brasileiro",
    abbreviation: "PMDB",
    color: "#36A9E0",
    economicPosition: 0,
    socialPosition: 0,
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
    validForPresets: ["1991-default"],
  },
  {
    // 1991-only: PFL (Partido da Frente Liberal), 1985-2007. Sarney's
    // post-ARENA conservative party; held the second-largest Câmara
    // bloc in 1991 (84 seats). Renamed Democratas (DEM) in 2007, which
    // later merged into União Brasil.
    seedOrder: 11,
    countryId: "BR",
    name: "Partido da Frente Liberal",
    abbreviation: "PFL",
    color: "#FF8C00",
    economicPosition: 2,
    socialPosition: 2,
    memberCount: 0,
    isDefault: true,
    treasury: 1_200_000,
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
    // 1991-only: PDT (Partido Democrático Trabalhista). Leonel Brizola's
    // labourist/social-democratic party, founded 1980; 46 Câmara seats
    // in 1991. Still active in 2025 but much smaller.
    seedOrder: 12,
    countryId: "BR",
    name: "Partido Democrático Trabalhista",
    abbreviation: "PDT",
    color: "#FF1744",
    economicPosition: -2,
    socialPosition: -1,
    memberCount: 0,
    isDefault: true,
    treasury: 700_000,
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
    // 1991-only: PDS (Partido Democrático Social), 1980-1993. ARENA
    // successor / military-era right; 42 Câmara seats in 1991. Merged
    // with PDC to form PPR in 1993, ultimately becoming Progressistas.
    seedOrder: 13,
    countryId: "BR",
    name: "Partido Democrático Social",
    abbreviation: "PDS",
    color: "#005AA7",
    economicPosition: 2,
    socialPosition: 3,
    memberCount: 0,
    isDefault: true,
    treasury: 700_000,
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
    // 1991-only: PTB (Partido Trabalhista Brasileiro), Vargas-tradition
    // labourist (centre-right by 1991). 38 Câmara seats. Active in
    // modern Brazil too, but extremely diminished.
    seedOrder: 14,
    countryId: "BR",
    name: "Partido Trabalhista Brasileiro",
    abbreviation: "PTB",
    color: "#00A859",
    economicPosition: 1,
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    treasury: 600_000,
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
    // 1991-only: PRN (Partido da Reconstrução Nacional). Fernando
    // Collor's 1989 presidential vehicle; held 40 Câmara seats after
    // 1990. Disintegrated post-impeachment; renamed PTC in 2000.
    seedOrder: 15,
    countryId: "BR",
    name: "Partido da Reconstrução Nacional",
    abbreviation: "PRN",
    color: "#FFCC00",
    economicPosition: 1,
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    treasury: 600_000,
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
    // 1991-only: PSB (Partido Socialista Brasileiro), democratic-
    // socialist, ~11 Câmara seats in 1991. Still active.
    seedOrder: 16,
    countryId: "BR",
    name: "Partido Socialista Brasileiro",
    abbreviation: "PSB",
    color: "#FFD200",
    economicPosition: -2,
    socialPosition: -2,
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
  {
    // 1991-only: PCdoB (Partido Comunista do Brasil). Maoist-origin
    // communist party; 5 Câmara seats in 1991. Still active in 2025,
    // typically in PT-led alliances.
    seedOrder: 17,
    countryId: "BR",
    name: "Partido Comunista do Brasil",
    abbreviation: "PCDOB",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: -2,
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
    validForPresets: ["1991-default"],
  },
];
