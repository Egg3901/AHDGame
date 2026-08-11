/**
 * Brazil Layer-1 demographic model — census-consuming build.
 *
 * Architecture:
 *   - dims: ["ethnicity","age","education","income","urbanization"]
 *   - census: real per-region IBGE data from brRegionCensusData*.ts
 *   - composition: maps each of the 8 BR archetypes to census dim/key weights
 *   - positions: per-era, reflecting documented Brazilian political history
 *     (1979 = late military dictatorship / abertura, 1991 = early PT/PSDB era,
 *      1999 = Cardoso Plano Real, 2007 = Lula commodity boom,
 *      2019 = Bolsonaro realignment, 2023 = Lula return + polarization)
 *   - region/archetype leans EMERGE from census × positions — never hand-calibrated
 *
 * 1979 CAVEAT: Brazil was under military dictatorship until 1985; the first
 * direct presidential election was in 1989. The 1979 positions model the
 * late-regime / abertura context, not a competitive democratic election. Leans
 * are modest and should be read as attitudinal tendencies during the transition,
 * NOT as electoral outcomes.
 *
 * Era-fact anchors validated in br.test.ts:
 *   1999: NORDESTE economically LEFT vs SUL economically RIGHT (nascent PT base)
 *   2007: NORDESTE strongly LEFT (Bolsa Família / Lula peak); CENTRO_OESTE RIGHT
 *   2019: NORDESTE strongly LEFT; SUL + CENTRO_OESTE strongly RIGHT (Bolsonaro)
 *   2023: NORDESTE LEFT; SUL RIGHT (confirmed — Lula 2022 vs Bolsonaro mirror)
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { brRegionCensusData } from "@/lib/seeds/br/brRegionCensusData";
import { brRegionCensusData1953 } from "@/lib/seeds/br/brRegionCensusData1953";
import { brRegionCensusData1979 } from "@/lib/seeds/br/brRegionCensusData1979";
import { brRegionCensusData1991 } from "@/lib/seeds/br/brRegionCensusData1991";
import { brRegionCensusData1999 } from "@/lib/seeds/br/brRegionCensusData1999";
import { brRegionCensusData2007 } from "@/lib/seeds/br/brRegionCensusData2007";
import { brRegionCensusData2023 } from "@/lib/seeds/br/brRegionCensusData2023";
import type { BRRegionLayer1 } from "@/lib/seeds/br/brRegionCensusData";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Constants ─────────────────────────────────────────────────────────────────

export const BR_GROUP_IDS = [
  "evangelical_conservative",
  "working_class_pt",
  "rural_agribusiness",
  "urban_middle_class",
  "urban_poor",
  "afro_brazilian",
  "business_financial",
  "young_progressive",
] as const;

type GroupId = (typeof BR_GROUP_IDS)[number];

// ── Turnout rates (per census dim/key) ────────────────────────────────────────
// Brazil has compulsory voting (Lei 9.504/1997; obligation existed under the 1988
// Constitution and precursors). TSE averages: ~79% in 2022, ~79% in 2018.
// Turnout is high but not uniform — the young and rural poor show more abstention.
// 1979 rates are lower because there were no direct presidential elections and
// voter registration was incomplete under the regime.

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: {
    // Ethnicity itself is not a strong turnout predictor once income/education are
    // controlled. Minor differentials reflect registration and access barriers.
    branco: 78,
    pardo: 76,
    preto: 72,
    amarelo: 74,
    indigena: 60, // Remote communities; lower TSE registration penetration
  },
  age: {
    young: 68, // 18-29: compulsory but abstention is highest here
    mid: 80, // 30-44: peak civic engagement
    mature: 82, // 45-64
    senior: 78, // 65+: compulsory lifted at 70; still participates
  },
  education: {
    fundamental: 74, // Compulsory; lower registration quality historically
    medio: 80,
    superior: 86, // Graduates have highest compliance with compulsory rule
  },
  income: {
    low: 72, // Transport/work barriers offset the compulsory obligation
    middle: 81,
    high: 86,
  },
  urbanization: {
    urban: 80,
    suburban: 79,
    rural: 70, // Distance to polling stations; historically lower registration
  },
};

// ── Composition: archetype ← census dims ──────────────────────────────────────
// Weights are era-stable: they capture the defining census signals of each
// attitudinal group, not their vote share (that emerges from positions × census).
//
// Census dims available: ethnicity, age, education, income, urbanization.
// Note: evangelical religion is NOT a direct BRRegionLayer1 dim; its effect is
// proxied via urbanization (pentecostalism concentrated in urban periphery +
// frontier Norte/CO), income (low-to-middle), and age (younger converts).

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  /**
   * Evangelical Conservative:
   * Pentecostal/evangelical church networks; urban periphery and frontier Norte.
   * Low-to-middle income, low education, urban (favelas, periferias), mixed age.
   * Proxy for evangelical growth via urban + low income + low education weights.
   */
  evangelical_conservative: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "education", key: "fundamental", w: 0.2 },
      { dim: "age", key: "mid", w: 0.1 },
      // Regional racial mix: evangelical congregations mirror the local
      // population — whiter in the Sul, more pardo in the Norte/Nordeste.
      { dim: "ethnicity", key: "branco", w: 0.08 },
      { dim: "ethnicity", key: "pardo", w: 0.07 },
    ],
    civicMultiplier: 1.05, // Church GOTV networks boost turnout
  },

  /**
   * Organized Labour (working_class_pt):
   * PT/CUT formal-sector workers. Mid income, medio education, urban, mid age.
   */
  working_class_pt: {
    weights: [
      { dim: "income", key: "middle", w: 0.3 },
      { dim: "education", key: "medio", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "age", key: "mid", w: 0.1 },
      // Formal-sector workforces reflect regional racial composition.
      { dim: "ethnicity", key: "branco", w: 0.1 },
      { dim: "ethnicity", key: "pardo", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },

  /**
   * Rural & Agribusiness:
   * Bancada Ruralista; soy/beef frontier (Sul, CO). Rural, low education, mixed
   * income (subsistence low + large producers high), mature/senior, predominantly
   * branco in Sul (European-descent smallholders + agribusiness).
   */
  rural_agribusiness: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.35 },
      { dim: "age", key: "mature", w: 0.15 },
      { dim: "income", key: "high", w: 0.18 },
      { dim: "education", key: "fundamental", w: 0.07 },
      { dim: "ethnicity", key: "branco", w: 0.25 }, // European-descent smallholders in Sul/RS
    ],
    civicMultiplier: 0.92,
  },

  /**
   * Urban Middle Class:
   * Anti-PT São Paulo / Belo Horizonte professionals. High education, middle-high
   * income, highly urban, mature, predominantly branco in Sul/SP.
   */
  urban_middle_class: {
    weights: [
      { dim: "education", key: "superior", w: 0.28 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "age", key: "mature", w: 0.12 },
      { dim: "ethnicity", key: "branco", w: 0.25 }, // Predominantly white in SP/Sul
    ],
    civicMultiplier: 1.0,
  },

  /**
   * Urban Poor:
   * Favela residents, informal workers, Bolsa Família recipients. Low income,
   * fundamental education, urban, young-to-mid.
   */
  urban_poor: {
    weights: [
      { dim: "income", key: "low", w: 0.35 },
      { dim: "education", key: "fundamental", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "age", key: "young", w: 0.05 },
      // Urban poverty is disproportionately pardo/preto everywhere.
      { dim: "ethnicity", key: "pardo", w: 0.15 },
      { dim: "ethnicity", key: "preto", w: 0.05 },
    ],
    civicMultiplier: 0.9,
  },

  /**
   * Afro-Brazilian Communities:
   * Quilombo descendants and Afro-Brazilian civil society. High pardo/preto share,
   * low income, low education, urban.
   */
  afro_brazilian: {
    weights: [
      { dim: "ethnicity", key: "preto", w: 0.35 },
      { dim: "ethnicity", key: "pardo", w: 0.3 },
      { dim: "income", key: "low", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.15 },
    ],
    civicMultiplier: 0.85,
  },

  /**
   * Business & Finance:
   * Paulista market liberals; investment banks, agribusiness finance.
   * High income, superior education, urban, mature.
   */
  business_financial: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "education", key: "superior", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.1 },
      { dim: "age", key: "mature", w: 0.1 },
      { dim: "ethnicity", key: "branco", w: 0.15 }, // Finance/agro capital is overwhelmingly white
    ],
    civicMultiplier: 1.05,
  },

  /**
   * Young Progressive:
   * University students, early-career urban youth; PSOL / PT / climate activism.
   * Superior education, young, urban, low-to-middle income.
   */
  young_progressive: {
    weights: [
      { dim: "age", key: "young", w: 0.4 },
      { dim: "education", key: "superior", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "income", key: "middle", w: 0.1 },
    ],
    civicMultiplier: 0.8, // Highest abstention in this group despite compulsion
  },
};

// ── Default leans (archetype priors, from brDemographicCategories.ts) ──────────

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  evangelical_conservative: { economicLean: 1, socialLean: 4 },
  working_class_pt: { economicLean: -3, socialLean: -1 },
  rural_agribusiness: { economicLean: 2, socialLean: 3 },
  urban_middle_class: { economicLean: 1, socialLean: 0 },
  urban_poor: { economicLean: -4, socialLean: -1 },
  afro_brazilian: { economicLean: -2, socialLean: -2 },
  business_financial: { economicLean: 3, socialLean: 1 },
  young_progressive: { economicLean: -2, socialLean: -3 },
};

// ── Per-era positions: how each census key leaned in that political era ─────────
//
// Scale: economicLean -5 (redistribution/left) to +5 (free market/right)
//        socialLean   -5 (progressive/liberal) to +5 (traditional/conservative)
//
// Historical basis:
//
// 1979: MILITARY DICTATORSHIP (Figueiredo regime, abertura era).
//   No competitive presidential elections; ARENA vs MDB. Low income / non-white /
//   rural = no clear democratic lean; opposition (MDB) appealed to urban educated
//   professionals and organized labour. Regime supported by high-income elites and
//   rural landlords. Positions are modest — this is attitudinal context, not votes.
//
// 1991: EARLY PT / PSDB ERA (Collor / Itamar).
//   First post-dictatorship elections (Collor 1989, defeated Lula). PT is emerging
//   as the organized-labour / urban-left party. PSDB = modernizing centre. Cardoso
//   at Finance; hyperinflation still the dominant issue. Low income ≠ automatic PT
//   yet — PT needs more cycles to build Nordeste base. Income HIGH = PDS/PPR right.
//
// 1999: CARDOSO PLANO REAL (2nd term).
//   Hyperinflation beaten; inequality near historic peak (Gini ~0.60). PT is now
//   clearly the left alternative (Lula 2nd round 1998 loss). Nordeste poor = PT-
//   leaning; São Paulo urban middle = PSDB. Rural agribusiness = centre-right.
//
// 2007: LULA COMMODITY BOOM (2nd term).
//   Bolsa Família established (2003-04); minimum wage rising; commodity supercycle.
//   PT dominates Nordeste (Bolsa Família epicenter). Income LOW now = strongly
//   economic LEFT (direct transfer dependence). Centro-Oeste agribusiness = RIGHT.
//   Urban middle growing but PT still leads Sudeste. No strong social-left turn yet.
//
// 2019: BOLSONARO REALIGNMENT.
//   Cultural / moral cleavage now rivals the economic one. Evangelical vote = right.
//   Nordeste: Haddad 72.6% (2nd round 2018) → economic LEFT. Sul: Bolsonaro ~76%
//   → economic RIGHT + social RIGHT. Centro-Oeste: Bolsonaro ~73%. Sudeste: split
//   (SP right, RJ right; MG swing). Education: superior still somewhat left
//   (PSOL/PT) but split by market liberals. Income high = right (austerity, pension
//   reform). Low income in Nordeste = left; in frontier Norte = split.
//
// 2023: LULA RETURN / POST-BOLSONARO.
//   Lula won 2022 narrowly (50.9%). Polarization entrenched. Nordeste left; Sul +
//   Centro-Oeste right; Sudeste narrowly left (SP city left, interior right).
//   Social left gaining among young urban; evangelical = still strong right.

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// ─────────────────────────────────────────────────────────────────────────────
// 1953 — VARGAS SECOND GOVERNMENT (1950–54)
// Getúlio Vargas returned by popular vote; trabalhismo/PTB left vs UDN right.
// Petrobras founded 1953 ("O petróleo é nosso"). Military right opposition
// growing. Race matters less than class; illiteracy ~52%.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_1953: EraPositions = {
  ethnicity: {
    branco: { economicLean: 1.0, socialLean: 1.0 }, // UDN elites + landowners
    pardo: { economicLean: -1.0, socialLean: 0.0 }, // Mixed working class; PTB lean
    preto: { economicLean: -2.0, socialLean: -0.5 }, // Afro-Brazilian workers; Vargas base
    amarelo: { economicLean: 0.5, socialLean: 0.0 }, // Small Asian community; business
    indigena: { economicLean: -1.5, socialLean: 0.5 }, // Marginalized; no political access
  },
  age: {
    young: { economicLean: -0.5, socialLean: -0.3 }, // Limited political engagement
    mid: { economicLean: -1.0, socialLean: 0.0 }, // Urban workers; Vargas/PTB base
    mature: { economicLean: 0.0, socialLean: 0.5 }, // Landowners/business; UDN lean
    senior: { economicLean: 0.5, socialLean: 1.0 }, // Traditional elite; conservative
  },
  education: {
    fundamental: { economicLean: -0.5, socialLean: 0.5 }, // Illiterate workers; no vote (illiterates barred!)
    medio: { economicLean: 0.0, socialLean: 0.3 }, // Lower-middle; mixed alignment
    superior: { economicLean: -0.5, socialLean: -0.5 }, // Small educated class; split UDN/PTB
  },
  income: {
    low: { economicLean: -2.0, socialLean: 0.0 }, // Working class; Vargas/PTB base
    middle: { economicLean: -0.5, socialLean: 0.5 }, // Urban middle class; mixed
    high: { economicLean: 2.5, socialLean: 1.5 }, // Elite; UDN supporters
  },
  urbanization: {
    urban: { economicLean: -1.5, socialLean: -0.3 }, // São Paulo/Rio workers; PTB lean
    suburban: { economicLean: 0.0, socialLean: 0.5 },
    rural: { economicLean: 0.5, socialLean: 2.0 }, // Coronelismo; local bosses dominate
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 1979 — LATE MILITARY DICTATORSHIP / ABERTURA
// Modest positions: legitimate democratic left/right is nascent.
// MDB = urban professional opposition; ARENA = regime support, rural elites.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_1979: EraPositions = {
  ethnicity: {
    // Race maps poorly onto the regime's cleavage; modest signals only.
    branco: { economicLean: 0.5, socialLean: 1.0 }, // Lighter-skinned elites more regime-aligned
    pardo: { economicLean: -0.5, socialLean: 0.0 },
    preto: { economicLean: -1.0, socialLean: -0.5 },
    amarelo: { economicLean: 0.0, socialLean: 0.0 },
    indigena: { economicLean: -0.5, socialLean: 0.5 }, // Marginalized; no clear political access
  },
  age: {
    young: { economicLean: -1.0, socialLean: -0.5 }, // Student opposition (UNE); amnesty movement
    mid: { economicLean: -0.5, socialLean: 0.0 }, // Organized labour — nascent PT founding
    mature: { economicLean: 0.0, socialLean: 0.5 }, // Mixed; many regime-era workers
    senior: { economicLean: 0.5, socialLean: 1.0 }, // Traditional; regime stability preferred
  },
  education: {
    // Under the dictatorship, higher education ≠ left (many technocrats supported regime).
    // But university students were the main organized opposition.
    fundamental: { economicLean: 0.0, socialLean: 0.5 }, // Rural/working class; no strong alignment
    medio: { economicLean: -0.5, socialLean: 0.0 },
    superior: { economicLean: -1.0, socialLean: -1.0 }, // Student activists; opposition professionals
  },
  income: {
    low: { economicLean: -1.0, socialLean: 0.0 }, // Class grievance present but no PT yet
    middle: { economicLean: 0.0, socialLean: 0.5 },
    high: { economicLean: 2.0, socialLean: 1.5 }, // Elite = regime support, authoritarian stability
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -0.5 }, // MDB strongholds; labour; student movement
    suburban: { economicLean: 0.0, socialLean: 0.5 },
    rural: { economicLean: 0.5, socialLean: 1.5 }, // Coronelismo; ARENA rural political machines
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 1991 — COLLOR / EARLY REDEMOCRATIZATION
// PT vs PSDB vs PPR; hyperinflation; class politics emerging but Nordeste base
// not yet consolidated. Income low ≠ strong PT lean yet.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_1991: EraPositions = {
  ethnicity: {
    // Class/race overlap already present pre-Lula: the branco Sul/Sudeste
    // middle class leaned Collor/PRN-PSDB; pardo/preto workers leaned PDT/PT.
    branco: { economicLean: 4.5, socialLean: 1.0 },
    pardo: { economicLean: -2.5, socialLean: 0.5 }, // Econ left, socially traditional — PT base not yet consolidated
    preto: { economicLean: -3.0, socialLean: 0.0 },
    amarelo: { economicLean: 0.5, socialLean: 0.0 },
    indigena: { economicLean: -5.0, socialLean: 0.5 }, // Marginalized; strongly redistributionist
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.0 }, // PT student networks forming
    mid: { economicLean: -1.0, socialLean: -0.5 }, // ABC Paulista union base
    mature: { economicLean: 0.0, socialLean: 0.5 },
    senior: { economicLean: 0.5, socialLean: 1.0 },
  },
  education: {
    fundamental: { economicLean: -1.0, socialLean: 1.0 }, // Poor + socially traditional
    medio: { economicLean: 0.5, socialLean: -0.5 },
    superior: { economicLean: 1.0, socialLean: -1.5 }, // PSDB technocrats; market modernizers
  },
  income: {
    low: { economicLean: -2.5, socialLean: 0.5 }, // Economic left but fragile — no Bolsa Família yet
    middle: { economicLean: 0.0, socialLean: 0.0 },
    high: { economicLean: 4.0, socialLean: 1.5 }, // PSDB/PPR; fiscal austerity; privatisation
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -0.5 }, // Industrial PT base; ABC Paulista
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 1.0, socialLean: 1.5 }, // Rural oligarchies; PDS/PPR machines
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 1999 — CARDOSO PLANO REAL (2nd term)
// Lula lost 1998 (2nd round). PT base = urban industrial + emerging Nordeste.
// PSDB = urban middle class. FHC coalition = centre-right on economy, modernising.
// Nordeste poor increasingly PT-leaning; Sul + Centro-Oeste = PSDB or right.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_1999: EraPositions = {
  ethnicity: {
    // Class/race overlap sharpening as the PT's Nordeste base consolidates:
    // branco Sul/Sudeste middle class = PSDB/FHC; pardo/preto poor = PT-leaning.
    branco: { economicLean: 3.0, socialLean: 1.5 },
    pardo: { economicLean: -3.0, socialLean: 0.0 }, // Econ left; socially traditional-neutral
    preto: { economicLean: -4.0, socialLean: -0.5 },
    amarelo: { economicLean: 0.5, socialLean: 0.0 },
    indigena: { economicLean: -2.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.5 },
    mid: { economicLean: -1.0, socialLean: -0.5 },
    mature: { economicLean: 0.0, socialLean: 0.5 },
    senior: { economicLean: 0.5, socialLean: 1.0 },
  },
  education: {
    fundamental: { economicLean: -1.5, socialLean: 1.0 }, // PT rural base; economically left, socially traditional
    medio: { economicLean: 0.0, socialLean: -0.5 },
    superior: { economicLean: 0.5, socialLean: -1.5 }, // PSDB technocrats; market reformers
  },
  income: {
    low: { economicLean: -2.5, socialLean: 0.5 }, // Economic left lean consolidating
    middle: { economicLean: 0.0, socialLean: 0.0 }, // PSDB "Middle Brazil"
    high: { economicLean: 3.5, socialLean: 1.5 },
  },
  urbanization: {
    urban: { economicLean: -1.0, socialLean: -0.5 },
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 1.5, socialLean: 1.5 }, // Agribusiness right; rural oligarchy
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2007 — LULA COMMODITY BOOM (2nd term)
// Bolsa Família (2003-04) fully operational. Minimum wage rising faster than
// inflation. Lula won 2006 with 61% (2nd round). Nordeste = strongly left.
// Centro-Oeste agribusiness boom → economic RIGHT. Sul = PT losing ground.
// Social cleavage not yet the dominant axis; class / redistribution dominant.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_2007: EraPositions = {
  ethnicity: {
    // Class + race overlap: the 2006 Lula coalition was strongest among
    // pardo/preto voters; branco Sul/SP professionals leaned Alckmin/PSDB.
    branco: { economicLean: 3.5, socialLean: 2.0 }, // PSDB/Alckmin base in Sul/SP
    // Social axis: the 2006 Lula vote among pardo/preto Nordestinos was
    // economically left but NOT socially progressive — mildly traditional.
    pardo: { economicLean: -4.0, socialLean: -0.5 },
    preto: { economicLean: -4.5, socialLean: -1.0 },
    amarelo: { economicLean: 0.5, socialLean: 0.0 },
    indigena: { economicLean: -2.5, socialLean: -0.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -1.5 },
    mid: { economicLean: -1.0, socialLean: -0.5 },
    mature: { economicLean: 0.5, socialLean: 0.5 },
    senior: { economicLean: 0.5, socialLean: 1.0 },
  },
  education: {
    fundamental: { economicLean: -2.5, socialLean: 1.0 }, // Bolsa Família / PT welfare direct link; socially traditional
    medio: { economicLean: 0.5, socialLean: -0.5 },
    superior: { economicLean: 1.5, socialLean: -1.0 }, // Urban professional; strong PSDB pull
  },
  income: {
    low: { economicLean: -3.5, socialLean: 0.0 }, // Bolsa Família = strong left economic alignment
    middle: { economicLean: 0.0, socialLean: 0.0 }, // "Classe C" emerging; split Lula/PSDB
    high: { economicLean: 4.0, socialLean: 2.0 }, // Agribusiness + finance = right
  },
  urbanization: {
    urban: { economicLean: -0.5, socialLean: 0.0 },
    suburban: { economicLean: 0.5, socialLean: 0.5 },
    rural: { economicLean: 2.5, socialLean: 2.0 }, // Agribusiness frontier = right
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2019 — BOLSONARO REALIGNMENT
// Cultural / moral / security cleavage now matches the economic one.
// Bolsonaro won 2018 (55.1% 2nd round). Haddad (PT) won Nordeste 72.6%.
//
// Education note: in Brazil, `fundamental` education (≤8 years) is the majority
// of voters and is a HETEROGENEOUS group. In the NORDESTE, low-education voters
// are Bolsa Família recipients who voted overwhelmingly for Haddad on economic
// grounds. In the Sul/CO frontier, low-education workers are evangelical and
// voted Bolsonaro. Education alone cannot resolve this — income + urbanization
// are the key discriminating dims. We therefore set `fundamental.socialLean`
// modestly: it is traditional (positive) but not extreme, because the Nordeste
// poor are traditional on family matters but NOT the evangelical-right bloc.
// The evangelical signal emerges more strongly from urbanization.suburban
// (periferias with church networks) and income.low in high-urban frontier regions.
//
// Income LOW is STRONGLY economic-left (Bolsa Família dependent = direct economic
// stake in redistribution). This is the primary axis for the Nordeste result.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_2019: EraPositions = {
  ethnicity: {
    // In 2019, ethnicity maps directly onto the Bolsonaro/Haddad split.
    // Branco (72% SUL, 25% NORDESTE) = Bolsonaro base — economic AND social right.
    // Pardo (64% NORDESTE, 18% SUL) = Haddad/PT — economic and social LEFT.
    // This dim is the primary regional differentiator between NORDESTE and SUL.
    branco: { economicLean: 3.0, socialLean: 2.5 }, // Sul/SP branco = Bolsonaro — strongly right both axes
    pardo: { economicLean: -4.5, socialLean: -1.0 }, // Nordeste pardo = Haddad/PT — strongly econ left
    preto: { economicLean: -5.0, socialLean: -1.5 }, // Strongest anti-Bolsonaro group
    amarelo: { economicLean: 1.0, socialLean: 0.5 },
    indigena: { economicLean: -2.5, socialLean: -1.0 },
  },
  age: {
    // NORDESTE elders lean PT on economics (pension/transfer dependence);
    // not the Bolsonaro evangelical bloc. Moderate social lean.
    young: { economicLean: -2.0, socialLean: -2.5 },
    mid: { economicLean: 0.5, socialLean: 0.5 },
    mature: { economicLean: 0.5, socialLean: 1.0 }, // Less economic-right: NORDESTE mature = PT dependent
    senior: { economicLean: 0.0, socialLean: 1.0 }, // NORDESTE seniors = PT pensioners
  },
  education: {
    // fundamental: Econ left (transfer dependence dominant nationally).
    // Ethnicity dim (branco vs pardo) handles the SUL/NORDESTE split.
    fundamental: { economicLean: -1.5, socialLean: 1.0 }, // Econ left (transfers); mild social traditional
    medio: { economicLean: 0.0, socialLean: 1.0 }, // Split; modest social right
    superior: { economicLean: -1.0, socialLean: -2.0 }, // University left; PSOL/PT
  },
  income: {
    // Income is the secondary economic discriminator (ethnicity is primary).
    low: { economicLean: -3.5, socialLean: 0.0 }, // Transfer dependence = strong econ left
    middle: { economicLean: 1.5, socialLean: 0.5 }, // "Classe C" went to Bolsonaro
    high: { economicLean: 4.0, socialLean: 1.5 }, // Finance + agribusiness
  },
  urbanization: {
    // Brazil 2019: São Paulo (largest urban area) voted 53% Bolsonaro. Urban ≠ left.
    // Brazilian cities are polarized by class/race/education within them; the
    // urban aggregate is near-neutral economically. Income dims capture within-city split.
    // Social lean: slightly positive (Brazilian urbanism is NOT socially progressive
    // in the European/US sense — evangelical culture is concentrated in urban periphery).
    urban: { economicLean: 0.0, socialLean: 0.5 }, // Urban = mixed; SP voted Bolsonaro
    suburban: { economicLean: 2.0, socialLean: 2.5 }, // Evangelical suburbs + gated communities → Bolsonaro
    rural: { economicLean: 3.0, socialLean: 3.5 }, // Agribusiness + evangelical interior = strongly right
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2023 — LULA RETURN / ENTRENCHED POLARIZATION
// Lula won 2022 narrowly (50.9%). Nordeste confirmed left; Sul/CO confirmed right.
// Sudeste narrowly left (SP capital left, interior right). Evangelical still right.
// Social lean gap widened: young progressive vs mature evangelical.
//
// Same note as 2019 on education.fundamental: Nordeste poor voted Lula on
// economic grounds (Auxílio Brasil / transfers). Economic left signal dominates
// the social traditional signal in the display lean for Nordeste.
// SUL/CO: rural + suburban signal is both economically AND socially right.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_2023: EraPositions = {
  ethnicity: {
    // 2022 result mirrors 2019. Pardo was the decisive bloc for Lula.
    // 2022 result mirrors 2019. Pardo national plurality voted Lula.
    branco: { economicLean: 3.5, socialLean: 3.0 },
    pardo: { economicLean: -4.5, socialLean: -1.0 }, // Pardo voted Lula on economic redistribution grounds
    preto: { economicLean: -4.5, socialLean: -1.5 }, // Strongest pro-Lula group
    amarelo: { economicLean: 1.0, socialLean: 0.5 },
    indigena: { economicLean: -2.5, socialLean: -1.0 },
  },
  age: {
    // Same moderation as 2019: NORDESTE elders lean PT (pensions/transfers).
    young: { economicLean: -2.0, socialLean: -2.5 }, // Gen Z progressive mobilization
    mid: { economicLean: 0.5, socialLean: 0.5 },
    mature: { economicLean: 0.5, socialLean: 1.0 },
    senior: { economicLean: 0.0, socialLean: 1.0 },
  },
  education: {
    // Same note as 2019: ethnicity dim handles the NORDESTE/SUL split.
    fundamental: { economicLean: -1.5, socialLean: 1.0 },
    medio: { economicLean: 0.0, socialLean: 1.0 },
    superior: { economicLean: -1.0, socialLean: -2.5 }, // Stronger left consolidation post-2022
  },
  income: {
    low: { economicLean: -3.5, socialLean: 0.0 }, // Auxílio Brasil / transfers = strong econ left
    middle: { economicLean: 1.5, socialLean: 0.5 },
    high: { economicLean: 4.0, socialLean: 1.5 },
  },
  urbanization: {
    // Same as 2019: Brazilian cities are NOT socially progressive in aggregate.
    urban: { economicLean: 0.0, socialLean: 0.5 },
    suburban: { economicLean: 2.0, socialLean: 2.5 },
    rural: { economicLean: 3.0, socialLean: 3.5 }, // Agribusiness + evangelical rural = strongly right both axes
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

// ── Census conversion ──────────────────────────────────────────────────────────
// BRRegionLayer1 → Record<dim, Record<key, number>>

function convertCensus(
  raw: Record<string, BRRegionLayer1>
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

const ERA_CENSUS: Record<EraId, Record<string, BRRegionLayer1>> = {
  "1953": brRegionCensusData1953,
  "1979": brRegionCensusData1979,
  "1991": brRegionCensusData1991,
  "1999": brRegionCensusData1999,
  "2007": brRegionCensusData2007,
  "2019": brRegionCensusData, // 2019 base (IBGE Censo 2022 estimates)
  "2023": brRegionCensusData2023,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getBrModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era]);
  const positions = ERA_POSITIONS[era];

  return {
    countryId: "BR",
    categoryId: "br_voterGroups",
    groupIds: [...BR_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

// ── Backwards-compat export (2019 era, single model) ──────────────────────────

export const brLayer1Model: CountryLayer1Model = getBrModel("2019");
export const brGroupIds = [...BR_GROUP_IDS];
