/**
 * Curated Registration / Org bootstrap seed values for the 1991-default
 * preset. Mirrors the structure of `registrationLanes.ts` but anchored to
 * 1988-92 election baselines:
 *
 *   - US: 1988 presidential + 1990 midterm + state-level partisanship
 *     (Solid Democratic South still in place; the Reagan / Bush coalition
 *     hadn't fully realigned the South yet — many Southern states were
 *     "Solid D" by registration even as they voted Republican at the
 *     federal level). DC is seeded as strong-D (1988 Dukakis 82.7%).
 *   - UK: 1992 general election by region (Major's Tory win, Labour
 *     opposition; SDP + Liberals merged into LD in 1988 so LD is
 *     historically accurate; no Reform / Brexit Party). Region IDs match
 *     `ukRegions.ts` (LON/SEE/SWE/EAE/EMI/WMI/YHU/NWE/NEE/SCO/WAL/NIR).
 *   - DE: 1990 federal election (first post-reunification ballot — CDU/CSU
 *     43.8 / SPD 33.5 / FDP 11.0 / Greens-B90 5.1 / PDS 2.4; PDS strong in
 *     the new East-German Länder). Uses the 1991-only `PDS` default
 *     directly; no modern Die-Linke proxy.
 *   - JP: 1990 lower-house election (LDP 46 / JSP 24 / Komeito 8 / JCP 8 /
 *     DSP 5). Uses the 1991-only `JSP` and `DSP` defaults directly. Region
 *     IDs match `jpRegions.ts` (HOK/TOH/KAN/CHU/KNS/CGK/SHI/KYU).
 *   - BR: 1990 Câmara dos Deputados elections by macro-region. Uses
 *     1991-only PMDB/PFL/PDT/PDS/PTB/PRN/PSB/PCDOB defaults plus the
 *     surviving PT and PSD. Sinn-Fein-style "br_other" rolls to
 *     unaffiliated.
 *   - IE: 1989 Dáil election by region. Uses 1991-only WP (Workers'
 *     Party) and PD (Progressive Democrats) defaults plus FF/FG/LAB.
 *     Green Party had no Dáil presence in 1991 (single seat in Dublin
 *     South only); rolled to unaffiliated.
 *
 * `AFD` (founded 2013) and `RUK` (founded 2018) are not seeded.
 *
 * Curated by historical election results 2026-05; intended as a
 * playable first pass rather than fully precise per-state data. Refine
 * via per-state overrides when needed.
 */

import type { StateRegistrationSeed } from "./registrationLanes";

// ─── US lane templates (1988 prez + 1990 midterm baseline) ──────────────────

const US_LANES_1991 = {
  strongD: {
    parties: [
      { abbr: "DEM", org: 35, reg: 50 },
      { abbr: "REP", org: 22, reg: 22 },
    ],
    independent: 20,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  solidD: {
    parties: [
      { abbr: "DEM", org: 32, reg: 45 },
      { abbr: "REP", org: 25, reg: 27 },
    ],
    independent: 20,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  leanD: {
    parties: [
      { abbr: "DEM", org: 29, reg: 40 },
      { abbr: "REP", org: 28, reg: 32 },
    ],
    independent: 20,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  leanR: {
    parties: [
      { abbr: "DEM", org: 27, reg: 33 },
      { abbr: "REP", org: 30, reg: 40 },
    ],
    independent: 19,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  solidR: {
    parties: [
      { abbr: "DEM", org: 24, reg: 28 },
      { abbr: "REP", org: 33, reg: 46 },
    ],
    independent: 18,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  strongR: {
    parties: [
      { abbr: "DEM", org: 22, reg: 22 },
      { abbr: "REP", org: 35, reg: 52 },
    ],
    independent: 18,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
} as const;

/**
 * 1991 US state assignments. Reflects the pre-realignment South still
 * being Solid-D by registration; Mountain West / Plains being Solid-R;
 * California / Florida still genuinely competitive in early 1990s.
 * DC included as strong-D (1988 Dukakis 82.7%).
 */
const US_ASSIGNMENTS_1991: Record<keyof typeof US_LANES_1991, string[]> = {
  // Dukakis-leaning + state-level safe-D + Solid-South-by-registration + DC
  strongD: ["HI", "RI", "MA", "AR", "WV", "MN", "DC"],
  solidD: ["NY", "MD", "DE", "CT", "IA", "WA", "OR", "IL", "WI", "KY", "TN", "GA"],
  leanD: ["NJ", "CA", "PA", "MI", "OH", "MO", "NM", "LA", "MS", "AL"],
  leanR: ["VT", "ME", "NH", "IN", "FL", "TX", "NC", "OK", "SC", "VA"],
  solidR: ["MT", "ND", "SD", "NE", "KS", "AZ", "NV", "CO"],
  strongR: ["WY", "UT", "ID", "AK"],
};

function buildUSSeeds1991(): StateRegistrationSeed[] {
  const rows: StateRegistrationSeed[] = [];
  for (const lane of Object.keys(US_LANES_1991) as Array<keyof typeof US_LANES_1991>) {
    const template = US_LANES_1991[lane];
    for (const stateId of US_ASSIGNMENTS_1991[lane]) {
      rows.push({
        countryId: "US",
        stateId,
        parties: [...template.parties],
        independent: template.independent,
        unregistered: template.unregistered,
        unaffiliatedOrg: template.unaffiliatedOrg,
      });
    }
  }
  return rows;
}

// ─── UK 1992 general election (per region) ──────────────────────────────────
// Vote shares from the April 1992 GE rolled to the game's 12-region map.
// LAB = Labour, CON = Conservative, LD = Liberal Democrats (post-merger).
// Northern Ireland uses its own dynamics; DUP/SF (game seed) approximate
// the UUP-DUP / SDLP-SF poles.

const UK_SEEDS_1991: Omit<StateRegistrationSeed, "countryId">[] = [
  {
    stateId: "LON",
    parties: [
      { abbr: "LAB", org: 33, reg: 41 },
      { abbr: "CON", org: 27, reg: 36 },
      { abbr: "LD", org: 9, reg: 12 },
    ],
    independent: 5,
    unregistered: 6,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "SEE",
    parties: [
      { abbr: "CON", org: 41, reg: 54 },
      { abbr: "LAB", org: 15, reg: 21 },
      { abbr: "LD", org: 13, reg: 18 },
    ],
    independent: 3,
    unregistered: 4,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "SWE",
    parties: [
      { abbr: "CON", org: 38, reg: 48 },
      { abbr: "LD", org: 17, reg: 23 },
      { abbr: "LAB", org: 14, reg: 21 },
    ],
    independent: 3,
    unregistered: 5,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "EAE",
    parties: [
      { abbr: "CON", org: 41, reg: 51 },
      { abbr: "LAB", org: 17, reg: 25 },
      { abbr: "LD", org: 11, reg: 17 },
    ],
    independent: 3,
    unregistered: 4,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "EMI",
    parties: [
      { abbr: "CON", org: 36, reg: 46 },
      { abbr: "LAB", org: 24, reg: 34 },
      { abbr: "LD", org: 9, reg: 13 },
    ],
    independent: 3,
    unregistered: 4,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "WMI",
    parties: [
      { abbr: "CON", org: 34, reg: 45 },
      { abbr: "LAB", org: 28, reg: 38 },
      { abbr: "LD", org: 9, reg: 11 },
    ],
    independent: 2,
    unregistered: 4,
    unaffiliatedOrg: 29,
  },
  {
    stateId: "NWE",
    parties: [
      { abbr: "LAB", org: 33, reg: 45 },
      { abbr: "CON", org: 26, reg: 35 },
      { abbr: "LD", org: 11, reg: 14 },
    ],
    independent: 2,
    unregistered: 4,
    unaffiliatedOrg: 30,
  },
  {
    stateId: "NEE",
    parties: [
      { abbr: "LAB", org: 39, reg: 55 },
      { abbr: "CON", org: 21, reg: 28 },
      { abbr: "LD", org: 9, reg: 12 },
    ],
    independent: 1,
    unregistered: 4,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "YHU",
    parties: [
      { abbr: "LAB", org: 33, reg: 45 },
      { abbr: "CON", org: 25, reg: 34 },
      { abbr: "LD", org: 11, reg: 16 },
    ],
    independent: 1,
    unregistered: 4,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "WAL",
    parties: [
      { abbr: "LAB", org: 36, reg: 49 },
      { abbr: "CON", org: 21, reg: 29 },
      { abbr: "LD", org: 9, reg: 12 },
      { abbr: "PC", org: 5, reg: 6 },
    ],
    independent: 0,
    unregistered: 4,
    unaffiliatedOrg: 29,
  },
  {
    stateId: "SCO",
    parties: [
      { abbr: "LAB", org: 33, reg: 39 },
      { abbr: "CON", org: 19, reg: 26 },
      { abbr: "SNP", org: 14, reg: 21 },
      { abbr: "LD", org: 9, reg: 13 },
    ],
    independent: 0,
    unregistered: 1,
    unaffiliatedOrg: 25,
  },
  {
    stateId: "NIR",
    parties: [
      { abbr: "DUP", org: 28, reg: 38 },
      { abbr: "SF", org: 12, reg: 16 },
    ],
    // Independent is high here because the game seed doesn't include
    // UUP or SDLP — the dominant 1992 NI parties — so a large slice of
    // the electorate maps to the "non-party" buckets.
    independent: 27,
    unregistered: 19,
    unaffiliatedOrg: 60,
  },
];

// ─── DE 1990 federal election (per Land) ────────────────────────────────────
// First post-reunification election. CDU/CSU 43.8 / SPD 33.5 / FDP 11.0 /
// Greens-B90 5.1 / PDS 2.4 nationally. Eastern Länder (BB, MV, SN, ST,
// TH) plus Berlin show meaningful PDS share via the 1991-only PDS default.
// CSU only contests Bayern; CDU contests all other Länder.

const DE_SEEDS_1991: Omit<StateRegistrationSeed, "countryId">[] = [
  {
    stateId: "BW",
    parties: [
      { abbr: "CDU", org: 38, reg: 47 },
      { abbr: "SPD", org: 23, reg: 29 },
      { abbr: "FDP", org: 9, reg: 12 },
      { abbr: "GRN", org: 6, reg: 7 },
    ],
    independent: 2,
    unregistered: 3,
    unaffiliatedOrg: 24,
  },
  {
    stateId: "BY",
    parties: [
      { abbr: "CSU", org: 41, reg: 52 },
      { abbr: "SPD", org: 21, reg: 27 },
      { abbr: "FDP", org: 6, reg: 8 },
      { abbr: "GRN", org: 5, reg: 6 },
    ],
    independent: 2,
    unregistered: 5,
    unaffiliatedOrg: 27,
  },
  {
    stateId: "BE",
    parties: [
      { abbr: "CDU", org: 28, reg: 36 },
      { abbr: "SPD", org: 26, reg: 33 },
      { abbr: "PDS", org: 9, reg: 12 },
      { abbr: "FDP", org: 7, reg: 8 },
      { abbr: "GRN", org: 6, reg: 7 },
    ],
    independent: 1,
    unregistered: 3,
    unaffiliatedOrg: 24,
  },
  {
    stateId: "BB",
    parties: [
      { abbr: "SPD", org: 27, reg: 35 },
      { abbr: "CDU", org: 24, reg: 30 },
      { abbr: "PDS", org: 14, reg: 18 },
      { abbr: "FDP", org: 7, reg: 9 },
    ],
    independent: 2,
    unregistered: 6,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "BRE",
    parties: [
      { abbr: "SPD", org: 35, reg: 45 },
      { abbr: "CDU", org: 22, reg: 28 },
      { abbr: "GRN", org: 8, reg: 10 },
      { abbr: "FDP", org: 7, reg: 9 },
    ],
    independent: 2,
    unregistered: 6,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "HH",
    parties: [
      { abbr: "SPD", org: 33, reg: 42 },
      { abbr: "CDU", org: 25, reg: 32 },
      { abbr: "GRN", org: 7, reg: 9 },
      { abbr: "FDP", org: 7, reg: 9 },
    ],
    independent: 2,
    unregistered: 6,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "HE",
    parties: [
      { abbr: "CDU", org: 31, reg: 41 },
      { abbr: "SPD", org: 28, reg: 36 },
      { abbr: "FDP", org: 8, reg: 10 },
      { abbr: "GRN", org: 6, reg: 7 },
    ],
    independent: 1,
    unregistered: 5,
    unaffiliatedOrg: 27,
  },
  {
    stateId: "MV",
    parties: [
      { abbr: "CDU", org: 28, reg: 36 },
      { abbr: "SPD", org: 22, reg: 27 },
      { abbr: "PDS", org: 14, reg: 19 },
      { abbr: "FDP", org: 7, reg: 9 },
    ],
    independent: 2,
    unregistered: 7,
    unaffiliatedOrg: 29,
  },
  {
    stateId: "NI",
    parties: [
      { abbr: "SPD", org: 31, reg: 40 },
      { abbr: "CDU", org: 28, reg: 36 },
      { abbr: "FDP", org: 8, reg: 10 },
      { abbr: "GRN", org: 5, reg: 6 },
    ],
    independent: 1,
    unregistered: 7,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "NW",
    parties: [
      { abbr: "SPD", org: 33, reg: 42 },
      { abbr: "CDU", org: 28, reg: 36 },
      { abbr: "FDP", org: 8, reg: 10 },
      { abbr: "GRN", org: 5, reg: 5 },
    ],
    independent: 1,
    unregistered: 6,
    unaffiliatedOrg: 26,
  },
  {
    stateId: "RP",
    parties: [
      { abbr: "CDU", org: 32, reg: 42 },
      { abbr: "SPD", org: 27, reg: 34 },
      { abbr: "FDP", org: 9, reg: 11 },
      { abbr: "GRN", org: 5, reg: 6 },
    ],
    independent: 1,
    unregistered: 6,
    unaffiliatedOrg: 27,
  },
  {
    stateId: "SL",
    parties: [
      { abbr: "SPD", org: 31, reg: 40 },
      { abbr: "CDU", org: 30, reg: 38 },
      { abbr: "FDP", org: 7, reg: 9 },
      { abbr: "GRN", org: 4, reg: 5 },
    ],
    independent: 1,
    unregistered: 7,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "SN",
    parties: [
      { abbr: "CDU", org: 33, reg: 43 },
      { abbr: "SPD", org: 18, reg: 22 },
      { abbr: "PDS", org: 13, reg: 17 },
      { abbr: "FDP", org: 9, reg: 11 },
    ],
    independent: 1,
    unregistered: 6,
    unaffiliatedOrg: 27,
  },
  {
    stateId: "ST",
    parties: [
      { abbr: "CDU", org: 30, reg: 38 },
      { abbr: "SPD", org: 23, reg: 28 },
      { abbr: "PDS", org: 12, reg: 16 },
      { abbr: "FDP", org: 9, reg: 10 },
    ],
    independent: 1,
    unregistered: 7,
    unaffiliatedOrg: 26,
  },
  {
    stateId: "SH",
    parties: [
      { abbr: "SPD", org: 30, reg: 40 },
      { abbr: "CDU", org: 29, reg: 37 },
      { abbr: "FDP", org: 8, reg: 10 },
      { abbr: "GRN", org: 5, reg: 7 },
    ],
    independent: 1,
    unregistered: 5,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "TH",
    parties: [
      { abbr: "CDU", org: 31, reg: 40 },
      { abbr: "SPD", org: 22, reg: 27 },
      { abbr: "PDS", org: 13, reg: 17 },
      { abbr: "FDP", org: 8, reg: 10 },
    ],
    independent: 1,
    unregistered: 5,
    unaffiliatedOrg: 26,
  },
];

// ─── JP 1990 lower-house election (per game region) ─────────────────────────
// LDP dominant nationally (46.1%), JSP main opposition (24.4%), Komeito 8%,
// JCP 8%, DSP ~5%. Modern abbreviations proxy the historical parties:
// 1991 file uses the JSP/DSP defaults directly (gated via `validForPresets:
// ["1991-default"]` in jpParties.ts), not the 2019-only CDP/DPFP proxies.
// KMT = Komeito (continuous), JCP = JCP (continuous). No ISH in 1991.

const JP_SEEDS_1991: Omit<StateRegistrationSeed, "countryId">[] = [
  {
    stateId: "HOK", // Hokkaido — JSP strong, LDP weaker than national avg
    parties: [
      { abbr: "LDP", org: 30, reg: 39 },
      { abbr: "JSP", org: 24, reg: 32 },
      { abbr: "KMT", org: 6, reg: 8 },
      { abbr: "JCP", org: 7, reg: 9 },
      { abbr: "DSP", org: 3, reg: 5 },
    ],
    independent: 0,
    unregistered: 7,
    unaffiliatedOrg: 30,
  },
  {
    stateId: "TOH", // Tohoku — rural, LDP heartland
    parties: [
      { abbr: "LDP", org: 39, reg: 51 },
      { abbr: "JSP", org: 16, reg: 21 },
      { abbr: "KMT", org: 5, reg: 6 },
      { abbr: "JCP", org: 5, reg: 6 },
      { abbr: "DSP", org: 3, reg: 4 },
    ],
    independent: 0,
    unregistered: 12,
    unaffiliatedOrg: 32,
  },
  {
    stateId: "KAN", // Kanto (incl. Tokyo) — urban, JSP/Komeito stronger
    parties: [
      { abbr: "LDP", org: 28, reg: 38 },
      { abbr: "JSP", org: 21, reg: 28 },
      { abbr: "KMT", org: 9, reg: 12 },
      { abbr: "JCP", org: 9, reg: 11 },
      { abbr: "DSP", org: 4, reg: 6 },
    ],
    independent: 0,
    unregistered: 5,
    unaffiliatedOrg: 29,
  },
  {
    stateId: "CHU", // Chubu — mixed, slight LDP edge (region _id "CHU" = Chubu)
    parties: [
      { abbr: "LDP", org: 34, reg: 44 },
      { abbr: "JSP", org: 19, reg: 25 },
      { abbr: "KMT", org: 7, reg: 9 },
      { abbr: "JCP", org: 6, reg: 8 },
      { abbr: "DSP", org: 4, reg: 6 },
    ],
    independent: 0,
    unregistered: 8,
    unaffiliatedOrg: 30,
  },
  {
    stateId: "KNS", // Kansai — Osaka-led, Komeito/Communist strong (region _id "KNS")
    parties: [
      { abbr: "LDP", org: 27, reg: 36 },
      { abbr: "JSP", org: 19, reg: 25 },
      { abbr: "KMT", org: 11, reg: 14 },
      { abbr: "JCP", org: 10, reg: 13 },
      { abbr: "DSP", org: 5, reg: 6 },
    ],
    independent: 0,
    unregistered: 6,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "CGK", // Chugoku — rural, LDP very dominant (region _id "CGK")
    parties: [
      { abbr: "LDP", org: 41, reg: 53 },
      { abbr: "JSP", org: 15, reg: 19 },
      { abbr: "KMT", org: 5, reg: 7 },
      { abbr: "JCP", org: 4, reg: 6 },
      { abbr: "DSP", org: 3, reg: 4 },
    ],
    independent: 0,
    unregistered: 11,
    unaffiliatedOrg: 32,
  },
  {
    stateId: "SHI", // Shikoku — LDP dominant
    parties: [
      { abbr: "LDP", org: 39, reg: 51 },
      { abbr: "JSP", org: 17, reg: 22 },
      { abbr: "KMT", org: 5, reg: 7 },
      { abbr: "JCP", org: 4, reg: 5 },
      { abbr: "DSP", org: 3, reg: 4 },
    ],
    independent: 0,
    unregistered: 11,
    unaffiliatedOrg: 32,
  },
  {
    stateId: "KYU", // Kyushu/Okinawa — LDP strong, Komeito presence in cities
    parties: [
      { abbr: "LDP", org: 36, reg: 47 },
      { abbr: "JSP", org: 18, reg: 23 },
      { abbr: "KMT", org: 6, reg: 8 },
      { abbr: "JCP", org: 5, reg: 7 },
      { abbr: "DSP", org: 3, reg: 5 },
    ],
    independent: 0,
    unregistered: 10,
    unaffiliatedOrg: 32,
  },
];

// ─── BR 1990 Câmara dos Deputados (per macro-region) ────────────────────────
// 1990 Câmara elections. PMDB 109 / PFL 84 / PDT 46 / PDS 42 / PRN 40 / PTB 38
// / PT 35 / others. Distributed proportionally to the game's 5 macro-regions
// from real 1990 results, with regional skews: PFL dominant in Nordeste,
// PMDB strong in Sudeste/Sul, PT urban-Sudeste, PT/PDT in Sul.

const BR_SEEDS_1991: Omit<StateRegistrationSeed, "countryId">[] = [
  {
    stateId: "SUDESTE",
    parties: [
      { abbr: "PMDB", org: 18, reg: 21 },
      { abbr: "PFL", org: 11, reg: 14 },
      { abbr: "PDT", org: 9, reg: 11 },
      { abbr: "PRN", org: 8, reg: 10 },
      { abbr: "PT", org: 9, reg: 11 },
      { abbr: "PDS", org: 7, reg: 8 },
      { abbr: "PTB", org: 6, reg: 8 },
    ],
    independent: 11,
    unregistered: 6,
    unaffiliatedOrg: 32,
  },
  {
    stateId: "NORDESTE",
    parties: [
      { abbr: "PFL", org: 24, reg: 28 },
      { abbr: "PMDB", org: 17, reg: 21 },
      { abbr: "PDS", org: 10, reg: 12 },
      { abbr: "PRN", org: 7, reg: 9 },
      { abbr: "PTB", org: 6, reg: 8 },
      { abbr: "PDT", org: 5, reg: 6 },
      { abbr: "PT", org: 3, reg: 4 },
    ],
    independent: 6,
    unregistered: 6,
    unaffiliatedOrg: 28,
  },
  {
    stateId: "SUL",
    parties: [
      { abbr: "PMDB", org: 22, reg: 26 },
      { abbr: "PDT", org: 12, reg: 15 },
      { abbr: "PDS", org: 10, reg: 12 },
      { abbr: "PFL", org: 8, reg: 10 },
      { abbr: "PT", org: 7, reg: 9 },
      { abbr: "PRN", org: 6, reg: 7 },
      { abbr: "PTB", org: 5, reg: 7 },
    ],
    independent: 7,
    unregistered: 7,
    unaffiliatedOrg: 30,
  },
  {
    stateId: "CENTRO_OESTE",
    parties: [
      { abbr: "PMDB", org: 18, reg: 22 },
      { abbr: "PFL", org: 11, reg: 14 },
      { abbr: "PRN", org: 8, reg: 10 },
      { abbr: "PDT", org: 7, reg: 9 },
      { abbr: "PDS", org: 6, reg: 8 },
      { abbr: "PTB", org: 5, reg: 7 },
      { abbr: "PT", org: 3, reg: 4 },
    ],
    independent: 20,
    unregistered: 6,
    unaffiliatedOrg: 42,
  },
  {
    stateId: "NORTE",
    parties: [
      { abbr: "PMDB", org: 15, reg: 18 },
      { abbr: "PFL", org: 11, reg: 14 },
      { abbr: "PDS", org: 6, reg: 8 },
      { abbr: "PRN", org: 6, reg: 8 },
      { abbr: "PDT", org: 5, reg: 7 },
      { abbr: "PTB", org: 4, reg: 6 },
      { abbr: "PT", org: 3, reg: 4 },
    ],
    independent: 27,
    unregistered: 8,
    unaffiliatedOrg: 50,
  },
];

// ─── IE 1989 Dáil (per region) ──────────────────────────────────────────────
// 1989 Dáil election. FF 44.1% / FG 29.3% / Labour 9.5% / PD 5.5% / WP 5.0% /
// SF 1.2% (no Dáil seats) / Green 1.5%. FF-PD coalition formed government.
// Green and SF folded into unaffiliated for the 1991 game start. Regional
// skews: WP concentrated in Dublin and Border (Sligo-Leitrim ties).

const IE_SEEDS_1991: Omit<StateRegistrationSeed, "countryId">[] = [
  {
    stateId: "DUB",
    parties: [
      { abbr: "FF", org: 27, reg: 37 },
      { abbr: "FG", org: 17, reg: 23 },
      { abbr: "LAB", org: 8, reg: 11 },
      { abbr: "PD", org: 6, reg: 8 },
      { abbr: "WP", org: 6, reg: 8 },
    ],
    independent: 7,
    unregistered: 6,
    unaffiliatedOrg: 36,
  },
  {
    stateId: "KIL",
    parties: [
      { abbr: "FF", org: 33, reg: 44 },
      { abbr: "FG", org: 21, reg: 28 },
      { abbr: "LAB", org: 6, reg: 8 },
      { abbr: "PD", org: 5, reg: 7 },
    ],
    independent: 7,
    unregistered: 6,
    unaffiliatedOrg: 35,
  },
  {
    stateId: "MID",
    parties: [
      { abbr: "FF", org: 35, reg: 47 },
      { abbr: "FG", org: 22, reg: 30 },
      { abbr: "LAB", org: 5, reg: 7 },
    ],
    independent: 9,
    unregistered: 7,
    unaffiliatedOrg: 38,
  },
  {
    stateId: "WEX",
    parties: [
      { abbr: "FF", org: 32, reg: 43 },
      { abbr: "FG", org: 21, reg: 28 },
      { abbr: "LAB", org: 7, reg: 9 },
      { abbr: "PD", org: 4, reg: 6 },
    ],
    independent: 8,
    unregistered: 6,
    unaffiliatedOrg: 36,
  },
  {
    stateId: "LIM",
    parties: [
      { abbr: "FF", org: 33, reg: 44 },
      { abbr: "FG", org: 22, reg: 30 },
      { abbr: "LAB", org: 5, reg: 7 },
      { abbr: "PD", org: 4, reg: 6 },
    ],
    independent: 7,
    unregistered: 6,
    unaffiliatedOrg: 36,
  },
  {
    stateId: "COR",
    parties: [
      { abbr: "FF", org: 33, reg: 44 },
      { abbr: "FG", org: 21, reg: 28 },
      { abbr: "LAB", org: 5, reg: 7 },
      { abbr: "PD", org: 4, reg: 6 },
    ],
    independent: 8,
    unregistered: 7,
    unaffiliatedOrg: 37,
  },
  {
    stateId: "GAL",
    parties: [
      { abbr: "FF", org: 34, reg: 46 },
      { abbr: "FG", org: 22, reg: 30 },
      { abbr: "LAB", org: 4, reg: 5 },
    ],
    independent: 12,
    unregistered: 7,
    unaffiliatedOrg: 40,
  },
  {
    stateId: "DON",
    parties: [
      { abbr: "FF", org: 31, reg: 41 },
      { abbr: "FG", org: 19, reg: 26 },
      { abbr: "LAB", org: 4, reg: 5 },
      { abbr: "WP", org: 5, reg: 7 },
    ],
    independent: 14,
    unregistered: 7,
    unaffiliatedOrg: 41,
  },
];

// ─── CN 1991 NPC composition (per macro-region) ─────────────────────────────
// CCP held ~97% of NPC seats in 1991; CDL and CNDCA held token "united-front"
// seats. There is no competitive registration in the modern sense — these
// values reflect the formal united-front membership distribution and exist
// so the pool/org collections are populated for cross-country uniformity.

const CN_SEEDS_1991: Omit<StateRegistrationSeed, "countryId">[] = [
  {
    stateId: "DB",
    parties: [
      { abbr: "CCP", org: 82, reg: 88 },
      { abbr: "CDL", org: 6, reg: 4 },
      { abbr: "CNDCA", org: 4, reg: 3 },
    ],
    independent: 4,
    unregistered: 1,
    unaffiliatedOrg: 8,
  },
  {
    stateId: "HB",
    parties: [
      { abbr: "CCP", org: 82, reg: 88 },
      { abbr: "CDL", org: 6, reg: 4 },
      { abbr: "CNDCA", org: 4, reg: 3 },
    ],
    independent: 4,
    unregistered: 1,
    unaffiliatedOrg: 8,
  },
  {
    stateId: "HD",
    parties: [
      { abbr: "CCP", org: 80, reg: 87 },
      { abbr: "CDL", org: 7, reg: 5 },
      { abbr: "CNDCA", org: 5, reg: 4 },
    ],
    independent: 3,
    unregistered: 1,
    unaffiliatedOrg: 8,
  },
  {
    stateId: "HZ",
    parties: [
      { abbr: "CCP", org: 82, reg: 88 },
      { abbr: "CDL", org: 6, reg: 4 },
      { abbr: "CNDCA", org: 4, reg: 3 },
    ],
    independent: 4,
    unregistered: 1,
    unaffiliatedOrg: 8,
  },
  {
    stateId: "HN",
    parties: [
      { abbr: "CCP", org: 81, reg: 88 },
      { abbr: "CDL", org: 6, reg: 4 },
      { abbr: "CNDCA", org: 4, reg: 3 },
    ],
    independent: 4,
    unregistered: 1,
    unaffiliatedOrg: 9,
  },
  {
    stateId: "XN",
    parties: [
      { abbr: "CCP", org: 82, reg: 89 },
      { abbr: "CDL", org: 5, reg: 4 },
      { abbr: "CNDCA", org: 4, reg: 3 },
    ],
    independent: 3,
    unregistered: 1,
    unaffiliatedOrg: 9,
  },
  {
    stateId: "XB",
    parties: [
      { abbr: "CCP", org: 83, reg: 90 },
      { abbr: "CDL", org: 5, reg: 3 },
      { abbr: "CNDCA", org: 4, reg: 2 },
    ],
    independent: 4,
    unregistered: 1,
    unaffiliatedOrg: 8,
  },
];

export function build1991RegistrationSeeds(): StateRegistrationSeed[] {
  return [
    ...buildUSSeeds1991(),
    ...UK_SEEDS_1991.map((s) => ({ ...s, countryId: "UK" as const })),
    ...JP_SEEDS_1991.map((s) => ({ ...s, countryId: "JP" as const })),
    ...DE_SEEDS_1991.map((s) => ({ ...s, countryId: "DE" as const })),
    ...BR_SEEDS_1991.map((s) => ({ ...s, countryId: "BR" as const })),
    ...IE_SEEDS_1991.map((s) => ({ ...s, countryId: "IE" as const })),
    ...CN_SEEDS_1991.map((s) => ({ ...s, countryId: "CN" as const })),
  ];
}
