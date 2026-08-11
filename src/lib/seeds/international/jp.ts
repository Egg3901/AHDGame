/**
 * JP Layer-1 demographic model — census-consuming rebuild.
 *
 * Architecture:
 *   - dims: ["ethnicity","age","education","income","urbanization"]
 *   - census: real per-region census data from jpRegionCensusData*.ts
 *   - composition: maps each of the 10 JP archetypes to census dim/key weights
 *   - positions: per-era, reflecting documented JP political history
 *     (LDP dominance 1979, 1991 bubble collapse + 1993 coalition break,
 *      1999 lost decade, 2007 DPJ surge, 2019 Abenomics era, 2023 post-Abe)
 *   - region/archetype leans EMERGE from census × positions — never hand-calibrated
 *
 * Era-fact anchors validated in jp.test.ts:
 *   1979: Rural (TOH, SHI, CGK) → RIGHT (LDP stronghold); KAN (Tokyo) centrist/mild left
 *   2019: KAN (Tokyo) left-leaning vs rural (most left metro); TOH/SHI/CGK strongly RIGHT
 *   1993 (modelled under 1991): opposition surge reflected in urban positions
 *   2009 (modelled under 2007): DPJ victory reflected in urban left shift
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { jpRegionCensusData } from "@/lib/seeds/jp/jpRegionCensusData";
import { jpRegionCensusData1953 } from "@/lib/seeds/jp/jpRegionCensusData1953";
import { jpRegionCensusData1979 } from "@/lib/seeds/jp/jpRegionCensusData1979";
import { jpRegionCensusData1991 } from "@/lib/seeds/jp/jpRegionCensusData1991";
import { jpRegionCensusData1999 } from "@/lib/seeds/jp/jpRegionCensusData1999";
import { jpRegionCensusData2007 } from "@/lib/seeds/jp/jpRegionCensusData2007";
import { jpRegionCensusData2023 } from "@/lib/seeds/jp/jpRegionCensusData2023";
import type { JPRegionLayer1 } from "@/lib/seeds/jp/jpRegionCensusData";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Constants ─────────────────────────────────────────────────────────────────

export const JP_GROUP_IDS = [
  "salaryman_conservative",
  "urban_progressive",
  "rural_traditionalist",
  "young_urban",
  "retiree",
  "public_sector",
  "small_business",
  "komeito_faithful",
  "reform_populist",
  "working_mothers",
] as const;

type GroupId = (typeof JP_GROUP_IDS)[number];

// ── Turnout rates (per census dim/key) ────────────────────────────────────────
// Derived from Jiji Press / NHK polling and Ministry of Internal Affairs data.
// Japan's overall turnout ~53% (2021 lower house); seniors are the most reliable
// voters; youth among the lowest. Era-stable enough for one table.

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: {
    japanese: 55, // National average
    chinese: 0, // Non-citizens; no voting rights in Japan
    korean: 0, // Zainichi Koreans historically non-citizen; no vote
    southeast_asian: 0, // Technical trainees / residents — no voting rights
    other_foreign: 0, // Foreign nationals — no voting rights
  },
  age: {
    young: 35, // 18-29: disengaged; 2021 election ~36%
    mid: 52, // 30-44
    mature: 65, // 45-64: core LDP mobilisation base
    senior: 72, // 65+: highest turnout; Soka Gakkai/LDP koenkai mobilise well
  },
  education: {
    primary_or_below: 55, // Older compulsory-school cohort; reliable voters in 1950s
    high_school: 50, // Vocational / HS graduates; mixed turnout
    vocational: 52,
    university: 62, // Graduates more likely to vote
    graduate: 66,
  },
  income: {
    low: 46,
    middle: 56,
    high: 65,
  },
  urbanization: {
    urban: 50, // City dwellers: lower turnout, less koenkai mobilisation
    suburban: 55,
    rural: 65, // Rural koenkai networks drive high turnout; LDP organised base
  },
};

// ── Composition: archetype ← census dims ─────────────────────────────────────
// Weights reflect the census signals that define each archetype.
// Era-stable: the defining demographics of each archetype don't shift, only their
// political positions shift over time (captured in per-era POSITIONS tables).

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  /**
   * Salaryman Conservatives: corporate employees in large companies.
   * Mid-age, university/vocational educated, middle income, suburban/urban.
   * Backbone of LDP support; company-linked koenkai voting networks.
   */
  salaryman_conservative: {
    weights: [
      { dim: "age", key: "mature", w: 0.35 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "education", key: "university", w: 0.2 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
    ],
    civicMultiplier: 1.05,
  },
  /**
   * Urban Progressives: university-educated cosmopolitan city-dwellers.
   * Degree-educated, urban, mid-age, higher income. CDP and progressive base.
   */
  urban_progressive: {
    weights: [
      { dim: "education", key: "university", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "age", key: "mid", w: 0.2 },
      { dim: "income", key: "high", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Rural Traditionalists: farming communities, small towns outside metro areas.
   * Rural, senior, high-school educated, low-middle income.
   * Core LDP base since party founding; agricultural subsidies + public works.
   */
  rural_traditionalist: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "age", key: "senior", w: 0.3 },
      { dim: "education", key: "high_school", w: 0.15 },
      { dim: "income", key: "low", w: 0.1 },
    ],
    civicMultiplier: 1.1,
  },
  /**
   * Young Urban: under-35 city residents.
   * Japan's lowest-turnout demographic. Mildly progressive, politically disengaged.
   * "Ice age" / "lost generation" — economic precarity shapes political indifference.
   */
  young_urban: {
    weights: [
      { dim: "age", key: "young", w: 0.5 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "education", key: "university", w: 0.2 },
    ],
    civicMultiplier: 0.75,
  },
  /**
   * Retirees & Elderly: 65+ Japan — world's oldest population.
   * Senior, suburban/rural, diverse education (historically high-school dominant).
   * Highest turnout; broadly conservative; strong LDP loyalty.
   */
  retiree: {
    weights: [
      { dim: "age", key: "senior", w: 0.65 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "urbanization", key: "suburban", w: 0.15 },
    ],
    civicMultiplier: 1.1,
  },
  /**
   * Public Sector & Teachers: government workers, educators, municipal employees.
   * Aligned with Rengo unions; pro-public spending, moderately progressive.
   * Mid-income, university educated, urban.
   */
  public_sector: {
    weights: [
      { dim: "education", key: "university", w: 0.35 },
      { dim: "income", key: "middle", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Small Business & Self-Employed: shop owners, sole traders, family businesses.
   * Anti-regulation, concerned with consumption tax burden. Economically right-leaning.
   * Present across all regions — the shotengai (shopping street) economy.
   */
  small_business: {
    weights: [
      { dim: "income", key: "middle", w: 0.35 },
      { dim: "urbanization", key: "suburban", w: 0.3 },
      { dim: "education", key: "vocational", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Komeito Faithful: Soka Gakkai-aligned voters.
   * Japan's largest religious organization; centrist, extreme bloc turnout.
   * Urban, diverse ages, LDP's permanent coalition partner.
   */
  komeito_faithful: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.4 },
      { dim: "age", key: "mature", w: 0.3 },
      { dim: "income", key: "middle", w: 0.3 },
    ],
    civicMultiplier: 1.15,
  },
  /**
   * Reform Populists: anti-establishment voters drawn to Nippon Ishin.
   * Strong in Kansai (Osaka base). Economically libertarian, socially moderate.
   * Want to shake up Japan's bureaucratic status quo.
   */
  reform_populist: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "age", key: "mid", w: 0.3 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "education", key: "vocational", w: 0.15 },
    ],
    civicMultiplier: 0.9,
  },
  /**
   * Working Mothers: women balancing career and family.
   * Mildly progressive, pragmatic economically. Urban/suburban, mid-age.
   * Growing political awareness as demographic decline requires women's participation.
   */
  working_mothers: {
    weights: [
      { dim: "age", key: "mid", w: 0.4 },
      { dim: "urbanization", key: "suburban", w: 0.3 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "education", key: "university", w: 0.1 },
    ],
    civicMultiplier: 0.95,
  },
};

// ── Default leans (archetype priors, from jpDemographicCategories.ts) ─────────

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  salaryman_conservative: { economicLean: 1, socialLean: 1 },
  urban_progressive: { economicLean: -2, socialLean: -3 },
  rural_traditionalist: { economicLean: 1, socialLean: 3 },
  young_urban: { economicLean: -1, socialLean: -3 },
  retiree: { economicLean: 0, socialLean: 2 },
  public_sector: { economicLean: -2, socialLean: -1 },
  small_business: { economicLean: 3, socialLean: 1 },
  komeito_faithful: { economicLean: 0, socialLean: 0 },
  reform_populist: { economicLean: 2, socialLean: 0 },
  working_mothers: { economicLean: -1, socialLean: -2 },
};

// ── Per-era positions: how each census key leaned in that political era ────────
//
// Scale: economicLean -5 (redistribution) to +5 (free market)
//        socialLean   -5 (progressive) to +5 (traditional/conservative)
//
// Historical basis:
//   1979: LDP dominance at peak. Ohira era. Conservative rural lock solid.
//         Urban blue-collar → Socialists (JSP); students/intellectuals left.
//         Young population but LDP wins rural/suburban vote decisively.
//         Japan's "1955 system" fully intact.
//
//   1991: Bubble has just burst. LDP fractured internally (Takeshita scandal, 1989).
//         Komeito growing in urban areas. JSP had a brief surge then collapsed.
//         1993 coalition (Hosokawa) reflecting early opposition surge — positions
//         shift toward urban resentment of LDP. Rural still locked.
//
//   1999: Post-reform (Hashimoto cuts), lost decade deep. Koizumi not yet PM.
//         LDP-Komeito coalition formed 1999. Youth "employment ice age" begins.
//         Urban discontent growing but fragmented opposition.
//
//   2007: Koizumi's structural reforms (2001-2006) realigned politics.
//         "Postal election" (2005) LDP landslide gave way to 2007 Upper House loss.
//         DPJ growing: 2009 historic victory approaching (modelled as left surge).
//         Education starts to predict urban/left vs rural/right more sharply.
//
//   2019: Abe era. LDP dominance restored; constitutional revision focus.
//         Rural seniors: LDP stronghold. Urban educated: marginally left (CDP).
//         Low youth turnout suppresses left signal. Reform populists (Ishin) growing.
//         Korean community: Zainichi historically backed progressive parties.
//
//   2023: Post-Abe assassination. Kishida era. LDP scandals (Unification Church links).
//         Urban and educated voters drifting from LDP. Rural still firmly right.
//         Ishin surging in Kansai. Youth somewhat more engaged post-controversy.

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

const POSITIONS_1953: EraPositions = {
  // 1953 Japan — post-occupation; Liberal Party (Yoshida) + Hatoyama/Progressive Party split.
  // JSP in opposition. Rearmament debate (Korean War just ended armistice Jul 1953).
  // LDP precursor bloc dominant. Essentially class/rural-vs-urban axis.
  ethnicity: {
    japanese: { economicLean: -0.15, socialLean: 1.0 }, // 99.9%+ everywhere; other dims drive signal
    chinese: { economicLean: -0.65, socialLean: 0.0 }, // very small wartime residuals
    korean: { economicLean: -2.15, socialLean: -0.5 }, // Zainichi; progressive but disfranchised
    southeast_asian: { economicLean: -0.15, socialLean: 0.0 },
    other_foreign: { economicLean: -0.15, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -2.15, socialLean: -2.25 }, // Post-war youth; JSP/left sympathies
    mid: { economicLean: -1.65, socialLean: -0.6 }, // Working-age; JSP union base
    mature: { economicLean: 0.35, socialLean: 1.35 }, // Mid-career; conservative lean
    senior: { economicLean: 2.35, socialLean: 2.7 }, // Meiji/Taisho generation; very conservative
  },
  education: {
    primary_or_below: { economicLean: 0.85, socialLean: 3.5 }, // Oldest rural cohort; strongly traditional/conservative
    high_school: { economicLean: 0.35, socialLean: 2.55 }, // Agricultural/working class; rural conservative
    vocational: { economicLean: -0.15, socialLean: 0.75 }, // Urban trades; split
    university: { economicLean: -2.65, socialLean: -2.25 }, // Intellectuals; JSP/left
    graduate: { economicLean: -3.15, socialLean: -3.15 },
  },
  income: {
    low: { economicLean: -0.65, socialLean: 1.65 }, // Rural poor: LDP client networks
    middle: { economicLean: 0.35, socialLean: 0.0 }, // Emerging middle class; conservative
    high: { economicLean: 2.35, socialLean: -1.5 }, // Business/zaibatsu successors; right
  },
  urbanization: {
    urban: { economicLean: -3.65, socialLean: -2.55 }, // Industrial workers; JSP stronghold
    suburban: { economicLean: 0.35, socialLean: 0.68 }, // Mixed
    rural: { economicLean: 3.35, socialLean: 3.3 }, // Agricultural; Liberal/conservative dominant
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    // 1979: near-homogeneous Japan. The zainichi Korean community (concentrated
    // in Kansai) historically voted for progressive parties due to discrimination.
    // Other foreign residents negligible. Ethnicity signal comes mainly from korean key.
    // japanese is set near-neutral so age/education/urbanization carry the regional signal.
    japanese: { economicLean: 0.47, socialLean: 0.5 }, // Near-neutral: other dims carry regional differentiation
    chinese: { economicLean: -0.53, socialLean: -0.5 },
    korean: { economicLean: -2.03, socialLean: -1.5 }, // Zainichi: historically JSP/progressive
    southeast_asian: { economicLean: -0.53, socialLean: 0.0 },
    other_foreign: { economicLean: -0.53, socialLean: 0.0 },
  },
  age: {
    // 1979: large young population (baby boomers). Youth protest culture 1960s ended,
    // but students/young workers leaned JSP/JCP. Seniors: wartime generation, LDP loyal.
    young: { economicLean: -2.03, socialLean: -2.55 }, // Student/worker left, anti-AMPO sentiment lingers
    mid: { economicLean: -0.53, socialLean: -0.68 }, // Working-age — LDP lean but class politics present
    mature: { economicLean: 0.97, socialLean: 1.53 }, // Established workers, LDP lean
    senior: { economicLean: 2.47, socialLean: 3.06 }, // Wartime generation: very conservative + LDP
  },
  education: {
    // 1979: university rate ~25-35% in cities, ~17-21% rural. Graduates lean slightly
    // left (intellectual tradition) but not nearly as polarized as UK post-2019.
    // High school / vocational = agricultural/working class = somewhat right (LDP subsidies).
    high_school: { economicLean: 0.97, socialLean: 2.89 }, // Working-class rural: LDP via subsidies; socially traditional
    vocational: { economicLean: 0.47, socialLean: 0.85 },
    university: { economicLean: -1.53, socialLean: -2.55 }, // Intellectuals lean left; Zengakuren legacy
    graduate: { economicLean: -2.03, socialLean: -3.57 },
  },
  income: {
    low: { economicLean: -0.53, socialLean: 1.87 }, // Poor/agricultural: LDP client network via subsidies
    middle: { economicLean: 0.47, socialLean: 0.0 }, // Salaryman: mild right social, econ neutral
    high: { economicLean: 1.47, socialLean: -1.7 }, // Business: LDP-leaning, less extreme than UK
  },
  urbanization: {
    // KEY AXIS: rural = LDP stronghold (agricultural subsidies, koenkai networks).
    // Urban industrial = JSP (labor unions). Metropolitan professional = mild left.
    urban: { economicLean: -3.03, socialLean: -2.89 }, // Industrial workers, JSP union base — very strong left
    suburban: { economicLean: 0.97, socialLean: 0.77 }, // Commuter belt, LDP lean
    rural: { economicLean: 3.47, socialLean: 3.74 }, // Agricultural LDP stronghold — very strongly right
  },
};

const POSITIONS_1991: EraPositions = {
  ethnicity: {
    // 1991: bubble burst, scandal fatigue with LDP (Recruit, Sagawa scandals).
    // Zainichi community remains progressive. Opposition surge in urban areas.
    japanese: { economicLean: 0.72, socialLean: 0.5 },
    chinese: { economicLean: -0.28, socialLean: -0.5 },
    korean: { economicLean: -1.78, socialLean: -1.5 },
    southeast_asian: { economicLean: -0.28, socialLean: 0.0 },
    other_foreign: { economicLean: -0.28, socialLean: 0.0 },
  },
  age: {
    // 1991: 1993 coalition reflects urban youth/worker discontent.
    // The 1993 non-LDP coalition (Hosokawa) drew heavily from urban, younger voters.
    young: { economicLean: -2.28, socialLean: -2.85 }, // Anti-LDP surge; employment anxiety beginning
    mid: { economicLean: -0.28, socialLean: -0.76 }, // Some shift left; bubble burst hit salarymen
    mature: { economicLean: 1.22, socialLean: 1.71 },
    senior: { economicLean: 2.72, socialLean: 3.42 }, // Still solidly conservative
  },
  education: {
    high_school: { economicLean: 1.22, socialLean: 3.23 },
    vocational: { economicLean: 0.72, socialLean: 0.95 },
    university: { economicLean: -1.78, socialLean: -2.85 }, // Urban educated: anti-LDP momentum
    graduate: { economicLean: -2.28, socialLean: -3.99 },
  },
  income: {
    low: { economicLean: -0.28, socialLean: 2.09 },
    middle: { economicLean: 0.22, socialLean: 0.0 }, // Salaryman hit by recession; some disillusion
    high: { economicLean: 1.72, socialLean: -1.9 },
  },
  urbanization: {
    urban: { economicLean: -2.78, socialLean: -3.23 }, // Urban anti-LDP surge (→1993 coalition)
    suburban: { economicLean: 0.72, socialLean: 0.85 },
    rural: { economicLean: 3.72, socialLean: 4.18 }, // Rural still locked for LDP
  },
};

const POSITIONS_1999: EraPositions = {
  ethnicity: {
    // 1999: LDP-Komeito coalition formed. Zainichi still progressive.
    // Foreign residents (Chinese, Brazilians in Chubu) growing but non-voting.
    japanese: { economicLean: 0.65, socialLean: 0.5 },
    chinese: { economicLean: -0.35, socialLean: -0.5 },
    korean: { economicLean: -1.35, socialLean: -1.5 },
    southeast_asian: { economicLean: -0.35, socialLean: 0.0 },
    other_foreign: { economicLean: -0.35, socialLean: 0.0 },
  },
  age: {
    // 1999: lost decade. Youth employment ice age — non-regular workers (freeters).
    // DPJ founded 1998; LDP routed in the 1998 Upper House election — urban
    // discontent real even if opposition fragmented. Kept between 1991 and 2007.
    young: { economicLean: -1.85, socialLean: -3.0 }, // Ice age generation; anti-LDP economics
    mid: { economicLean: -0.35, socialLean: -0.8 }, // Restructuring-hit salarymen drifting from LDP
    mature: { economicLean: 1.15, socialLean: 1.8 },
    senior: { economicLean: 2.65, socialLean: 3.6 },
  },
  education: {
    high_school: { economicLean: 1.15, socialLean: 3.4 },
    vocational: { economicLean: 0.65, socialLean: 1.0 },
    university: { economicLean: -1.85, socialLean: -3.0 }, // Educated urbanites → DPJ/opposition (1998 rout)
    graduate: { economicLean: -2.35, socialLean: -4.2 },
  },
  income: {
    low: { economicLean: -0.35, socialLean: 2.2 },
    middle: { economicLean: 0.15, socialLean: 0.0 }, // Recession-era salaryman disillusion persists
    high: { economicLean: 1.65, socialLean: -2.0 },
  },
  urbanization: {
    urban: { economicLean: -2.85, socialLean: -3.4 }, // Urban anti-LDP discontent (1998 rout → DPJ base)
    suburban: { economicLean: 0.65, socialLean: 0.9 },
    rural: { economicLean: 3.65, socialLean: 4.4 }, // Obuchi-era public works kept rural lock intact
  },
};

const POSITIONS_2007: EraPositions = {
  ethnicity: {
    // 2007: Koizumi reforms (2001-2006) polarized politics. DPJ growing fast.
    // 2009 DPJ landslide approaching — urban educated increasingly anti-LDP.
    japanese: { economicLean: 0.72, socialLean: 0.5 },
    chinese: { economicLean: -0.28, socialLean: -0.5 },
    korean: { economicLean: -1.28, socialLean: -1.5 },
    southeast_asian: { economicLean: -0.28, socialLean: 0.0 },
    other_foreign: { economicLean: -0.28, socialLean: 0.0 },
  },
  age: {
    // 2007: DPJ surge strongest among young workers, progressive urbanites.
    // Koizumi's "reform" rhetoric split the electorate — winners vs losers.
    young: { economicLean: -2.28, socialLean: -3.15 }, // DPJ youth wave (→2009 landslide)
    mid: { economicLean: -0.78, socialLean: -0.84 }, // Structural reform losers: DPJ
    mature: { economicLean: 0.72, socialLean: 1.89 },
    senior: { economicLean: 2.72, socialLean: 3.78 }, // Rural seniors still LDP
  },
  education: {
    high_school: { economicLean: 1.22, socialLean: 3.57 }, // HS-only workers: reform hurt but social traditional
    vocational: { economicLean: 0.22, socialLean: 1.05 },
    university: { economicLean: -1.78, socialLean: -3.15 }, // DPJ progressive surge
    graduate: { economicLean: -2.28, socialLean: -4.41 },
  },
  income: {
    low: { economicLean: -0.28, socialLean: 2.31 }, // Reform losers: non-regular workers
    middle: { economicLean: 0.22, socialLean: 0.0 },
    high: { economicLean: 1.72, socialLean: -2.1 },
  },
  urbanization: {
    urban: { economicLean: -2.78, socialLean: -3.57 }, // DPJ urban base (2009) — strong left
    suburban: { economicLean: 0.22, socialLean: 0.95 },
    rural: { economicLean: 3.72, socialLean: 4.62 }, // Rural: still LDP despite reform anger
  },
};

// 2019 era (also used for 2019 census import, which is the 2020 census base)
const POSITIONS_2019: EraPositions = {
  ethnicity: {
    // 2019: Abe era. Strong LDP national identity discourse.
    // Zainichi/Korean community: targeted by hate speech (discriminatory movements);
    // increasingly mobilised progressively (Korean Wave also softened some tensions).
    // japanese set near-neutral so age/education/urbanization carry regional differentiation.
    japanese: { economicLean: 0.24, socialLean: 0.5 }, // Near-neutral: regional signals from other dims
    chinese: { economicLean: -0.76, socialLean: -0.5 },
    korean: { economicLean: -1.76, socialLean: -2.0 }, // Zainichi: strongly progressive (anti-hate-speech)
    southeast_asian: { economicLean: -0.76, socialLean: 0.0 },
    other_foreign: { economicLean: -0.76, socialLean: 0.0 },
  },
  age: {
    // 2019: education replaces class as urban/rural proxy in JP elections.
    // Youth: very low turnout but mildly progressive. Seniors: LDP bloc.
    young: { economicLean: -1.76, socialLean: -3.45 }, // Mildly progressive; low turnout
    mid: { economicLean: -0.26, socialLean: -0.92 },
    mature: { economicLean: 0.74, socialLean: 2.07 }, // LDP salaryman mature
    senior: { economicLean: 2.24, socialLean: 4.14 }, // LDP bloc; pension security = LDP
  },
  education: {
    // 2019: university-educated Tokyo voters increasingly backing CDP or progressive.
    // Rural HS-only: LDP social conservatism + agricultural subsidy interest.
    high_school: { economicLean: 1.24, socialLean: 3.91 }, // Rural LDP base; very socially traditional
    vocational: { economicLean: 0.74, socialLean: 1.15 },
    university: { economicLean: -1.76, socialLean: -3.45 }, // University → CDP/progressive lean
    graduate: { economicLean: -2.26, socialLean: -4.83 },
  },
  income: {
    low: { economicLean: -0.76, socialLean: 2.53 },
    middle: { economicLean: 0.24, socialLean: 0.0 }, // LDP salaryman — moderate
    high: { economicLean: 1.24, socialLean: -2.3 },
  },
  urbanization: {
    urban: { economicLean: -2.76, socialLean: -3.91 }, // Urban progressive lean — strong left signal
    suburban: { economicLean: 0.74, socialLean: 1.03 }, // LDP suburban
    rural: { economicLean: 3.24, socialLean: 5.0 }, // Rural: very strongly LDP/conservative
  },
};

const POSITIONS_2023: EraPositions = {
  ethnicity: {
    // 2023: post-Abe assassination (2022). LDP-Unification Church scandal.
    // Kishida era. Urban voters, educated, young: drifting from LDP.
    // Rural/senior still LDP but with some disillusion over cult ties.
    japanese: { economicLean: 0.57, socialLean: 0.5 },
    chinese: { economicLean: -0.43, socialLean: -0.5 },
    korean: { economicLean: -1.43, socialLean: -2.0 },
    southeast_asian: { economicLean: -0.43, socialLean: 0.0 },
    other_foreign: { economicLean: -0.43, socialLean: 0.0 },
  },
  age: {
    // 2023: Youth slightly more engaged post-Abe controversy.
    // Ishin (reform populists) attracting young voters; CDP urban progressives.
    young: { economicLean: -1.93, socialLean: -3.6 }, // More engaged post-Abe scandal
    mid: { economicLean: -0.93, socialLean: -0.96 }, // Drift from LDP
    mature: { economicLean: 1.07, socialLean: 2.16 },
    senior: { economicLean: 2.57, socialLean: 4.32 }, // Some LDP disillusion (cult scandal) but still right
  },
  education: {
    high_school: { economicLean: 1.57, socialLean: 4.08 },
    vocational: { economicLean: 0.57, socialLean: 1.2 },
    university: { economicLean: -1.93, socialLean: -3.6 }, // University = anti-LDP stronger now
    graduate: { economicLean: -2.43, socialLean: -5.0 },
  },
  income: {
    low: { economicLean: -0.43, socialLean: 2.64 }, // Cost of living; wage stagnation
    middle: { economicLean: 0.07, socialLean: 0.0 },
    high: { economicLean: 1.07, socialLean: -2.4 },
  },
  urbanization: {
    urban: { economicLean: -2.93, socialLean: -4.08 }, // Urban anti-LDP drift — strong left
    suburban: { economicLean: 0.57, socialLean: 1.08 },
    rural: { economicLean: 3.57, socialLean: 5.0 }, // Rural still solidly right
  },
};

const ERA_POSITIONS: Record<EraId, EraPositions> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
  "1991": POSITIONS_1991,
  "1999": POSITIONS_1999,
  "2007": POSITIONS_2007,
  "2019": POSITIONS_2019,
  "2023": POSITIONS_2023,
};

// ── Census conversion ─────────────────────────────────────────────────────────
// JPRegionLayer1 is already Record<dim, Record<key, number>> — just reindex.

function convertCensus(
  raw: Record<string, JPRegionLayer1>
): Record<string, Record<string, Record<string, number>>> {
  return Object.fromEntries(
    Object.entries(raw).map(([regionId, layer1]) => [
      regionId,
      {
        ethnicity: layer1.ethnicity as unknown as Record<string, number>,
        age: layer1.age as unknown as Record<string, number>,
        education: layer1.education as unknown as Record<string, number>,
        income: layer1.income as unknown as Record<string, number>,
        urbanization: layer1.urbanization as unknown as Record<string, number>,
      },
    ])
  );
}

const ERA_CENSUS: Record<EraId, Record<string, JPRegionLayer1>> = {
  "1953": jpRegionCensusData1953,
  "1979": jpRegionCensusData1979,
  "1991": jpRegionCensusData1991,
  "1999": jpRegionCensusData1999,
  "2007": jpRegionCensusData2007,
  "2019": jpRegionCensusData, // 2020 census base, used for 2019 era
  "2023": jpRegionCensusData2023,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getJpModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era]);
  const positions = ERA_POSITIONS[era];

  return {
    countryId: "JP",
    categoryId: "jp_voterGroups",
    groupIds: [...JP_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

// ── Backwards-compat export (2019 era, single model) ─────────────────────────

export const jpLayer1Model: CountryLayer1Model = getJpModel("2019");
export const jpGroupIds = [...JP_GROUP_IDS];
