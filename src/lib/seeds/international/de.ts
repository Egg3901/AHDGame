/**
 * Germany (DE) Layer-1 demographic model — census-consuming build.
 *
 * Architecture (mirrors getUkModel):
 *   - dims: ["ethnicity","age","education","income","urbanization"]
 *   - census: real per-Land profiles from deRegionCensusData*.ts (16 Bundesländer)
 *   - composition: maps each of the 12 DE archetypes (de_voterGroups) to census dim/key weights
 *   - positions: per-era, reflecting documented German political history
 *   - Land/archetype leans EMERGE from census × positions — never hand-calibrated,
 *     never fit to existing seed leans.
 *
 * Historical complications encoded:
 *   - 1979 = WEST Germany (FRG) only. The Eastern Länder (SN/TH/ST/BB/MV and East
 *     Berlin) did NOT vote in FRG elections until 1990. The 1979 census file still
 *     carries DDR-era profiles for those Länder; their 1979 positions are therefore
 *     a best-effort GDR/early-reunification approximation and should be read with
 *     that caveat. Emergent 1979 leans for the East are NOT historically meaningful
 *     for FRG electoral purposes.
 *   - Post-1990 East (SN/TH/ST/BB/MV): economically LEFT (PDS/Linke legacy) but
 *     increasingly socially RIGHT / protest-populist (AfD) from 2013 onward — by
 *     2019/2023 the dominant signal is social-right.
 *   - Bavaria (BY) & Baden-Württemberg (BW): Catholic, affluent, Mittelstand →
 *     CDU/CSU conservative (RIGHT) across all eras.
 *   - City-states Berlin (BE), Hamburg (HH), Bremen (BRE): urban, secular,
 *     educated → LEFT.
 *
 * Era-fact anchors validated in de.test.ts (NEVER vs existing seed leans).
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { deRegionCensusData } from "@/lib/seeds/de/deRegionCensusData";
import { deRegionCensusData1953 } from "@/lib/seeds/de/deRegionCensusData1953";
import { deRegionCensusData1979 } from "@/lib/seeds/de/deRegionCensusData1979";
import { deRegionCensusData1991 } from "@/lib/seeds/de/deRegionCensusData1991";
import { deRegionCensusData1999 } from "@/lib/seeds/de/deRegionCensusData1999";
import { deRegionCensusData2007 } from "@/lib/seeds/de/deRegionCensusData2007";
import { deRegionCensusData2023 } from "@/lib/seeds/de/deRegionCensusData2023";
import type { DERegionLayer1 } from "@/lib/seeds/de/deRegionCensusData";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DE_GROUP_IDS = [
  "katholische_konservative",
  "gewerkschafter",
  "urbane_progressive",
  "wirtschaftsliberale",
  "ost_post_industriell",
  "gruene_mittelschicht",
  "rentner_west",
  "migranten_communities",
  "landwirte_dorf",
  "junge_grossstadt",
  "protest_waehler_ost",
  "mittelstand_selbstaendige",
] as const;

type GroupId = (typeof DE_GROUP_IDS)[number];

// ── Turnout rates (per census dim/key) ────────────────────────────────────────
// Grounded in GLES / Bundeswahlleiter participation patterns. Era-stable.
// German turnout is high overall (~76% Bundestag); spread is narrower than UK/US.

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: {
    german: 78,
    turkish_russian_diaspora: 58, // naturalised migrant background, lower engagement
    mena: 52,
    eu_southern_eastern: 60,
    other: 55,
  },
  age: {
    young: 70, // 18-29: lowest, but still high by intl standards
    mid: 76,
    mature: 81,
    senior: 84, // 65+: highest
  },
  education: {
    no_degree: 68,
    berufsausbildung: 76,
    abitur: 80,
    hochschulabschluss: 83,
  },
  income: {
    low: 68,
    middle: 78,
    high: 82,
  },
  urbanization: {
    urban: 76,
    suburban: 77,
    rural: 78,
  },
};

// ── Composition: archetype ← census dims ─────────────────────────────────────
// Weights reflect the census signals that define each archetype. Era-stable:
// the defining demographics of each archetype don't shift, only their political
// positions shift over time (captured in per-era POSITIONS tables).

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  /**
   * Katholische Konservative: churchgoing rural/suburban, German, older,
   * vocational/middle income. CDU/CSU bedrock.
   */
  katholische_konservative: {
    weights: [
      { dim: "ethnicity", key: "german", w: 0.25 },
      { dim: "urbanization", key: "rural", w: 0.25 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "education", key: "berufsausbildung", w: 0.15 },
      { dim: "income", key: "middle", w: 0.15 },
    ],
    civicMultiplier: 1.05,
  },
  /**
   * Gewerkschafter: industrial/service union workers. Vocational, middle/low
   * income, urban-industrial, mid/mature age.
   */
  gewerkschafter: {
    weights: [
      { dim: "education", key: "berufsausbildung", w: 0.4 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "income", key: "low", w: 0.15 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 0.98,
  },
  /**
   * Urbane Progressive: university-educated city professionals.
   * Degree, urban, mid age, middle/high income.
   */
  urbane_progressive: {
    weights: [
      { dim: "education", key: "hochschulabschluss", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "age", key: "mid", w: 0.15 },
      { dim: "income", key: "high", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Wirtschaftsliberale: corporate/management professionals, export industry.
   * High income, degree, urban/suburban. FDP/CDU.
   */
  wirtschaftsliberale: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "education", key: "hochschulabschluss", w: 0.3 },
      { dim: "urbanization", key: "suburban", w: 0.15 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.02,
  },
  /**
   * Ost-Post-Industriell: former GDR workers/pensioners, eastern Länder.
   * Vocational, low income, mature/senior. Keyed on ethnicity.german (East is
   * near-monoethnic) + low income to bias toward eastern Länder census profiles.
   */
  ost_post_industriell: {
    weights: [
      { dim: "education", key: "berufsausbildung", w: 0.35 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "age", key: "senior", w: 0.1 },
      { dim: "ethnicity", key: "german", w: 0.1 },
    ],
    civicMultiplier: 0.9,
  },
  /**
   * Grüne Mittelschicht: teachers/academics/public-sector professionals.
   * Degree, abitur, middle income, mid age, urban/suburban.
   */
  gruene_mittelschicht: {
    weights: [
      { dim: "education", key: "hochschulabschluss", w: 0.35 },
      { dim: "education", key: "abitur", w: 0.2 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
      { dim: "urbanization", key: "urban", w: 0.1 },
    ],
    civicMultiplier: 1.08,
  },
  /**
   * Rentner West: over-65 Wessis, homeowners/pensioners. Senior, middle income,
   * German, suburban. Very reliable turnout.
   */
  rentner_west: {
    weights: [
      { dim: "age", key: "senior", w: 0.55 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "ethnicity", key: "german", w: 0.15 },
      { dim: "urbanization", key: "suburban", w: 0.1 },
    ],
    civicMultiplier: 1.08,
  },
  /**
   * Migranten-Communities: Turkish-German, Russian-German, Arab-German, SE-European.
   * Non-german ethnicity, urban, low/middle income.
   */
  migranten_communities: {
    weights: [
      { dim: "ethnicity", key: "turkish_russian_diaspora", w: 0.35 },
      { dim: "ethnicity", key: "mena", w: 0.2 },
      { dim: "ethnicity", key: "eu_southern_eastern", w: 0.15 },
      { dim: "ethnicity", key: "other", w: 0.1 },
      { dim: "urbanization", key: "urban", w: 0.12 },
      { dim: "income", key: "low", w: 0.08 },
    ],
    civicMultiplier: 0.85,
  },
  /**
   * Landwirte & Dorf: farmers/rural tradespeople. Rural, German, vocational,
   * mature/senior. CDU/CSU + AfD-curious agrarian.
   */
  landwirte_dorf: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "ethnicity", key: "german", w: 0.2 },
      { dim: "education", key: "berufsausbildung", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Junge Großstadt: students/creatives/under-35 knowledge workers.
   * Young, urban, abitur/degree, low/middle income. Green/Linke.
   */
  junge_grossstadt: {
    weights: [
      { dim: "age", key: "young", w: 0.45 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "education", key: "abitur", w: 0.15 },
      { dim: "income", key: "low", w: 0.1 },
    ],
    civicMultiplier: 0.88,
  },
  /**
   * Protest-Wähler (Ost): anti-establishment eastern voters.
   * Eastern bias via german ethnicity + low income; vocational; mature.
   * Distinct from western right-populists.
   */
  protest_waehler_ost: {
    weights: [
      { dim: "income", key: "low", w: 0.3 },
      { dim: "education", key: "berufsausbildung", w: 0.25 },
      { dim: "ethnicity", key: "german", w: 0.2 },
      { dim: "age", key: "mature", w: 0.15 },
      { dim: "urbanization", key: "suburban", w: 0.1 },
    ],
    civicMultiplier: 0.9,
  },
  /**
   * Mittelstand-Selbstständige: small/mid business owners, Handwerksmeister.
   * High income, vocational/abitur, suburban/rural, mature. FDP/CDU.
   */
  mittelstand_selbstaendige: {
    weights: [
      { dim: "income", key: "high", w: 0.35 },
      { dim: "education", key: "berufsausbildung", w: 0.25 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
      { dim: "education", key: "abitur", w: 0.1 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
};

// ── Default leans (archetype priors, from deDemographicCategories.ts) ─────────

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  katholische_konservative: { economicLean: 2, socialLean: 2 },
  gewerkschafter: { economicLean: -3, socialLean: 0 },
  urbane_progressive: { economicLean: -2, socialLean: -3 },
  wirtschaftsliberale: { economicLean: 3, socialLean: -1 },
  ost_post_industriell: { economicLean: -2, socialLean: 2 },
  gruene_mittelschicht: { economicLean: -1, socialLean: -4 },
  rentner_west: { economicLean: 1, socialLean: 2 },
  migranten_communities: { economicLean: -1, socialLean: -2 },
  landwirte_dorf: { economicLean: 1, socialLean: 3 },
  junge_grossstadt: { economicLean: -3, socialLean: -4 },
  protest_waehler_ost: { economicLean: 0, socialLean: 4 },
  mittelstand_selbstaendige: { economicLean: 3, socialLean: 1 },
};

// ── Per-era positions: how each census key leaned in that political era ────────
//
// Scale: economicLean -5 (redistribution) to +5 (free market)
//        socialLean   -5 (progressive) to +5 (traditional/authoritarian)
//
// Historical basis:
//   1979: WEST Germany only (Schmidt SPD chancellorship; CDU/CSU opposition under
//         Kohl). Class politics dominant: vocational/industrial workers economically
//         LEFT (SPD), high income RIGHT (CDU/FDP). Catholic rural strongly social-
//         right. Few graduates; no Green movement yet (Greens founded 1980) — degree
//         is mildly right (elite professionals), NOT yet a progressive marker.
//         East Länder data is DDR-era; positions are best-effort, not FRG-meaningful.
//
//   1991: Reunification year (Kohl). East absorbed; eastern workers economically
//         anxious (LEFT econ via PDS legacy) but culturally conservative. West stable.
//         Greens emerging — degree begins a leftward/progressive drift. Income still
//         the main economic cleavage.
//
//   1999: Red-Green era (Schröder/Fischer, govt formed 1998). Graduate expansion;
//         degree/abitur now clearly progressive (Green/SPD). East: deindustrialised,
//         PDS-strong (econ LEFT) and still socially conservative.
//
//   2007: First Merkel grand coalition; export boom; Hartz-IV aftermath. Die Linke
//         formed 2007 (PDS+WASG) — eastern econ-left consolidated. Degree firmly
//         progressive. Low income econ-left (Hartz losers). Social-right of the East
//         hardening but pre-AfD.
//
//   2019: Post-2015-refugee realignment. AfD entrenched (entered Bundestag 2017).
//         Eastern German + low income + vocational now strongly SOCIAL-RIGHT (AfD
//         protest) while still econ-left. Degree strongly progressive (Green surge).
//         Urban strongly LEFT; rural social-right.
//
//   2023: Ampel era; cost-of-living; AfD polling ~20%+, strongest in the East.
//         Same structure as 2019, social-right of East/low-income intensified;
//         degree/urban progressive deepened.

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

const POSITIONS_1953: EraPositions = {
  // 1953 FRG — Adenauer's CDU won landslide (45.2%); SPD ~29%. The dominant
  // political cleavage is CLASS/ECONOMIC: the Wirtschaftswunder recovery benefits
  // the Mittelstand and farmers (CDU/CSU) while industrial workers in the Ruhr
  // and ports remain SPD. Social conservatism is real (Catholic south) but the
  // economic axis must be able to dominate in industrial regions so the political
  // map varies region-to-region. Social values are therefore calibrated so that
  // |econ| > |social| in SPD strongholds (NW/HH/BRE — urban, industrial) while
  // |social| > |econ| in CDU/CSU heartland (BY/BW/RP — rural, Catholic).
  ethnicity: {
    german: { economicLean: 0.0, socialLean: 0.5 }, // 99%+ everywhere; lean from income/class
    turkish_russian_diaspora: { economicLean: -0.5, socialLean: 0.0 }, // virtually absent in 1953
    mena: { economicLean: -0.5, socialLean: 0.0 }, // virtually absent
    eu_southern_eastern: { economicLean: -0.5, socialLean: 0.2 }, // Sudeten/expellee Germans only
    other: { economicLean: -0.5, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -3.5, socialLean: 0.2 }, // Post-war youth; SPD/working class
    mid: { economicLean: -2.0, socialLean: 0.3 }, // Industrial workers; SPD traditional
    mature: { economicLean: 1.0, socialLean: 1.5 }, // Reconstruction generation; CDU lean
    senior: { economicLean: 2.0, socialLean: 2.0 }, // Pre-war establishment; CDU solid
  },
  education: {
    no_degree: { economicLean: -3.0, socialLean: 0.3 }, // Working class; SPD heartland
    berufsausbildung: { economicLean: -2.0, socialLean: 0.3 }, // Skilled trades; SPD/mixed
    abitur: { economicLean: 1.0, socialLean: 0.5 }, // Lower-middle professional; CDU lean
    hochschulabschluss: { economicLean: 3.0, socialLean: 0.2 }, // Small elite; right of centre
  },
  income: {
    low: { economicLean: -4.5, socialLean: 0.2 }, // Working class rebuilding; firmly SPD
    middle: { economicLean: 0.0, socialLean: 0.5 }, // Emerging Mittelstand; swing/CDU
    high: { economicLean: 4.5, socialLean: 0.5 }, // Business / landowning; CDU/FDP
  },
  urbanization: {
    urban: { economicLean: -4.0, socialLean: 0.0 }, // Industrial Ruhr/Hamburg; SPD stronghold
    suburban: { economicLean: 0.0, socialLean: 0.5 }, // Residential towns; CDU mixed
    rural: { economicLean: 1.5, socialLean: 2.5 }, // Catholic rural Bavaria/Rhineland; CDU solid
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    // 1979 West Germany: ~92%+ German everywhere; ethnicity ≠ economic lean.
    // German is socially traditional baseline (income/education drives economics).
    german: { economicLean: 0.0, socialLean: 1.0 },
    // Gastarbeiter (Turkish/Italian/Yugoslav) — disenfranchised mostly, but where
    // naturalised, working-class SPD-leaning.
    turkish_russian_diaspora: { economicLean: -2.0, socialLean: 0.0 },
    mena: { economicLean: -1.5, socialLean: 0.5 },
    eu_southern_eastern: { economicLean: -1.5, socialLean: 0.0 },
    other: { economicLean: -1.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.0 }, // 68er generation, student left
    mid: { economicLean: -1.0, socialLean: 0.0 },
    mature: { economicLean: -1.0, socialLean: 1.0 }, // SPD industrial worker core
    senior: { economicLean: 0.5, socialLean: 2.5 }, // Adenauer/war generation, CDU
  },
  education: {
    no_degree: { economicLean: -2.0, socialLean: 1.5 }, // working class, SPD econ, social-trad
    berufsausbildung: { economicLean: -1.5, socialLean: 0.5 }, // skilled SPD/union core
    abitur: { economicLean: 0.5, socialLean: -0.5 },
    hochschulabschluss: { economicLean: 1.0, socialLean: -0.5 }, // small professional elite, mildly CDU/FDP
  },
  income: {
    low: { economicLean: -3.5, socialLean: 0.5 }, // class politics — strong SPD
    middle: { economicLean: -0.5, socialLean: 1.0 },
    high: { economicLean: 3.0, socialLean: 1.0 }, // managerial/professional, CDU/FDP
  },
  urbanization: {
    urban: { economicLean: -2.2, socialLean: -0.5 }, // industrial Ruhr/port cities, SPD stronghold
    suburban: { economicLean: 0.0, socialLean: 1.0 },
    rural: { economicLean: 1.5, socialLean: 3.0 }, // Catholic rural, CDU/CSU heartland
  },
};

const POSITIONS_1991: EraPositions = {
  ethnicity: {
    german: { economicLean: 0.0, socialLean: 1.0 },
    turkish_russian_diaspora: { economicLean: -2.0, socialLean: -0.5 },
    mena: { economicLean: -1.5, socialLean: 0.0 },
    eu_southern_eastern: { economicLean: -1.5, socialLean: -0.5 },
    other: { economicLean: -1.0, socialLean: -0.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.5 },
    mid: { economicLean: -0.5, socialLean: 0.0 },
    mature: { economicLean: -1.0, socialLean: 1.0 },
    senior: { economicLean: 0.5, socialLean: 2.5 },
  },
  education: {
    no_degree: { economicLean: -2.0, socialLean: 1.5 },
    berufsausbildung: { economicLean: -1.5, socialLean: 0.5 },
    abitur: { economicLean: -0.5, socialLean: -1.0 },
    hochschulabschluss: { economicLean: 0.0, socialLean: -1.5 }, // Greens established; degree drifting left/progressive
  },
  income: {
    low: { economicLean: -3.0, socialLean: 0.5 }, // East reunification shock — economic anxiety
    middle: { economicLean: -0.5, socialLean: 1.0 },
    high: { economicLean: 2.5, socialLean: 1.0 },
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: -1.0 },
    suburban: { economicLean: 0.0, socialLean: 1.0 },
    rural: { economicLean: 1.5, socialLean: 2.5 },
  },
};

const POSITIONS_1999: EraPositions = {
  ethnicity: {
    german: { economicLean: 0.0, socialLean: 0.5 },
    turkish_russian_diaspora: { economicLean: -2.0, socialLean: -1.0 }, // post-2000 citizenship reform, SPD/Green
    mena: { economicLean: -1.5, socialLean: -0.5 },
    eu_southern_eastern: { economicLean: -1.5, socialLean: -0.5 },
    other: { economicLean: -1.5, socialLean: -0.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -2.0 }, // Red-Green youth
    mid: { economicLean: -0.5, socialLean: -0.5 },
    mature: { economicLean: -0.5, socialLean: 0.5 },
    senior: { economicLean: 0.5, socialLean: 2.5 }, // Kohl-generation seniors stayed socially conservative
  },
  education: {
    no_degree: { economicLean: -1.5, socialLean: 1.5 },
    berufsausbildung: { economicLean: -1.0, socialLean: 0.5 },
    abitur: { economicLean: -0.5, socialLean: -1.5 },
    hochschulabschluss: { economicLean: -1.0, socialLean: -2.0 }, // graduate progressive alignment
  },
  income: {
    low: { economicLean: -4.5, socialLean: 0.5 }, // East deindustrial, PDS-strong econ-left
    middle: { economicLean: -0.5, socialLean: 0.5 },
    high: { economicLean: 3.5, socialLean: 2.0 }, // Kohl-era affluent CDU/FDP: market-right AND socially conservative
  },
  urbanization: {
    urban: { economicLean: -2.5, socialLean: -1.5 },
    suburban: { economicLean: 0.3, socialLean: 1.0 },
    rural: { economicLean: 1.0, socialLean: 3.5 }, // western rural CDU social-trad; eastern rural NOT market-right post-Wende
  },
};

const POSITIONS_2007: EraPositions = {
  ethnicity: {
    german: { economicLean: 0.0, socialLean: 1.0 },
    turkish_russian_diaspora: { economicLean: -1.5, socialLean: -1.0 },
    mena: { economicLean: -1.5, socialLean: -0.5 },
    eu_southern_eastern: { economicLean: -1.5, socialLean: -0.5 },
    other: { economicLean: -1.5, socialLean: -0.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -2.0 },
    mid: { economicLean: -0.5, socialLean: -0.5 },
    mature: { economicLean: -0.5, socialLean: 0.5 },
    senior: { economicLean: 0.5, socialLean: 2.0 },
  },
  education: {
    no_degree: { economicLean: -1.5, socialLean: 2.0 }, // Hartz losers + cultural conservatism
    berufsausbildung: { economicLean: -1.0, socialLean: 1.0 },
    abitur: { economicLean: -0.5, socialLean: -1.5 },
    hochschulabschluss: { economicLean: -1.0, socialLean: -2.0 },
  },
  income: {
    low: { economicLean: -3.0, socialLean: 1.0 }, // Die Linke (formed 2007) econ-left, East
    middle: { economicLean: -0.5, socialLean: 0.5 },
    high: { economicLean: 2.0, socialLean: 0.5 },
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: -1.0 },
    suburban: { economicLean: 0.0, socialLean: 0.5 },
    rural: { economicLean: 1.5, socialLean: 2.5 },
  },
};

// 2019 era (also used for the 2019 census import, the Zensus 2022 base)
const POSITIONS_2019: EraPositions = {
  ethnicity: {
    german: { economicLean: 0.5, socialLean: 1.5 }, // some German social-right shift (AfD)
    turkish_russian_diaspora: { economicLean: -1.0, socialLean: -1.0 }, // SPD/CDU mix; Russlanddeutsche some AfD
    mena: { economicLean: -1.5, socialLean: -1.0 },
    eu_southern_eastern: { economicLean: -1.0, socialLean: -1.0 },
    other: { economicLean: -1.5, socialLean: -1.5 },
  },
  age: {
    young: { economicLean: -2.0, socialLean: -3.0 }, // Fridays-for-Future Green surge
    mid: { economicLean: -0.5, socialLean: -1.0 },
    mature: { economicLean: 0.0, socialLean: 1.5 },
    senior: { economicLean: 0.5, socialLean: 2.5 }, // CDU reliable
  },
  education: {
    no_degree: { economicLean: -1.0, socialLean: 3.0 }, // AfD protest, strongly social-right
    berufsausbildung: { economicLean: -1.0, socialLean: 1.5 },
    abitur: { economicLean: -0.5, socialLean: -1.0 },
    hochschulabschluss: { economicLean: -1.5, socialLean: -2.5 }, // Green/SPD progressive
  },
  income: {
    low: { economicLean: -2.0, socialLean: 2.0 }, // econ-left + social-right (East AfD/Linke paradox)
    middle: { economicLean: 0.0, socialLean: 0.5 },
    high: { economicLean: 2.5, socialLean: 0.0 },
  },
  urbanization: {
    urban: { economicLean: -2.0, socialLean: -2.0 }, // cities progressive
    suburban: { economicLean: 0.0, socialLean: 1.0 },
    rural: { economicLean: 1.0, socialLean: 3.0 }, // rural social-right
  },
};

const POSITIONS_2023: EraPositions = {
  ethnicity: {
    german: { economicLean: 0.0, socialLean: 2.0 }, // AfD ~20%+, deeper social-right
    turkish_russian_diaspora: { economicLean: -1.0, socialLean: -1.0 },
    mena: { economicLean: -1.5, socialLean: -1.0 },
    eu_southern_eastern: { economicLean: -1.0, socialLean: -1.0 },
    other: { economicLean: -1.5, socialLean: -1.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -3.0 }, // Green/Linke, some young-AfD via TikTok offset
    mid: { economicLean: -1.0, socialLean: -0.5 },
    mature: { economicLean: -0.25, socialLean: 1.5 },
    senior: { economicLean: 0.25, socialLean: 2.5 },
  },
  education: {
    no_degree: { economicLean: -0.5, socialLean: 2.5 }, // AfD-leaning, but economics diffuse
    berufsausbildung: { economicLean: -1.8, socialLean: 1.0 }, // squeezed skilled workers: wage/redistribution politics (SPD/BSW), mild trad
    abitur: { economicLean: -0.5, socialLean: -0.5 },
    hochschulabschluss: { economicLean: -1.5, socialLean: -2.5 },
  },
  income: {
    low: { economicLean: -2.5, socialLean: 2.5 }, // cost-of-living econ-left + East social-right
    middle: { economicLean: -0.5, socialLean: 0.4 },
    high: { economicLean: 4.0, socialLean: 0.4 }, // affluence is the market-right anchor (FDP/CDU)
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: -1.5 },
    suburban: { economicLean: 0.2, socialLean: 1.4 }, // homeowner belt: CDU-leaning status quo
    rural: { economicLean: -2.8, socialLean: 0.3 }, // left-behind periphery: state-dependent, redistributive (east-rural SPD/BSW-leaning), no longer market-right
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
// DERegionLayer1 is already Record<dim, Record<key, number>> — just reindex.

function convertCensus(
  raw: Record<string, DERegionLayer1>
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

const ERA_CENSUS: Record<EraId, Record<string, DERegionLayer1>> = {
  "1953": deRegionCensusData1953,
  "1979": deRegionCensusData1979,
  "1991": deRegionCensusData1991,
  "1999": deRegionCensusData1999,
  "2007": deRegionCensusData2007,
  "2019": deRegionCensusData, // Zensus 2022 base, used for 2019 era
  "2023": deRegionCensusData2023,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getDeModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era]);
  const positions = ERA_POSITIONS[era];

  return {
    countryId: "DE",
    categoryId: "de_voterGroups",
    groupIds: [...DE_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

// ── Backwards-compat export (2019 era, single model) ─────────────────────────

export const deLayer1Model: CountryLayer1Model = getDeModel("2019");
export const deGroupIds = [...DE_GROUP_IDS];
