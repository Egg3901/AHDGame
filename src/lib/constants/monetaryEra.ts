/**
 * Historical monetary calibration preserves authored start-year values and
 * interpolates reference rates between them. getEraMonetaryBaseline uses the
 * current game year; modern worlds and missing dates retain their fallbacks.
 */

import type { CountryId } from "./countries";
import { MONETARY_BASELINES, type MonetaryBaseline } from "./currencies";
import { interpolateMonetaryCalibration } from "@/lib/currency/rules/monetaryCalibration";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { RU_ECONOMY } from "@/lib/countries/ru/economy";
import { DD_ECONOMY } from "@/lib/countries/dd/economy";
import { NG_ECONOMY } from "@/lib/countries/ng/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";
import { FR_ECONOMY } from "@/lib/countries/fr/economy";
import { IT_ECONOMY } from "@/lib/countries/it/economy";
import { ES_ECONOMY } from "@/lib/countries/es/economy";
import { SE_ECONOMY } from "@/lib/countries/se/economy";
import { TR_ECONOMY } from "@/lib/countries/tr/economy";
import { GR_ECONOMY } from "@/lib/countries/gr/economy";
import { AT_ECONOMY } from "@/lib/countries/at/economy";
import { FI_ECONOMY } from "@/lib/countries/fi/economy";
import { PL_ECONOMY } from "@/lib/countries/pl/economy";
import { HU_ECONOMY } from "@/lib/countries/hu/economy";
import { RO_ECONOMY } from "@/lib/countries/ro/economy";
import { YU_ECONOMY } from "@/lib/countries/yu/economy";
import { BG_ECONOMY } from "@/lib/countries/bg/economy";
import { CS_ECONOMY } from "@/lib/countries/cs/economy";
import { BLR_ECONOMY } from "@/lib/countries/blr/economy";
import { UKR_ECONOMY } from "@/lib/countries/ukr/economy";
import { BAL_ECONOMY } from "@/lib/countries/bal/economy";

export interface EraMonetaryBaseline extends MonetaryBaseline {
  /**
   * Structural real GDP growth (annual %) the engine assumes for countries
   * without national metric dynamics. Omit for fully-simulated countries —
   * their growth comes from the metric engine.
   */
  trendGdpGrowth?: number;
}

/**
 * 1953 monetary anchors. Historical references (annual, ~1952-1955):
 * discount/bank rates from the respective central banks; CPI from national
 * statistical series. Values are gameplay-rounded.
 */
export const MONETARY_BASELINES_1953: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  // Bank of Japan discount ~5.8%; post-Korean-War CPI spike cooling toward
  // low single digits by 1955; reconstruction boom (growth authored in the
  // JP 1953 metric presets).
  JP: JP_ECONOMY.monetary.byEra["1953"],
  // Bank deutscher Länder discount 3.5%; Wirtschaftswunder price stability
  // (CPI ~ -1.7 to +2%).
  DE: DE_ECONOMY.monetary.byEra["1953"],
  // Colonial Nigeria on the sterling peg — imported UK price stability
  // (modern table's 6%/12% is the post-independence naira regime).
  NG: NG_ECONOMY.monetary.byEra["1953"],
  // BR targetInflation is a POLICY target (Taylor rule + CPI attractor + FX
  // deviation baseline), not realized Vargas CPI. Authoring 10% here because
  // 1953 Brazil *experienced* ~10-20% made the NPP/FOMC chair treat 10% as
  // fine and, with the era-blind 6% FX absolute-penalty ceiling, structurally
  // depreciated BRL even on-target (ticket 1124). Do not put this back.
  BR: BR_ECONOMY.monetary.byEra["1953"],
  // Administered prices with annual state retail price cuts; Gosbank
  // administrative rates. trendGdpGrowth matches the authored RU 1953
  // overlay ("economic.gdpGrowth": 6.0 in ruMetricPresets1953).
  RU: RU_ECONOMY.monetary.byEra["1953"],
  // Pinay stabilization: CPI ~ -2 to +1% in 1953; Banque de France discount
  // 4%; Trente Glorieuses trend growth.
  FR: FR_ECONOMY.monetary.byEra["1953"],
  // CPI ~2%; miracolo economico takeoff.
  IT: IT_ECONOMY.monetary.byEra["1953"],
  // Autarky-era Spain: moderate but bumpy inflation, pre-1959 Stabilization
  // Plan.
  ES: ES_ECONOMY.monetary.byEra["1953"],
  // CPI ~1%; Riksbank discount 2.75-3%.
  SE: SE_ECONOMY.monetary.byEra["1953"],
  // Post-reparation Finland: FY1953 budget seeds CPI at 2% ("stabilisation
  // after the 1950-51 inflation wave"). Without this row FI falls through to
  // MONETARY_BASELINES.FI (6.0/8.5, late-1970s markka devaluation cycle) for
  // the whole 1953-1970 span — the same wrong-era attractor bug this table
  // exists to cure. trendGdpGrowth is the layer-1 fallback (FI is not in
  // NATIONAL_SCOPE); the 1% seed gdpGrowth is the 1953 recession starting
  // point, not the structural rate.
  FI: FI_ECONOMY.monetary.byEra["1953"],
  // Menderes boom: strong growth with inflation building through the
  // mid-1950s (far from the 1979 crisis' 20%).
  TR: TR_ECONOMY.monetary.byEra["1953"],

  // ── Eastern-bloc budget-only countries (no central bank, layer-1) ─────────
  // Their inflation is recalculated only at the annual fiscal-year rollover
  // (per-turn inflationRecalc iterates central banks, which they lack), and
  // the recalc mean-reverts toward getInflationTarget(). Without era entries
  // they fell through to the modern table — notably YU's 15% ("Yugoslav
  // high-inflation", a 1990s calibration) — which is era-wrong for 1953's
  // administered/suppressed-inflation command economies. Targets match each
  // country's authored FY1953 seed inflation (makeEasternBlocBudget1953 in
  // seeds/reference/budgets.ts) so the model reverts toward the seeded value
  // instead of jumping at the first rollover; neutral rates are administered
  // Gosbank-style credit rates; trendGdpGrowth mirrors the authored plan-era
  // gdpGrowth for these metric-less countries.
  HU: HU_ECONOMY.monetary.byEra["1953"],
  PL: PL_ECONOMY.monetary.byEra["1953"],
  RO: RO_ECONOMY.monetary.byEra["1953"],
  // Tito's self-managed economy ran visibly hotter than the Cominform bloc.
  YU: YU_ECONOMY.monetary.byEra["1953"],
  BG: BG_ECONOMY.monetary.byEra["1953"],
  // Soviet-republic fictions mirror RU's administered anchors. There was no
  // republican monetary authority at all - Gosbank set one rate for the union -
  // so these three share RU's numbers and differ only on trend growth, which is
  // a real plan-output difference rather than a policy one.
  BLR: BLR_ECONOMY.monetary.byEra["1953"],
  // Ukraine grows slower than Byelorussia: a bigger, more mature industrial base
  // rebounding from a higher pre-war level, not a republic rebuilt from zero.
  UKR: UKR_ECONOMY.monetary.byEra["1953"],
  CS: CS_ECONOMY.monetary.byEra["1953"],
  BAL: BAL_ECONOMY.monetary.byEra["1953"],
  // GDR administered prices (June 1953 uprising notwithstanding).
  DD: DD_ECONOMY.monetary.byEra["1953"],
  // Post-April-1953 Markezinis stabilization: drachma pegged (30 GRD/USD, see
  // INITIAL_RATES_1953.GR in crisisTurn.ts), Bank of Greece discount ~6%, and
  // the opening years of the "Greek economic miracle" (strong reconstruction
  // growth, low single-digit CPI). GR had no 1953-era entry at all until this
  // was added, so it fell through to the MODERN global table's late-1970s
  // drachma calibration (targetInflation 15.0 / neutralPrimeRate 16.5 — see
  // `MONETARY_BASELINES.GR` in `currencies.ts`) for the entire 1953-1970 span.
  // That target sat AT the model's old 15.0 ceiling, so a 1953-default world
  // pinned GR's inflation at the cap (min=max=15.0) and its NPP chair's
  // Taylor rule found equilibrium at the wrong neutral rate (16.5%) with zero
  // inflation gap to correct — exactly the disease this module was built to
  // cure for IT/ES/TR (see the file header), just missed for GR.
  GR: GR_ECONOMY.monetary.byEra["1953"],
  // AT had no 1953 entry, so it fell through to the modern global table — whose
  // AT values are an explicitly late-1970s calibration ("hard-schilling DM
  // shadow policy", 4.0/5.5). Same fall-through that pinned GR's inflation at
  // the model cap for a whole run, and that FI's entry above already fixes.
  // Austria 1953: CPI ~0-2% under the 1951-52 Raab-Kamitz stabilization;
  // Oesterreichische Nationalbank discount 4.5%; post-Marshall-Plan
  // reconstruction growth.
  AT: AT_ECONOMY.monetary.byEra["1953"],
};

/**
 * 1979 monetary anchors. Historical references (annual, ~1978-1980):
 * US CPI 11.3% / prime ~12.7; UK RPI 13.4% / MLR 14-17; JP CPI 3.7 (8.0 in the
 * 1980 oil shock) / ODR 5.25-7.25; DE CPI 4.1 / Lombard 5.5-7; IE CPI 13.2;
 * BR ~50-77%; NG ~11.7% (oil boom); USSR administered prices with Brezhnev-era
 * stagnation growth. Values are gameplay-rounded; the inflation model caps at
 * 15, so BR is authored just below the cap to keep dynamics (targets ≥15 pin
 * min=max=15 for a whole run — the disease the 1953 table was built to cure).
 *
 * FR/IT/ES/SE/TR repeat the global table's late-1970s values verbatim — for
 * them 1979 resolution is value-identical to the pre-era-table behavior — and
 * add authored trend growth for the layer-1 growth fallback (was flat 2.5).
 */
export const MONETARY_BASELINES_1979: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  US: US_ECONOMY.monetary.byEra["1979"],
  UK: UK_ECONOMY.monetary.byEra["1979"],
  JP: JP_ECONOMY.monetary.byEra["1979"],
  DE: DE_ECONOMY.monetary.byEra["1979"],
  IE: IE_ECONOMY.monetary.byEra["1979"],
  // Military-regime "miracle" hangover: chronic high inflation, pre-hyper era.
  BR: BR_ECONOMY.monetary.byEra["1979"],
  // Oil-boom Nigeria: double-digit CPI on fiscal expansion.
  NG: NG_ECONOMY.monetary.byEra["1979"],
  // Brezhnev stagnation: administered prices (low open inflation), slowing
  // structural growth ~2-3%/yr for the metric-less RU bloc.
  RU: RU_ECONOMY.monetary.byEra["1979"],
  FR: FR_ECONOMY.monetary.byEra["1979"],
  IT: IT_ECONOMY.monetary.byEra["1979"],
  ES: ES_ECONOMY.monetary.byEra["1979"],
  SE: SE_ECONOMY.monetary.byEra["1979"],
  TR: TR_ECONOMY.monetary.byEra["1979"],
};

/**
 * 1991 monetary anchors. Historical references (annual, ~1991-1993):
 * US CPI 4.2% (→2.3 by 1997); UK RPI 5.9 (→~3 post-ERM); JP CPI 3.3 (→0.5,
 * bubble burst, ODR 4.5 falling); DE ~4 (unification spike 5.1 in '92, →1.5,
 * Bundesbank Lombard 9.25); IE 3.2; FR 3.2 (franc fort); IT 6.3 (lira crisis
 * '92); ES 5.9; SE 9.3 tax-reform spike →2.3 by '93 (krona crisis, early-90s
 * depression); CN 3.4 with the '93-94 overheating (15-24%) ahead; NG 13%
 * (→45-57% under SAP); BR and post-Soviet RU in open hyperinflation and TR at
 * ~66%/yr — all three far beyond the model's 15 cap, so they are authored
 * below it (12) to keep inflation dynamic instead of pinned at min=max=15.
 */
// Match the player reset rates so NPC policy does not undo affordable entry.
// Inflation targets and historical country provenance remain intact.
export const MONETARY_BASELINES_1991: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  US: { ...US_ECONOMY.monetary.byEra["1991"], neutralPrimeRate: 4 },
  UK: { ...UK_ECONOMY.monetary.byEra["1991"], neutralPrimeRate: 4.5 },
  JP: { ...JP_ECONOMY.monetary.byEra["1991"], neutralPrimeRate: 3 },
  DE: DE_ECONOMY.monetary.byEra["1991"],
  IE: IE_ECONOMY.monetary.byEra["1991"],
  CN: CN_ECONOMY.monetary.byEra["1991"],
  BR: BR_ECONOMY.monetary.byEra["1991"],
  NG: NG_ECONOMY.monetary.byEra["1991"],
  // Post-Soviet collapse: price liberalization (Jan '92: >2500%/yr, capped-model
  // authoring) and output contraction ~-5%/yr through the early 90s.
  RU: RU_ECONOMY.monetary.byEra["1991"],
  FR: FR_ECONOMY.monetary.byEra["1991"],
  IT: IT_ECONOMY.monetary.byEra["1991"],
  ES: ES_ECONOMY.monetary.byEra["1991"],
  // Early-90s Swedish crisis: near-zero growth, disinflation from the '91 spike.
  SE: SE_ECONOMY.monetary.byEra["1991"],
  TR: TR_ECONOMY.monetary.byEra["1991"],
};

/**
 * 1971-1978 monetary anchors — the post-Bretton-Woods, pre-Volcker decade.
 * Historical references (annual, ~1972-1978): US CPI 3.3 rising to 11.3 by 1974
 * (fed funds 4-11%); UK 7.1 rising to 24.2 in 1975 (the worst of the G7);
 * DE 5.5 (Bundesbank held the line hardest); JP 11.7 in the 1974 oil shock then
 * back to ~4; FR 7.3; IT 11.4; ES 11.4; SE 7.4; TR 20+; BR 20+ under the
 * military "miracle"; NG 13 on the oil boom. Command economies keep
 * administered prices — RU/bloc values track their 1953 posture, not the West's
 * inflation, which is the whole point of the divergence.
 */
export const MONETARY_BASELINES_1971: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  US: US_ECONOMY.monetary.byEra["1971"],
  UK: UK_ECONOMY.monetary.byEra["1971"],
  DE: DE_ECONOMY.monetary.byEra["1971"],
  JP: JP_ECONOMY.monetary.byEra["1971"],
  IE: IE_ECONOMY.monetary.byEra["1971"],
  CN: CN_ECONOMY.monetary.byEra["1971"],
  BR: BR_ECONOMY.monetary.byEra["1971"],
  NG: NG_ECONOMY.monetary.byEra["1971"],
  RU: RU_ECONOMY.monetary.byEra["1971"],
  DD: DD_ECONOMY.monetary.byEra["1971"],
  FR: FR_ECONOMY.monetary.byEra["1971"],
  IT: IT_ECONOMY.monetary.byEra["1971"],
  ES: ES_ECONOMY.monetary.byEra["1971"],
  SE: SE_ECONOMY.monetary.byEra["1971"],
  TR: TR_ECONOMY.monetary.byEra["1971"],
  HU: HU_ECONOMY.monetary.byEra["1971"],
  PL: PL_ECONOMY.monetary.byEra["1971"],
  // Pre-junta/early-junta Greece: inflation accelerated through the decade
  // (post-1973 oil shock CPI briefly spiked into the 20s before moderating),
  // averaging out gameplay-rounded to a high-but-not-yet-1979-extreme regime.
  // Without this entry GR falls through to the 1979 table's 15.0/16.5 a
  // decade early — the same "wrong-era anchor" bug this table exists to fix
  // for its other members.
  GR: GR_ECONOMY.monetary.byEra["1971"],
};

/**
 * First calendar year of the "modern" era: an in-game year at or beyond this
 * resolves the modern global tables (`MONETARY_BASELINES`) — and, for the
 * FPTP cube-law gate, the proportional UK Commons shape. 1999 is the earliest
 * preset whose seed-time resolution was already the modern table.
 */
export const MODERN_ERA_START_YEAR = 1999;

/** Authored calibration points; integer-year callers advance annually. */
const ERA_ANCHORS: ReadonlyArray<{
  year: number;
  table: Partial<Record<CountryId, EraMonetaryBaseline>>;
}> = [
  { year: 1953, table: MONETARY_BASELINES_1953 },
  { year: 1971, table: MONETARY_BASELINES_1971 },
  { year: 1979, table: MONETARY_BASELINES_1979 },
  { year: 1991, table: MONETARY_BASELINES_1991 },
  { year: MODERN_ERA_START_YEAR, table: {} },
];

/** Missing historical entries use the same modern fallback as exact anchors. */
export function getEraMonetaryBaseline(
  countryId: CountryId,
  currentYear?: number | null
): EraMonetaryBaseline | undefined {
  if (
    typeof currentYear !== "number" ||
    !Number.isFinite(currentYear) ||
    currentYear >= MODERN_ERA_START_YEAR
  )
    return undefined;
  if (currentYear <= ERA_ANCHORS[0].year) return ERA_ANCHORS[0].table[countryId];
  for (let i = 0; i < ERA_ANCHORS.length - 1; i++) {
    const left = ERA_ANCHORS[i];
    const right = ERA_ANCHORS[i + 1];
    if (currentYear === left.year) return left.table[countryId];
    if (currentYear < right.year) {
      const a = left.table[countryId];
      const b = right.table[countryId];
      if (!a && !b) return undefined;
      return interpolateMonetaryCalibration(
        a ?? MONETARY_BASELINES[countryId],
        b ?? MONETARY_BASELINES[countryId],
        (currentYear - left.year) / (right.year - left.year)
      );
    }
  }
  return undefined;
}

/**
 * Era-authored structural GDP growth for countries without national metric
 * dynamics, keyed on the CURRENT in-game year like
 * {@link getEraMonetaryBaseline}. Undefined outside the era spans or for
 * fully-simulated countries — callers keep their existing fallback (2.5).
 */
export function getEraTrendGdpGrowth(
  countryId: CountryId,
  currentYear?: number | null
): number | undefined {
  return getEraMonetaryBaseline(countryId, currentYear)?.trendGdpGrowth;
}
