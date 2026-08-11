/**
 * Ireland Layer-1 demographic model — census-consuming rebuild.
 *
 * Architecture:
 *   - dims: ["ethnicity","age","education","income","urbanization"]
 *   - census: real per-region CSO data from ieRegionCensusData*.ts
 *   - composition: maps each of the 8 IE archetypes to census dim/key weights
 *   - positions: per-era, reflecting documented Irish political history
 *     (1979: Catholic consensus, civil-war cleavage;
 *      1991: pre-Tiger, emigration decade;
 *      1999: early Celtic Tiger boom;
 *      2007: Tiger peak, EU worker inflow;
 *      2019: post-crash liberalisation — marriage equality (2015), abortion (2018), SF surge;
 *      2023: SF consolidation, housing crisis, rural backlash on migration)
 *   - region/archetype leans EMERGE from census × positions — never hand-calibrated
 *
 * Era-fact anchors validated in ie.test.ts:
 *   1979: all regions socially conservative (high Catholic observance, traditional)
 *         Dublin marginally more progressive than rural west
 *   2019: Dublin strongly socially liberal (marriage eq referendum: DUB ~80% Yes);
 *         GAL/DON more traditional; overall social axis liberalised dramatically
 *         1979→2019
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { ieRegionCensusData } from "@/lib/seeds/ie/ieRegionCensusData";
import { ieRegionCensusData1953 } from "@/lib/seeds/ie/ieRegionCensusData1953";
import { ieRegionCensusData1979 } from "@/lib/seeds/ie/ieRegionCensusData1979";
import { ieRegionCensusData1991 } from "@/lib/seeds/ie/ieRegionCensusData1991";
import { ieRegionCensusData1999 } from "@/lib/seeds/ie/ieRegionCensusData1999";
import { ieRegionCensusData2007 } from "@/lib/seeds/ie/ieRegionCensusData2007";
import { ieRegionCensusData2023 } from "@/lib/seeds/ie/ieRegionCensusData2023";
import type { IERegionLayer1 } from "@/lib/seeds/ie/ieRegionCensusData";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Constants ─────────────────────────────────────────────────────────────────

export const IE_GROUP_IDS = [
  "urban_professional",
  "rural_traditional",
  "working_class",
  "new_irish",
  "small_business",
  "retirees",
  "young_urban",
  "border_communities",
] as const;

type GroupId = (typeof IE_GROUP_IDS)[number];

// ── Turnout rates (per census dim/key) ────────────────────────────────────────
// Based on ESRI/CSO Irish National Election Study and Dáil election exit polls.
// Irish turnout averages ~62–66% in general elections.

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: {
    irish: 67, // Core eligible Irish citizens — higher turnout
    uk_british: 55, // UK passport holders with IE residency; lower registration
    eu_other: 40, // EU citizens eligible for local/EP only — low Dáil turnout
    rest_of_world: 30, // Non-EU: very low eligibility + registration rates
  },
  age: {
    young: 46, // 18–29: consistently lowest (INES data)
    mid: 62, // 30–44
    mature: 70, // 45–64
    senior: 78, // 65+: highest; Irish seniors very reliable voters
  },
  education: {
    primary_or_less: 54, // Lower civic engagement; high older share
    leaving_cert: 62, // Standard Irish secondary
    post_secondary: 68,
    third_level: 76, // Graduates have highest turnout
  },
  income: {
    low: 52,
    middle: 65,
    high: 74,
  },
  urbanization: {
    urban: 60,
    suburban: 65,
    rural: 68, // Rural Ireland maintains strong community civic culture
  },
};

// ── Composition: archetype ← census dims ─────────────────────────────────────
// Era-stable: the defining demographics of each archetype don't shift, only
// their political positions shift over time (captured in per-era POSITIONS).

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  /**
   * Urban Professional: Dublin / Cork tech & finance workers.
   * High education (third_level), high income, urban, mid/mature age.
   */
  urban_professional: {
    weights: [
      { dim: "education", key: "third_level", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "high", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.05,
  },
  /**
   * Rural Traditional: farming community, GAA culture, parish life.
   * Rural, senior-skewing, low education (primary/leaving), low-middle income.
   */
  rural_traditional: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "age", key: "senior", w: 0.2 },
      { dim: "education", key: "leaving_cert", w: 0.2 },
      { dim: "income", key: "middle", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Working Class: Dublin suburbs, provincial towns, trade unions, public sector.
   * Low education, low income, urban/suburban, mature age.
   */
  working_class: {
    weights: [
      { dim: "education", key: "primary_or_less", w: 0.3 },
      { dim: "income", key: "low", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 0.88,
  },
  /**
   * New Irish: EU accession migrants, asylum seekers, global workers.
   * Non-Irish ethnicity, low income, urban, young-mid age.
   */
  new_irish: {
    weights: [
      { dim: "ethnicity", key: "eu_other", w: 0.45 },
      { dim: "ethnicity", key: "rest_of_world", w: 0.3 },
      { dim: "income", key: "low", w: 0.15 },
      { dim: "urbanization", key: "urban", w: 0.1 },
    ],
    civicMultiplier: 0.65, // Low Dáil eligibility + registration barriers
  },
  /**
   * Small Business & Farmers: SME owners, self-employed, family farms.
   * High income, post-secondary or leaving cert, suburban/rural, mature.
   */
  small_business: {
    weights: [
      { dim: "income", key: "high", w: 0.35 },
      { dim: "urbanization", key: "suburban", w: 0.25 },
      { dim: "education", key: "post_secondary", w: 0.25 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.05,
  },
  /**
   * Retirees: 65+ voters; NHS/HSE users, pension dependents.
   * Senior, middle income, suburban/rural, lower education (older cohorts).
   */
  retirees: {
    weights: [
      { dim: "age", key: "senior", w: 0.6 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "urbanization", key: "suburban", w: 0.15 },
    ],
    civicMultiplier: 1.1,
  },
  /**
   * Young Urban: under-35 city dwellers; housing crisis generation; SF/Green lean.
   * Young, urban, low income (rental generation), third-level educated.
   */
  young_urban: {
    weights: [
      { dim: "age", key: "young", w: 0.45 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "income", key: "low", w: 0.15 },
      { dim: "education", key: "third_level", w: 0.1 },
    ],
    civicMultiplier: 0.78,
  },
  /**
   * Border Communities: Donegal, Cavan, Monaghan — cross-border employment,
   * Good Friday Agreement acuity, peace process identity. SF lean.
   * Irish ethnicity, leaving_cert, low-middle income, rural/suburban.
   */
  border_communities: {
    weights: [
      { dim: "ethnicity", key: "irish", w: 0.4 },
      { dim: "urbanization", key: "rural", w: 0.3 },
      { dim: "education", key: "leaving_cert", w: 0.2 },
      { dim: "income", key: "low", w: 0.1 },
    ],
    civicMultiplier: 0.95,
  },
};

// ── Default leans (archetype priors, from ieDemographicCategories.ts) ─────────

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  urban_professional: { economicLean: 2, socialLean: -2 },
  rural_traditional: { economicLean: 1, socialLean: 2 },
  working_class: { economicLean: -3, socialLean: 0 },
  new_irish: { economicLean: -1, socialLean: -2 },
  small_business: { economicLean: 2, socialLean: 1 },
  retirees: { economicLean: 0, socialLean: 1 },
  young_urban: { economicLean: -2, socialLean: -3 },
  border_communities: { economicLean: -1, socialLean: -1 },
};

// ── Per-era positions ─────────────────────────────────────────────────────────
//
// Scale: economicLean -5 (redistribution) to +5 (free market)
//        socialLean   -5 (progressive) to +5 (traditional/conservative)
//
// Historical basis:
//   1979: Civil-war politics dominant (FF vs FG, both centre-right).
//         Social Ireland: near-universal Catholic Church attendance (~90%),
//         contraception banned, divorce banned, abortion banned.
//         Social lean = uniformly traditional (positive). Economic lean
//         determined primarily by income/class (working class = Labour-left;
//         farmers/business = FF/FG moderate-right).
//
//   1991: Recession decade aftermath. Emigration era (1980s). FF tribunals
//         beginning to erode Church authority. Very slowly liberalising
//         (divorce referendum defeated 1986 but debated; condom legalisation
//         1985). Still strongly traditional socially. Economic: recession anger.
//
//   1999: Celtic Tiger early. Employment boom. Gay rights legislation (1993).
//         Divorce legalised (1996 referendum, narrow 50.3%). Church scandals
//         beginning (Ryan/Murphy reports later but abuse awareness growing).
//         Social lean: easing from its 1979 peak but still conservative.
//
//   2007: Celtic Tiger peak. EU migrants present. Boom confidence. Urban/young
//         more liberal (civil partnership debate). Third-level expansion = more
//         cosmopolitan graduates. Church authority in decline.
//
//   2019: Post-crash liberalisation crystallised. Marriage equality referendum
//         May 2015 (62% Yes; Dublin over 80% Yes). Abortion referendum May 2018
//         (66% Yes). SF surge post-2011. Degree-plus socially very progressive.
//         Rural west still more traditional but shifted significantly from 1979.
//
//   2023: SF consolidation. Housing crisis driving economic left. Migration
//         backlash in rural areas (social lean partially reverting in some
//         demographics). Urban professionals remain socially liberal.

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

const POSITIONS_1953: EraPositions = {
  // 1953 Ireland — de Valera's Fianna Fáil dominant; Fine Gael/Labour in opposition.
  // Deep Catholic social conservatism (Constitution 1937 enshrined). Massive emigration.
  // Economy: protectionist, agricultural, stagnant.
  //
  // The civil-war cleavage (FF vs FG) is primarily ECONOMIC: FF = protectionist,
  // small-farmer, working-class left; FG = larger-farm, commercial, professional
  // right. Social conservatism is near-universal but the economic axis must be
  // able to dominate in Dublin (Labour/working-class left) so the political map
  // varies region-to-region. Social values are therefore kept moderate so that
  // |econ| > |social| in urban/working-class Dublin while |social| > |econ|
  // in the rural west.
  ethnicity: {
    irish: { economicLean: -0.5, socialLean: 1.0 }, // 99.9% Irish; Catholic consensus
    uk_british: { economicLean: 1.0, socialLean: 0.5 }, // Protestant community; FG lean
    eu_other: { economicLean: -0.5, socialLean: 0.5 },
    rest_of_world: { economicLean: -1.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -2.5, socialLean: 0.5 }, // Emigrating generation; Labour/FF left
    mid: { economicLean: -1.0, socialLean: 1.0 }, // FF core voters; agricultural/working class
    mature: { economicLean: -0.5, socialLean: 1.2 }, // War-of-Independence generation; FF loyal
    senior: { economicLean: 0.0, socialLean: 1.5 }, // Most traditional; pre-state formation
  },
  education: {
    primary_or_less: { economicLean: -3.0, socialLean: 1.0 }, // Rural majority; FF class base
    leaving_cert: { economicLean: -1.0, socialLean: 0.8 },
    post_secondary: { economicLean: 1.0, socialLean: 0.5 },
    third_level: { economicLean: 2.5, socialLean: 0.3 }, // Very small elite; FG/professional class
  },
  income: {
    low: { economicLean: -4.0, socialLean: 0.8 }, // Smallholders/labourers; FF class base
    middle: { economicLean: -0.5, socialLean: 1.0 }, // Small business; Church-aligned middle
    high: { economicLean: 3.5, socialLean: 0.5 }, // Professional/landed; FG
  },
  urbanization: {
    urban: { economicLean: -3.5, socialLean: 0.3 }, // Dublin working class; Labour/FF
    suburban: { economicLean: 0.5, socialLean: 0.8 },
    rural: { economicLean: 0.0, socialLean: 1.5 }, // Parish life; most traditional
  },
};

const POSITIONS_1979: EraPositions = {
  // NOTE on scale: these encode PARTY-POLITICAL left-right positioning, not raw
  // religiosity. 1979 Ireland was uniformly Catholic-observant, but that near-
  // universal observance did not translate into far-right party politics (FF/FG
  // were centrist catch-alls). Social magnitudes are therefore kept moderate
  // (rural/senior clearly traditional, urban near-neutral) so the derived
  // display lean reflects the actual weakly-differentiated Dáil left-right
  // space, with Dublin's industrial working class as the one left anchor.
  ethnicity: {
    // 1979: Ireland nearly 100% Irish-born; ethnicity barely distinguishes anyone.
    irish: { economicLean: 0.0, socialLean: 0.5 }, // Catholic consensus, politically centrist
    uk_british: { economicLean: 0.5, socialLean: -0.5 }, // Protestant/secular minority
    eu_other: { economicLean: -0.5, socialLean: -1.0 },
    rest_of_world: { economicLean: -1.0, socialLean: -1.0 },
  },
  age: {
    // Young in 1979 were the post-free-education generation — slightly more liberal.
    // Economic: younger = working class/left.
    young: { economicLean: -1.5, socialLean: -0.5 },
    mid: { economicLean: -0.5, socialLean: 0.5 },
    mature: { economicLean: -0.5, socialLean: 1.0 },
    senior: { economicLean: 0.5, socialLean: 2.0 }, // Pre-war generation, most traditional
  },
  education: {
    // 1979: almost no graduates; very high primary-or-less share.
    primary_or_less: { economicLean: -1.5, socialLean: 1.5 }, // Working poor, traditional
    leaving_cert: { economicLean: -0.5, socialLean: 1.0 },
    post_secondary: { economicLean: 0.5, socialLean: 0.0 },
    third_level: { economicLean: 1.0, socialLean: -1.0 }, // Small elite; secular professionals
  },
  income: {
    low: { economicLean: -3.0, socialLean: 0.5 }, // Class politics: low income = Labour left
    middle: { economicLean: 0.5, socialLean: 1.0 }, // FF heartland — small farmers, modest business
    high: { economicLean: 3.0, socialLean: 0.0 }, // Professional class; FG; less Church-dependent
  },
  urbanization: {
    urban: { economicLean: -3.5, socialLean: -1.0 }, // Industrial Dublin; Labour/union left
    suburban: { economicLean: 0.5, socialLean: 1.0 },
    rural: { economicLean: 3.5, socialLean: 2.5 }, // Farm-owning, parish-centred; FF/FG right
  },
};

const POSITIONS_1991: EraPositions = {
  // Recession-decade aftermath; Church authority eroding (divorce debate begun,
  // condom legalisation 1985) but rural Ireland still clearly traditional.
  // Left-right space still weak; Dublin working class the left anchor.
  ethnicity: {
    irish: { economicLean: 0.0, socialLean: 0.5 },
    uk_british: { economicLean: 0.5, socialLean: -0.5 },
    eu_other: { economicLean: -0.5, socialLean: -1.0 },
    rest_of_world: { economicLean: -1.0, socialLean: -1.0 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.0 }, // X generation: early secularisation
    mid: { economicLean: -0.5, socialLean: 0.5 },
    mature: { economicLean: -0.5, socialLean: 1.0 },
    senior: { economicLean: 0.5, socialLean: 2.0 },
  },
  education: {
    primary_or_less: { economicLean: -1.5, socialLean: 1.5 },
    leaving_cert: { economicLean: -0.5, socialLean: 1.0 },
    post_secondary: { economicLean: 0.5, socialLean: 0.0 },
    third_level: { economicLean: 0.5, socialLean: -1.5 }, // Growing graduate class; divorce-debate liberals
  },
  income: {
    low: { economicLean: -3.0, socialLean: 0.5 }, // Recession anger; Labour/WP left
    middle: { economicLean: 0.5, socialLean: 1.0 },
    high: { economicLean: 2.5, socialLean: -0.5 },
  },
  urbanization: {
    urban: { economicLean: -3.5, socialLean: -1.0 }, // Dublin unemployment-era left
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 3.5, socialLean: 2.0 },
  },
};

const POSITIONS_1999: EraPositions = {
  // Early Celtic Tiger. Divorce legal (1996). Boom optimism pulls the median
  // right economically in rural/suburban Ireland while Dublin's working class
  // and young renters stay left.
  ethnicity: {
    irish: { economicLean: 0.0, socialLean: 0.5 },
    uk_british: { economicLean: 0.5, socialLean: -0.5 },
    eu_other: { economicLean: -0.5, socialLean: -1.0 },
    rest_of_world: { economicLean: -1.0, socialLean: -1.0 },
  },
  age: {
    young: { economicLean: -1.0, socialLean: -1.5 }, // Tiger youth; clearly less traditional
    mid: { economicLean: 0.0, socialLean: 0.0 },
    mature: { economicLean: -0.5, socialLean: 1.0 },
    senior: { economicLean: 0.5, socialLean: 2.0 },
  },
  education: {
    primary_or_less: { economicLean: -1.5, socialLean: 1.5 },
    leaving_cert: { economicLean: -0.5, socialLean: 0.5 },
    post_secondary: { economicLean: 0.5, socialLean: -0.5 },
    third_level: { economicLean: 0.5, socialLean: -1.5 }, // Graduates now socially liberal
  },
  income: {
    low: { economicLean: -2.5, socialLean: 0.5 },
    middle: { economicLean: 0.5, socialLean: 0.5 },
    high: { economicLean: 2.5, socialLean: -0.5 },
  },
  urbanization: {
    urban: { economicLean: -3.0, socialLean: -1.0 }, // Dublin left; Labour/DL base
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 3.5, socialLean: 2.0 }, // Boom-era farm/FF-FG right
  },
};

const POSITIONS_2007: EraPositions = {
  // Tiger peak. EU workers present. Church authority in steep decline; urban
  // Ireland socially centrist-liberal, rural still traditional but softening.
  ethnicity: {
    irish: { economicLean: 0.5, socialLean: 0.5 }, // Pro-market boom confidence
    uk_british: { economicLean: 0.5, socialLean: -0.5 },
    eu_other: { economicLean: -0.5, socialLean: -1.0 }, // EU workers — young, secular
    rest_of_world: { economicLean: -1.0, socialLean: -1.0 },
  },
  age: {
    young: { economicLean: -0.5, socialLean: -1.5 }, // Boom generation; socially liberal
    mid: { economicLean: 0.5, socialLean: -0.5 },
    mature: { economicLean: 0.0, socialLean: 1.0 },
    senior: { economicLean: 0.0, socialLean: 2.0 },
  },
  education: {
    primary_or_less: { economicLean: -1.5, socialLean: 1.5 },
    leaving_cert: { economicLean: 0.0, socialLean: 0.5 },
    post_secondary: { economicLean: 0.5, socialLean: -0.5 },
    third_level: { economicLean: 0.5, socialLean: -1.5 },
  },
  income: {
    low: { economicLean: -2.5, socialLean: 0.5 },
    middle: { economicLean: 0.5, socialLean: 0.5 },
    high: { economicLean: 3.0, socialLean: -0.5 },
  },
  urbanization: {
    urban: { economicLean: -3.5, socialLean: -1.0 }, // Dublin/Cork working class + young renters
    suburban: { economicLean: 1.0, socialLean: 0.5 }, // Boom-era commuter belt; FF heartland
    rural: { economicLean: 3.5, socialLean: 1.5 },
  },
};

// 2019 era: post-crash liberalisation crystallised. Marriage equality 2015
// (62% Yes), abortion repeal 2018 (66% Yes). SF surge. Degree-plus very progressive.
const POSITIONS_2019: EraPositions = {
  ethnicity: {
    irish: { economicLean: 0.0, socialLean: -0.5 }, // Socially liberalised post-referenda
    uk_british: { economicLean: 0.5, socialLean: 0.0 },
    eu_other: { economicLean: -1.0, socialLean: -1.5 }, // EU citizens: socially liberal
    rest_of_world: { economicLean: -1.5, socialLean: -1.0 },
  },
  age: {
    young: { economicLean: -2.5, socialLean: -3.0 }, // SF/Green generation; housing crisis; socially very liberal
    mid: { economicLean: -1.0, socialLean: -1.5 },
    mature: { economicLean: 0.0, socialLean: 0.5 },
    senior: { economicLean: 0.5, socialLean: 2.0 }, // Still more traditional; FF/FG loyal
  },
  education: {
    // Education is the dominant social axis cleavage in 2019 Ireland (as in the UK).
    primary_or_less: { economicLean: -1.5, socialLean: 2.0 }, // Traditional, lower-income, old
    leaving_cert: { economicLean: -0.5, socialLean: 0.5 },
    post_secondary: { economicLean: 0.0, socialLean: -0.5 },
    third_level: { economicLean: -1.0, socialLean: -2.5 }, // Strongly progressive; voted Yes in both referenda
  },
  income: {
    low: { economicLean: -3.0, socialLean: -0.5 }, // Post-crash economic left; housing crisis; SF base
    middle: { economicLean: 0.0, socialLean: -0.5 },
    high: { economicLean: 2.5, socialLean: -1.0 }, // FG professionals; socially liberal but pro-market
  },
  urbanization: {
    urban: { economicLean: -3.0, socialLean: -2.5 }, // SF urban surge; cities voted heavily Yes twice
    suburban: { economicLean: 0.5, socialLean: -0.5 },
    rural: { economicLean: 3.5, socialLean: 1.5 }, // Rural FF/FG/independents; more traditional
  },
};

const POSITIONS_2023: EraPositions = {
  ethnicity: {
    // 2023: Migration backlash riots (Nov 2023); SF drops in polls;
    // economic left still strong on housing.
    irish: { economicLean: -0.5, socialLean: 0.0 },
    uk_british: { economicLean: 0.5, socialLean: 0.0 },
    eu_other: { economicLean: -1.0, socialLean: -1.0 },
    rest_of_world: { economicLean: -1.5, socialLean: -1.5 },
  },
  age: {
    young: { economicLean: -3.0, socialLean: -2.5 }, // Housing crisis generation; still socially liberal
    mid: { economicLean: -1.0, socialLean: -1.5 },
    mature: { economicLean: 0.0, socialLean: 0.5 },
    senior: { economicLean: 1.0, socialLean: 2.5 }, // FF/FG loyal; most resistant to SF
  },
  education: {
    primary_or_less: { economicLean: -1.0, socialLean: 2.0 }, // Migration backlash strongest here
    leaving_cert: { economicLean: -0.5, socialLean: 0.5 },
    post_secondary: { economicLean: 0.0, socialLean: -0.5 },
    third_level: { economicLean: -1.5, socialLean: -2.5 },
  },
  income: {
    low: { economicLean: -3.0, socialLean: 0.0 }, // Housing crisis driving strong economic left
    middle: { economicLean: 0.0, socialLean: -0.5 },
    high: { economicLean: 2.0, socialLean: -1.0 },
  },
  urbanization: {
    urban: { economicLean: -3.5, socialLean: -2.5 }, // SF/left cities; housing crisis epicentre
    suburban: { economicLean: 0.5, socialLean: 0.5 }, // Commuter-belt migration unease
    rural: { economicLean: 3.5, socialLean: 3.0 }, // Migration backlash + FF/FG/independent right
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

function convertCensus(
  raw: Record<string, IERegionLayer1>
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

const ERA_CENSUS: Record<EraId, Record<string, IERegionLayer1>> = {
  "1953": ieRegionCensusData1953,
  "1979": ieRegionCensusData1979,
  "1991": ieRegionCensusData1991,
  "1999": ieRegionCensusData1999,
  "2007": ieRegionCensusData2007,
  "2019": ieRegionCensusData, // CSO Census 2022 base, used for 2019 era
  "2023": ieRegionCensusData2023,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getIeModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era]);
  const positions = ERA_POSITIONS[era];

  return {
    countryId: "IE",
    categoryId: "ie_voterGroups",
    groupIds: [...IE_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

// ── Backwards-compat export (2019 era, single model) ─────────────────────────

export const ieLayer1Model: CountryLayer1Model = getIeModel("2019");
export const ieGroupIds = [...IE_GROUP_IDS];
