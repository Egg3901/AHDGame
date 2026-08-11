/**
 * China (CN) Layer-1 demographic model — census-consuming rebuild.
 *
 * Architecture:
 *   - dims: ["ethnicity","age","education","income","urbanization"]
 *   - census: real per-region NBS data from cnRegionCensusData*.ts
 *   - composition: maps each of the 7 CN archetypes to census dim/key weights
 *   - positions: per-era, reflecting documented Chinese political-economy history
 *     (Deng reform start 1979, early reform 1991, SOE reform 1999,
 *      WTO boom 2007, Xi consolidation 2019, post-COVID 2023)
 *   - region/archetype leans EMERGE from census × positions — never hand-calibrated
 *
 * Axes:
 *   economicLean: -5 (state-control/socialist) to +5 (market-reform)
 *   socialLean:   -5 (liberal/cosmopolitan) to +5 (traditional/nationalist)
 *
 * Era arc:
 *   1979 — command economy still dominant; state-control is the norm everywhere
 *   1991 — Deng's "southern tour" coming; coastal SEZs diverge from interior
 *   1999 — SOE reform hollows Northeast; coastal private sector ascendant
 *   2007 — WTO boom peak; coastal entrepreneurs most market-positive
 *   2019 — Xi re-centralisation; coastal still more market-positive than interior
 *          but gap narrows under renewed state emphasis
 *   2023 — property bust, graduate unemployment; youth disillusionment rises
 *
 * Era-fact anchors validated in cn.test.ts:
 *   1979: all regions near-zero or left econ (state control era)
 *   2019: HD/HN/HB > XN/XB on market-reform (coastal > interior)
 *   2019: overall market-reform lean higher than 1979
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { cnRegionCensusData } from "@/lib/seeds/cn/cnRegionCensusData";
import { cnRegionCensusData1953 } from "@/lib/seeds/cn/cnRegionCensusData1953";
import { cnRegionCensusData1979 } from "@/lib/seeds/cn/cnRegionCensusData1979";
import { cnRegionCensusData1991 } from "@/lib/seeds/cn/cnRegionCensusData1991";
import { cnRegionCensusData1999 } from "@/lib/seeds/cn/cnRegionCensusData1999";
import { cnRegionCensusData2007 } from "@/lib/seeds/cn/cnRegionCensusData2007";
import { cnRegionCensusData2023 } from "@/lib/seeds/cn/cnRegionCensusData2023";
import type { CNRegionLayer1 } from "@/lib/seeds/cn/cnRegionCensusData";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Constants ─────────────────────────────────────────────────────────────────

export const CN_GROUP_IDS = [
  "party_cadre",
  "urban_professional",
  "rural_peasant",
  "industrial_worker",
  "migrant_worker",
  "entrepreneur",
  "youth",
] as const;

type GroupId = (typeof CN_GROUP_IDS)[number];

// ── Turnout rates (per census dim/key) ────────────────────────────────────────
// Based on NPC delegate election participation patterns and Chinese Election Study
// data. China's electoral system creates very high formal turnout for
// cadre-mobilised groups and lower real participation for marginalised groups.

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: {
    han: 84,
    zhuang: 80,
    hui: 78,
    uyghur: 72, // registration and access barriers in Xinjiang
    tibetan: 70, // remote + institutional barriers
    other_minority: 76,
  },
  age: {
    young: 75, // 18-34: lower engagement; high in nationalist mobilization years
    mid: 84, // 35-49: peak work-unit engagement
    mature: 88, // 50-64: party organizational mobilization strongest
    senior: 82, // 65+: high mobilization but some physical barrier reduction
  },
  education: {
    primary_or_below: 79, // village committee mobilization keeps turnout up
    secondary: 83,
    vocational: 84,
    university: 88, // work-unit and professional association mobilization
  },
  income: {
    low: 79,
    middle: 85,
    high: 90, // entrepreneurs and professionals: NPC/CPPCC channels
  },
  urbanization: {
    urban: 86,
    suburban: 82,
    rural: 80, // village representative elections keep rural turnout high
  },
};

// ── Composition: archetype ← census dims ─────────────────────────────────────
// Weights reflect the census signals most predictive of each archetype.
// Era-stable: defining demographics don't shift; political positions shift
// (captured in per-era POSITIONS tables below).

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  /**
   * Party Cadre & Officials: CCP members, government officials, SOE leadership.
   * High education, high income, mature age, urban (work in party/gov institutions).
   */
  party_cadre: {
    weights: [
      { dim: "education", key: "university", w: 0.35 },
      { dim: "income", key: "high", w: 0.3 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.15 },
    ],
    civicMultiplier: 1.1,
  },
  /**
   * Urban Professional: coastal city knowledge workers, tech, finance.
   * High education + university, high income, urban, younger/mid.
   */
  urban_professional: {
    weights: [
      { dim: "education", key: "university", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "high", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Rural Peasantry: village farming communities in interior provinces.
   * Low education, low income, rural, mature/senior.
   */
  rural_peasant: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "education", key: "primary_or_below", w: 0.2 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 0.92,
  },
  /**
   * Industrial Worker: manufacturing belt and SOE workers.
   * Secondary/vocational education, middle income, urban, mature.
   */
  industrial_worker: {
    weights: [
      { dim: "education", key: "secondary", w: 0.35 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "age", key: "mature", w: 0.15 },
    ],
    civicMultiplier: 0.95,
  },
  /**
   * Migrant Worker: floating population (liudong renkou).
   * Low education, low income, urban (de facto) but from rural origin, young.
   */
  migrant_worker: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "age", key: "young", w: 0.3 },
      { dim: "urbanization", key: "suburban", w: 0.2 }, // peri-urban factory zones
      { dim: "education", key: "secondary", w: 0.15 },
    ],
    civicMultiplier: 0.75, // hukou/registration barriers suppress participation
  },
  /**
   * Private Entrepreneur: SME owners, private-sector founders, Alibaba-era business class.
   * High income, university or vocational, urban/suburban, mid age.
   */
  entrepreneur: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "education", key: "vocational", w: 0.25 }, // many entrepreneurs: vocational/secondary
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.05,
  },
  /**
   * Youth (under-35): university graduates, digital natives, social media generation.
   * Young age, university education, urban, mid income (aspirational).
   */
  youth: {
    weights: [
      { dim: "age", key: "young", w: 0.5 },
      { dim: "education", key: "university", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "income", key: "middle", w: 0.1 },
    ],
    civicMultiplier: 0.9,
  },
};

// ── Default leans (archetype priors, from cnDemographicCategories.ts) ─────────

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  party_cadre: { economicLean: 0, socialLean: 3 },
  urban_professional: { economicLean: 2, socialLean: 0 },
  rural_peasant: { economicLean: -2, socialLean: 2 },
  industrial_worker: { economicLean: -1, socialLean: 1 },
  migrant_worker: { economicLean: -2, socialLean: 1 },
  entrepreneur: { economicLean: 3, socialLean: 1 },
  youth: { economicLean: 1, socialLean: -1 },
};

// ── Per-era positions: how each census key leaned in that political era ────────
//
// Scale: economicLean -5 (state-control/socialist) to +5 (market-reform)
//        socialLean   -5 (cosmopolitan/liberal) to +5 (traditional/nationalist)
//
// Historical basis:
//   1979: Command economy era. Deng reforms just announced but not yet felt.
//     All income groups under wage compression; university non-existent (Cultural
//     Revolution devastated gaokao); rural population ~80%+; urban = danwei work-unit
//     collectives. Market reform = minimal. Social: deeply nationalist/collective post-
//     Cultural Revolution; little cosmopolitanism. The Northeast (danwei heavy industry)
//     is the most "modern" region — meaning the most organised around state structures.
//
//   1991: After Tiananmen (1989), conservative CCP backlash, but Deng's southern tour
//     (1992) is imminent. Coastal SEZs (Shenzhen, Zhuhai) are visible exceptions to
//     the command economy. University attainment tiny but growing. SOEs still dominant.
//     Social: post-Tiananmen nationalist consolidation.
//
//   1999: Zhu Rongji's SOE reform tears apart Northeast danwei system. Coastal private
//     sector (Zhejiang TVEs, Guangdong factories) powerfully pro-market. University
//     massification just launched (1999 enrollment expansion). WTO accession imminent.
//     Interior still heavily rural/state-dependent. Social: market optimism but also
//     rising nationalism (NATO Belgrade embassy bombing 1999).
//
//   2007: WTO boom peak. Coastal entrepreneurs most market-positive of any era.
//     Migrant workers give the coastal economy cheap labor; interior labor-export.
//     Graduate expansion producing an educated urban class with aspirations.
//     Social: peak "harmonious society" nationalism; Hu era controlled openness.
//
//   2019: Xi era re-centralisation. State sector reassertion; private sector
//     "red line" constraints beginning. Internet economy under regulation.
//     But the coastal/interior divide persists — HD/HN still more market-positive
//     than interior. Social: Xi nationalism is strong everywhere; HK protests;
//     surveillance technology normalised. Cosmopolitan tolerance reduced vs 2007.
//
//   2023: Property bust, graduate unemployment, COVID hangover. Youth disillusionment
//     with market economy ("lying flat", "let it rot"). Party consolidation
//     continues. Entrepreneur confidence shaken (Didi, Ant Group crackdowns).
//     Social: nationalism at peak; US decoupling framing; Taiwan tension.

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

const POSITIONS_1953: EraPositions = {
  // 1953 PRC — First Five-Year Plan; land reform complete; state collectivisation beginning.
  // Politics = Party alignment; all signals compressed toward collectivist/nationalist.
  // Minorities suppressed; economy purely state-directed.
  ethnicity: {
    han: { economicLean: -2.0, socialLean: 2.0 }, // Mass collectivisation; nationalist Party line
    zhuang: { economicLean: -2.5, socialLean: 2.5 }, // Minority + subsistence agriculture
    hui: { economicLean: -2.0, socialLean: 3.0 }, // Traditional Muslim community; state pressure
    uyghur: { economicLean: -2.5, socialLean: 3.5 }, // Early PRC; cultural suppression beginning
    tibetan: { economicLean: -3.0, socialLean: 4.0 }, // 1950 annexation; traditional, state-opposed
    other_minority: { economicLean: -2.0, socialLean: 2.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: 1.5 }, // New China youth; Party enthusiasts
    mid: { economicLean: -2.0, socialLean: 2.0 }, // Land reform generation; collectivist
    mature: { economicLean: -2.5, socialLean: 2.5 }, // Pre-Liberation generation; Party formation
    senior: { economicLean: -3.0, socialLean: 3.0 }, // Republican-era survivors; conservative
  },
  education: {
    primary_or_below: { economicLean: -2.5, socialLean: 2.5 }, // Peasants; collectivisation subjects
    secondary: { economicLean: -1.5, socialLean: 1.5 }, // Literate workers; Party cadres
    vocational: { economicLean: -1.0, socialLean: 1.0 }, // Technical workers; planning economy
    university: { economicLean: -0.5, socialLean: 0.5 }, // Tiny intellectual class; mixed
  },
  income: {
    low: { economicLean: -3.0, socialLean: 2.5 }, // Rural peasantry; collectivisation
    middle: { economicLean: -2.0, socialLean: 2.0 }, // Urban workers; danwei units
    high: { economicLean: -1.0, socialLean: 1.5 }, // Senior cadres/technicians; pragmatic
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: 1.5 }, // Industrial cities; Party urban base
    suburban: { economicLean: -2.0, socialLean: 2.0 },
    rural: { economicLean: -3.0, socialLean: 3.0 }, // Agricultural collectives; most of population
  },
};

const POSITIONS_1979: EraPositions = {
  ethnicity: {
    // 1979: ethnic identity drives social traditionalism; econ is uniformly state-controlled
    han: { economicLean: -1.0, socialLean: 1.5 }, // Han nationalism, collectivist state
    zhuang: { economicLean: -1.5, socialLean: 2.0 }, // Minority + rural = more state-dependent
    hui: { economicLean: -1.0, socialLean: 2.5 }, // Traditional religious community
    uyghur: { economicLean: -1.5, socialLean: 3.0 }, // Post-Cultural Revolution suppression, traditional
    tibetan: { economicLean: -2.0, socialLean: 3.5 }, // Deeply traditional, state-opposed but economically left
    other_minority: { economicLean: -1.5, socialLean: 2.0 },
  },
  age: {
    // 1979: age structures reflect Cultural Revolution cohorts
    young: { economicLean: -0.5, socialLean: 0.5 }, // born after CR; idealistic but still state-framed
    mid: { economicLean: -1.0, socialLean: 1.0 }, // CR generation: work-unit/collective identity
    mature: { economicLean: -1.5, socialLean: 2.0 }, // Pre-Liberation generation; strongest state traditionalism
    senior: { economicLean: -2.0, socialLean: 2.5 }, // Old guard; Maoist-era formation
  },
  education: {
    // 1979: education devastated by CR; university near-zero; gaokao restored 1977
    primary_or_below: { economicLean: -2.0, socialLean: 2.0 }, // Rural/illiterate = state-dependent + traditional
    secondary: { economicLean: -1.5, socialLean: 1.5 }, // Workers' propaganda-educated
    vocational: { economicLean: -1.0, socialLean: 1.0 }, // Technical trained; slightly pragmatic
    university: { economicLean: -0.5, socialLean: 0.0 }, // Tiny elite; first gaokao cohort; pragmatic reformers
  },
  income: {
    // 1979: wage compression; danwei income differences are small
    low: { economicLean: -2.0, socialLean: 1.5 }, // Rural poor; collectivist dependence
    middle: { economicLean: -1.5, socialLean: 1.5 }, // Danwei workers; state-provided security
    high: { economicLean: -0.5, socialLean: 1.5 }, // Senior officials/technicians; pragmatic reform interest
  },
  urbanization: {
    // 1979: urban = danwei state employer; rural = commune
    urban: { economicLean: -1.0, socialLean: 1.0 }, // Danwei collectivist; slightly more modernised social
    suburban: { economicLean: -1.5, socialLean: 1.5 },
    rural: { economicLean: -2.0, socialLean: 2.5 }, // Commune system; most state-dependent + traditional
  },
};

const POSITIONS_1991: EraPositions = {
  ethnicity: {
    han: { economicLean: -0.5, socialLean: 2.0 }, // Post-Tiananmen nationalism surge
    zhuang: { economicLean: -1.5, socialLean: 2.0 },
    hui: { economicLean: -1.0, socialLean: 2.5 },
    uyghur: { economicLean: -1.5, socialLean: 2.5 },
    tibetan: { economicLean: -2.0, socialLean: 3.0 },
    other_minority: { economicLean: -1.5, socialLean: 2.0 },
  },
  age: {
    young: { economicLean: 0.0, socialLean: 1.0 }, // Post-1989 generation; cautious reform aspirations
    mid: { economicLean: -0.5, socialLean: 1.5 },
    mature: { economicLean: -1.0, socialLean: 2.0 },
    senior: { economicLean: -1.5, socialLean: 2.5 },
  },
  education: {
    primary_or_below: { economicLean: -2.0, socialLean: 2.0 },
    secondary: { economicLean: -1.0, socialLean: 1.5 },
    vocational: { economicLean: 0.0, socialLean: 1.0 }, // TVE workers seeing private market
    university: { economicLean: 0.5, socialLean: 0.5 }, // Reform-minded technocrats
  },
  income: {
    low: { economicLean: -2.0, socialLean: 1.5 },
    middle: { economicLean: -1.0, socialLean: 1.5 },
    high: { economicLean: 0.5, socialLean: 1.5 }, // SEZ winners emerging; pro-market
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: 1.5 },
    suburban: { economicLean: -1.0, socialLean: 1.5 },
    rural: { economicLean: -2.0, socialLean: 2.5 },
  },
};

const POSITIONS_1999: EraPositions = {
  ethnicity: {
    han: { economicLean: 0.5, socialLean: 2.5 }, // Nationalist surge (Belgrade embassy bombing)
    zhuang: { economicLean: -1.0, socialLean: 2.0 },
    hui: { economicLean: -1.0, socialLean: 2.5 },
    uyghur: { economicLean: -1.5, socialLean: 2.0 },
    tibetan: { economicLean: -2.0, socialLean: 3.0 },
    other_minority: { economicLean: -1.0, socialLean: 2.0 },
  },
  age: {
    young: { economicLean: 1.0, socialLean: 1.5 }, // Post-SOE reform generation; market-aspiring
    mid: { economicLean: 0.0, socialLean: 2.0 }, // SOE-restructuring victims / survivors mixed
    mature: { economicLean: -0.5, socialLean: 2.5 }, // Xiagang workers — bitter about reform
    senior: { economicLean: -1.5, socialLean: 3.0 }, // Maoist-era pensioners; state-dependent
  },
  education: {
    primary_or_below: { economicLean: -2.0, socialLean: 2.5 },
    secondary: { economicLean: -0.5, socialLean: 2.0 },
    vocational: { economicLean: 1.0, socialLean: 1.5 }, // TVE/private-sector skilled workers
    university: { economicLean: 1.5, socialLean: 1.0 }, // Reform beneficiaries; WTO optimism
  },
  income: {
    low: { economicLean: -2.0, socialLean: 2.0 }, // Xiagang casualties; rural poor
    middle: { economicLean: 0.0, socialLean: 2.0 },
    high: { economicLean: 2.0, socialLean: 1.5 }, // Private-sector winners; WTO boom
  },
  urbanization: {
    urban: { economicLean: 0.5, socialLean: 1.5 }, // City private economy visible
    suburban: { economicLean: -0.5, socialLean: 2.0 },
    rural: { economicLean: -2.0, socialLean: 2.5 }, // Left behind by reform
  },
};

const POSITIONS_2007: EraPositions = {
  ethnicity: {
    han: { economicLean: 1.5, socialLean: 2.5 }, // Hu "harmonious society" nationalism + WTO pride
    zhuang: { economicLean: -0.5, socialLean: 2.0 },
    hui: { economicLean: -0.5, socialLean: 2.5 },
    uyghur: { economicLean: -1.0, socialLean: 2.0 }, // Pre-2008/2009 tensions building
    tibetan: { economicLean: -1.5, socialLean: 3.0 }, // Pre-2008 Tibet protests
    other_minority: { economicLean: -0.5, socialLean: 2.0 },
  },
  age: {
    young: { economicLean: 2.0, socialLean: 1.5 }, // WTO generation; export-economy beneficiaries
    mid: { economicLean: 1.0, socialLean: 2.0 },
    mature: { economicLean: 0.0, socialLean: 2.5 }, // Mix of SOE survivors and private sector
    senior: { economicLean: -1.0, socialLean: 3.0 },
  },
  education: {
    primary_or_below: { economicLean: -2.0, socialLean: 2.5 },
    secondary: { economicLean: 0.5, socialLean: 2.0 },
    vocational: { economicLean: 1.5, socialLean: 1.5 }, // Factory floor WTO boom
    university: { economicLean: 2.5, socialLean: 1.0 }, // Peak market-reform enthusiasm
  },
  income: {
    low: { economicLean: -1.5, socialLean: 2.0 },
    middle: { economicLean: 1.0, socialLean: 2.0 },
    high: { economicLean: 3.0, socialLean: 1.5 }, // Entrepreneurs at peak market optimism
  },
  urbanization: {
    urban: { economicLean: 2.0, socialLean: 1.5 }, // Coastal cities = market triumphalism
    suburban: { economicLean: 0.5, socialLean: 2.0 },
    rural: { economicLean: -1.5, socialLean: 3.0 }, // Still left behind; state subsidy-dependent
  },
};

const POSITIONS_2019: EraPositions = {
  ethnicity: {
    // Xi-era nationalism; Uyghur/Tibetan under strong state control; Han nationalism peak
    han: { economicLean: 1.0, socialLean: 3.0 }, // Market with CCP guardrails; strong nationalist
    zhuang: { economicLean: -0.5, socialLean: 2.5 },
    hui: { economicLean: -1.0, socialLean: 2.5 },
    uyghur: { economicLean: -2.0, socialLean: 2.0 }, // Xinjiang crackdown era
    tibetan: { economicLean: -2.0, socialLean: 2.5 },
    other_minority: { economicLean: -0.5, socialLean: 2.5 },
  },
  age: {
    young: { economicLean: 1.5, socialLean: 1.5 }, // Urban graduates; market aspiration + nationalism
    mid: { economicLean: 0.5, socialLean: 2.5 },
    mature: { economicLean: 0.0, socialLean: 3.0 }, // SOE-era formation; stability-preferring
    senior: { economicLean: -1.0, socialLean: 3.5 }, // Maoist-formed; state-protective
  },
  education: {
    primary_or_below: { economicLean: -2.0, socialLean: 3.5 }, // Rural poor; nationalist + state-dependent
    secondary: { economicLean: 0.0, socialLean: 3.0 },
    vocational: { economicLean: 1.0, socialLean: 2.5 }, // Factory workers; market exposure
    university: { economicLean: 2.0, socialLean: 2.0 }, // Graduates; market-positive; also nationalist
  },
  income: {
    low: { economicLean: -1.5, socialLean: 3.0 }, // State-dependent poor; nationalist mobilised
    middle: { economicLean: 0.5, socialLean: 2.5 },
    high: { economicLean: 2.5, socialLean: 2.0 }, // Private sector; market-positive but cautious (crackdowns)
  },
  urbanization: {
    urban: { economicLean: 1.5, socialLean: 2.0 }, // Coastal cities: market exposure; also party discipline
    suburban: { economicLean: 0.0, socialLean: 2.5 },
    rural: { economicLean: -1.5, socialLean: 3.5 }, // Rural nationalist + state-dependent
  },
};

const POSITIONS_2023: EraPositions = {
  ethnicity: {
    han: { economicLean: 0.5, socialLean: 3.5 }, // Peak Xi nationalism; "wolf warrior" era
    zhuang: { economicLean: -0.5, socialLean: 2.5 },
    hui: { economicLean: -1.0, socialLean: 2.5 },
    uyghur: { economicLean: -2.5, socialLean: 2.0 },
    tibetan: { economicLean: -2.0, socialLean: 2.5 },
    other_minority: { economicLean: -0.5, socialLean: 2.5 },
  },
  age: {
    young: { economicLean: 0.5, socialLean: 2.0 }, // "Lying flat" + graduate unemployment disillusionment
    mid: { economicLean: 0.0, socialLean: 3.0 },
    mature: { economicLean: -0.5, socialLean: 3.0 },
    senior: { economicLean: -1.0, socialLean: 3.5 },
  },
  education: {
    primary_or_below: { economicLean: -2.0, socialLean: 3.5 },
    secondary: { economicLean: -0.5, socialLean: 3.0 },
    vocational: { economicLean: 0.5, socialLean: 2.5 },
    university: { economicLean: 1.0, socialLean: 2.5 }, // Graduate unemployment erodes market optimism
  },
  income: {
    low: { economicLean: -2.0, socialLean: 3.0 },
    middle: { economicLean: -0.5, socialLean: 2.5 }, // Property bust hit middle class hard
    high: { economicLean: 1.5, socialLean: 2.5 }, // Entrepreneur caution after crackdowns
  },
  urbanization: {
    urban: { economicLean: 0.5, socialLean: 2.5 },
    suburban: { economicLean: -0.5, socialLean: 3.0 },
    rural: { economicLean: -1.5, socialLean: 3.5 },
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
// CNRegionLayer1 is already Record<dim, Record<key, number>> — reindex.

function convertCensus(
  raw: Record<string, CNRegionLayer1>
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

const ERA_CENSUS: Record<EraId, Record<string, CNRegionLayer1>> = {
  "1953": cnRegionCensusData1953,
  "1979": cnRegionCensusData1979,
  "1991": cnRegionCensusData1991,
  "1999": cnRegionCensusData1999,
  "2007": cnRegionCensusData2007,
  "2019": cnRegionCensusData, // 2020 NBS base, used for 2019 era
  "2023": cnRegionCensusData2023,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getCnModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era]);
  const positions = ERA_POSITIONS[era];

  return {
    countryId: "CN",
    categoryId: "cn_voterGroups",
    groupIds: [...CN_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

// ── Backwards-compat export (2019 era, single model) ─────────────────────────

export const cnLayer1Model: CountryLayer1Model = getCnModel("2019");
export const cnGroupIds = [...CN_GROUP_IDS];
