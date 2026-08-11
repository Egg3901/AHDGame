/**
 * Era-aware monetary baselines.
 *
 * `MONETARY_BASELINES` in `constants/currencies.ts` carries a single global
 * table whose values for several countries are calibrated to the late-1970s
 * (FR 10%, IT 15%, ES 16%, SE 8%, TR 20% inflation targets — see the inline
 * comments there). Those anchors are correct for 1979 worlds but wildly wrong
 * for 1953 worlds, where they pinned domestic CPI at the 15% model cap for the
 * whole run (sim evidence: 1953-default all-NPP 250-turn run, IT/ES/TR
 * min=max=15.0).
 *
 * This module layers per-era overrides on top of the modern table WITHOUT
 * touching it: resolvers return an override only when the CURRENT in-game
 * year (`gameState.currentYear`) falls inside an era span (1953-era until
 * 1979, 1979-era until 1991, 1991-era until 1999), so worlds at 1999+ — and
 * any caller that does not pass a year — resolve byte-identically to the
 * existing constants.
 *
 * KEYING (2026-07-17 correction): these are RUNTIME per-turn anchors, so they
 * key on the current in-game year, NOT the frozen seed year. A long-lived
 * world GRADUATES through the eras as its clock advances: a 1953-default
 * world uses the 1953 anchors while its year is < 1979, the 1979 anchors
 * through 1979-1990, the 1991 anchors through 1991-1998, and the modern table
 * from 1999 on. The live 1991-default world at in-game ~2015 therefore
 * resolves the modern anchors (its pre-era-table behavior). Seed-time
 * selections (initial rates, budgets, census, seeded metric values) stay
 * keyed on preset/startingYear elsewhere — only per-turn behavior graduates.
 *
 * 1979 worlds: the late-1970s values in the global table (FR 10, IT 15, ES 16,
 * SE 8, TR 20) ARE the 1979 calibration — the 1979 table repeats them verbatim
 * (plus authored trend growth) and adds honest stagflation-era anchors for the
 * countries the global table holds at modern values (US/UK/JP/DE/IE/BR/NG/RU).
 * Historically those anchors did not exist as entries; 1979 CPI was instead
 * manufactured by a cost-of-living lever in `inflation.ts` (neutral CoL index
 * 50 vs 100-centered seed data → permanent +12.5pp housing term). That lever
 * is gone — see `getCostOfLivingNeutralIndex` — so these targets are now the
 * sole, explicit source of era inflation.
 *
 * 1991 worlds: moderate early-90s disinflation anchors (real 1991-97 CPI:
 * US 4.2→2.3, UK 5.9→3, JP 3.3→0.5, DE 4→1.5). Same lever-removal story: a
 * 300-turn 1991-default sim on the old lever held US/UK/JP/DE/CN CPI at
 * 6.5-8.6%/yr sustained (sandbox ahd_sim_s1991-base-a), roughly double the
 * era's real path.
 *
 * Countries absent from an era table intentionally fall through to the modern
 * baseline (US/UK/IE/CN 2.0-target / ~3-4 neutral are already era-plausible
 * for 1953; CN's administered-price 2.0 works for 1979 too).
 *
 * Trend GDP growth: layer-1 countries (no national stateMetrics doc — not in
 * `NATIONAL_SCOPE`) have no sector-driven growth dynamics; every consumer used
 * to fall back to a hardcoded 2.5. `trendGdpGrowth` lets an era author the
 * structural growth rate the engine should assume for them instead (e.g. the
 * RU 1953 overlay authors 6.0 — forced industrialization + post-war
 * reconstruction, see `seeds/ru/ruMetricPresets1953.ts`).
 */

import type { CountryId } from "./countries";
import type { MonetaryBaseline } from "./currencies";

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
const MONETARY_BASELINES_1953: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  // Bank of Japan discount ~5.8%; post-Korean-War CPI spike cooling toward
  // low single digits by 1955; reconstruction boom (growth authored in the
  // JP 1953 metric presets).
  JP: { targetInflation: 2.0, neutralPrimeRate: 5.5 },
  // Bank deutscher Länder discount 3.5%; Wirtschaftswunder price stability
  // (CPI ~ -1.7 to +2%).
  DE: { targetInflation: 2.0, neutralPrimeRate: 3.5 },
  // Colonial Nigeria on the sterling peg — imported UK price stability
  // (modern table's 6%/12% is the post-independence naira regime).
  NG: { targetInflation: 2.0, neutralPrimeRate: 3.5 },
  // Vargas-era chronic inflation (~10-20%/yr) — double digits is era-correct.
  BR: { targetInflation: 10.0, neutralPrimeRate: 12.0 },
  // Administered prices with annual state retail price cuts; Gosbank
  // administrative rates. trendGdpGrowth matches the authored RU 1953
  // overlay ("economic.gdpGrowth": 6.0 in ruMetricPresets1953).
  RU: { targetInflation: 1.0, neutralPrimeRate: 2.5, trendGdpGrowth: 6.0 },
  // Pinay stabilization: CPI ~ -2 to +1% in 1953; Banque de France discount
  // 4%; Trente Glorieuses trend growth.
  FR: { targetInflation: 2.0, neutralPrimeRate: 4.0, trendGdpGrowth: 4.5 },
  // CPI ~2%; miracolo economico takeoff.
  IT: { targetInflation: 2.5, neutralPrimeRate: 4.0, trendGdpGrowth: 6.0 },
  // Autarky-era Spain: moderate but bumpy inflation, pre-1959 Stabilization
  // Plan.
  ES: { targetInflation: 4.0, neutralPrimeRate: 5.0, trendGdpGrowth: 4.5 },
  // CPI ~1%; Riksbank discount 2.75-3%.
  SE: { targetInflation: 2.0, neutralPrimeRate: 3.0, trendGdpGrowth: 3.5 },
  // Menderes boom: strong growth with inflation building through the
  // mid-1950s (far from the 1979 crisis' 20%).
  TR: { targetInflation: 5.0, neutralPrimeRate: 6.0, trendGdpGrowth: 6.0 },

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
  HU: { targetInflation: 3.0, neutralPrimeRate: 3.5, trendGdpGrowth: 3.5 },
  PL: { targetInflation: 2.0, neutralPrimeRate: 3.5, trendGdpGrowth: 4.0 },
  RO: { targetInflation: 2.0, neutralPrimeRate: 3.5, trendGdpGrowth: 3.5 },
  // Tito's self-managed economy ran visibly hotter than the Cominform bloc.
  YU: { targetInflation: 5.0, neutralPrimeRate: 5.0, trendGdpGrowth: 5.0 },
  BG: { targetInflation: 1.5, neutralPrimeRate: 3.5, trendGdpGrowth: 4.0 },
  // Soviet-republic fictions mirror RU's administered anchors. There was no
  // republican monetary authority at all - Gosbank set one rate for the union -
  // so these three share RU's numbers and differ only on trend growth, which is
  // a real plan-output difference rather than a policy one.
  BLR: { targetInflation: 0.5, neutralPrimeRate: 2.5, trendGdpGrowth: 5.0 },
  // Ukraine grows slower than Byelorussia: a bigger, more mature industrial base
  // rebounding from a higher pre-war level, not a republic rebuilt from zero.
  UKR: { targetInflation: 0.5, neutralPrimeRate: 2.5, trendGdpGrowth: 4.5 },
  CS: { targetInflation: 1.5, neutralPrimeRate: 3.5, trendGdpGrowth: 4.5 },
  BAL: { targetInflation: 0.5, neutralPrimeRate: 2.5, trendGdpGrowth: 4.5 },
  // GDR administered prices (June 1953 uprising notwithstanding).
  DD: { targetInflation: 0.5, neutralPrimeRate: 3.5, trendGdpGrowth: 3.0 },
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
  GR: { targetInflation: 3.0, neutralPrimeRate: 6.0, trendGdpGrowth: 6.5 },
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
const MONETARY_BASELINES_1979: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  US: { targetInflation: 10.0, neutralPrimeRate: 12.0 },
  UK: { targetInflation: 12.0, neutralPrimeRate: 14.0 },
  JP: { targetInflation: 4.0, neutralPrimeRate: 6.0 },
  DE: { targetInflation: 4.0, neutralPrimeRate: 6.0 },
  IE: { targetInflation: 12.0, neutralPrimeRate: 14.0 },
  // Military-regime "miracle" hangover: chronic high inflation, pre-hyper era.
  BR: { targetInflation: 12.0, neutralPrimeRate: 15.0 },
  // Oil-boom Nigeria: double-digit CPI on fiscal expansion.
  NG: { targetInflation: 10.0, neutralPrimeRate: 10.0 },
  // Brezhnev stagnation: administered prices (low open inflation), slowing
  // structural growth ~2-3%/yr for the metric-less RU bloc.
  RU: { targetInflation: 1.5, neutralPrimeRate: 2.5, trendGdpGrowth: 2.5 },
  FR: { targetInflation: 10.0, neutralPrimeRate: 9.5, trendGdpGrowth: 3.0 },
  IT: { targetInflation: 15.0, neutralPrimeRate: 12.0, trendGdpGrowth: 3.5 },
  ES: { targetInflation: 16.0, neutralPrimeRate: 14.0, trendGdpGrowth: 2.0 },
  SE: { targetInflation: 8.0, neutralPrimeRate: 9.0, trendGdpGrowth: 2.0 },
  TR: { targetInflation: 20.0, neutralPrimeRate: 20.0, trendGdpGrowth: 2.0 },
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
const MONETARY_BASELINES_1991: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  US: { targetInflation: 4.0, neutralPrimeRate: 6.0 },
  UK: { targetInflation: 4.5, neutralPrimeRate: 8.0 },
  JP: { targetInflation: 2.5, neutralPrimeRate: 4.5 },
  DE: { targetInflation: 3.5, neutralPrimeRate: 7.0 },
  IE: { targetInflation: 3.0, neutralPrimeRate: 6.0 },
  CN: { targetInflation: 5.0, neutralPrimeRate: 7.0 },
  BR: { targetInflation: 12.0, neutralPrimeRate: 15.0 },
  NG: { targetInflation: 12.0, neutralPrimeRate: 15.0 },
  // Post-Soviet collapse: price liberalization (Jan '92: >2500%/yr, capped-model
  // authoring) and output contraction ~-5%/yr through the early 90s.
  RU: { targetInflation: 12.0, neutralPrimeRate: 20.0, trendGdpGrowth: -5.0 },
  FR: { targetInflation: 3.0, neutralPrimeRate: 6.0, trendGdpGrowth: 2.0 },
  IT: { targetInflation: 5.5, neutralPrimeRate: 9.0, trendGdpGrowth: 1.5 },
  ES: { targetInflation: 5.5, neutralPrimeRate: 9.0, trendGdpGrowth: 2.5 },
  // Early-90s Swedish crisis: near-zero growth, disinflation from the '91 spike.
  SE: { targetInflation: 4.0, neutralPrimeRate: 8.0, trendGdpGrowth: 1.0 },
  TR: { targetInflation: 12.0, neutralPrimeRate: 18.0, trendGdpGrowth: 4.0 },
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
const MONETARY_BASELINES_1971: Partial<Record<CountryId, EraMonetaryBaseline>> = {
  US: { targetInflation: 6.0, neutralPrimeRate: 7.5 },
  UK: { targetInflation: 9.0, neutralPrimeRate: 10.0 },
  DE: { targetInflation: 4.5, neutralPrimeRate: 6.0 },
  JP: { targetInflation: 6.5, neutralPrimeRate: 7.0, trendGdpGrowth: 4.5 },
  IE: { targetInflation: 9.0, neutralPrimeRate: 10.0 },
  CN: { targetInflation: 2.0, neutralPrimeRate: 4.0, trendGdpGrowth: 5.0 },
  BR: { targetInflation: 12.0, neutralPrimeRate: 15.0 },
  NG: { targetInflation: 10.0, neutralPrimeRate: 10.0 },
  RU: { targetInflation: 1.5, neutralPrimeRate: 2.5, trendGdpGrowth: 3.0 },
  DD: { targetInflation: 1.5, neutralPrimeRate: 2.5, trendGdpGrowth: 3.0 },
  FR: { targetInflation: 7.0, neutralPrimeRate: 8.5, trendGdpGrowth: 3.5 },
  IT: { targetInflation: 9.0, neutralPrimeRate: 10.0, trendGdpGrowth: 3.0 },
  ES: { targetInflation: 9.0, neutralPrimeRate: 9.0, trendGdpGrowth: 4.0 },
  SE: { targetInflation: 7.0, neutralPrimeRate: 8.0, trendGdpGrowth: 2.0 },
  TR: { targetInflation: 15.0, neutralPrimeRate: 15.0, trendGdpGrowth: 4.0 },
  HU: { targetInflation: 2.5, neutralPrimeRate: 3.5, trendGdpGrowth: 3.0 },
  PL: { targetInflation: 2.5, neutralPrimeRate: 3.5, trendGdpGrowth: 3.5 },
  // Pre-junta/early-junta Greece: inflation accelerated through the decade
  // (post-1973 oil shock CPI briefly spiked into the 20s before moderating),
  // averaging out gameplay-rounded to a high-but-not-yet-1979-extreme regime.
  // Without this entry GR falls through to the 1979 table's 15.0/16.5 a
  // decade early — the same "wrong-era anchor" bug this table exists to fix
  // for its other members.
  GR: { targetInflation: 10.0, neutralPrimeRate: 10.0, trendGdpGrowth: 4.0 },
};

/**
 * First calendar year of the "modern" era: an in-game year at or beyond this
 * resolves the modern global tables (`MONETARY_BASELINES`) — and, for the
 * FPTP cube-law gate, the proportional UK Commons shape. 1999 is the earliest
 * preset whose seed-time resolution was already the modern table.
 */
export const MODERN_ERA_START_YEAR = 1999;

/**
 * Era spans, most historical first: an in-game year strictly before a span's
 * `untilYear` (and not claimed by an earlier span) resolves that span's table.
 * There is no era before 1953, so the 1953 table also covers any earlier
 * year. Years ≥ `MODERN_ERA_START_YEAR` (and callers passing no year) resolve
 * the modern `MONETARY_BASELINES` byte-identically to the pre-era-table
 * behavior. For the exact preset years (1953/1979/1991/1999+) this resolves
 * the same table the old seed-year windows (≤1953/≤1979/≤1991) did.
 */
const ERA_TABLES: ReadonlyArray<{
  untilYear: number;
  table: Partial<Record<CountryId, EraMonetaryBaseline>>;
}> = [
  { untilYear: 1971, table: MONETARY_BASELINES_1953 },
  // A 1953 world runs ~48 turns per in-game year, so a 1000-turn run reaches
  // ~1973 — past the Aug-1971 Nixon Shock. Without this span the whole
  // post-Bretton-Woods period still resolved 1953 anchors (DE 2.0/3.5,
  // FR 2.0/4.0, JP 2.0/5.5), i.e. Bretton-Woods price stability persisting years
  // after the system it depended on ended.
  { untilYear: 1979, table: MONETARY_BASELINES_1971 },
  { untilYear: 1991, table: MONETARY_BASELINES_1979 },
  { untilYear: MODERN_ERA_START_YEAR, table: MONETARY_BASELINES_1991 },
];

function resolveEraTable(
  currentYear: number | null | undefined
): Partial<Record<CountryId, EraMonetaryBaseline>> | undefined {
  if (typeof currentYear !== "number" || !Number.isFinite(currentYear)) return undefined;
  for (const era of ERA_TABLES) {
    if (currentYear < era.untilYear) return era.table;
  }
  return undefined;
}

/**
 * Returns the era override for a country, or undefined when the era has no
 * override for it (callers fall through to `MONETARY_BASELINES`).
 *
 * `currentYear` is the CURRENT in-game year (`gameState.currentYear`) — not
 * the frozen seed year — so anchors graduate as a world's clock advances.
 * Passing no year (or a modern one, ≥ 1999) always returns undefined, the
 * fail-safe modern behavior.
 */
export function getEraMonetaryBaseline(
  countryId: CountryId,
  currentYear?: number | null
): EraMonetaryBaseline | undefined {
  return resolveEraTable(currentYear)?.[countryId];
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
