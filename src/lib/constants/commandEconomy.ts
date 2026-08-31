import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { getCountryIdForCurrency, type CurrencyCode } from "@/lib/constants/currencies";
import { SOE_PERF_BASELINE } from "@/lib/economy/soe";

/**
 * Full per-sector SOE stack for Eastern-bloc / USSR command economies (ticket
 * #1014). Under plants every sector needs state capacity — a 4–8 "commanding
 * heights" subset left the rest as unreachable unowned headroom (private
 * founding is banned). One SOE corporation per {@link CORPORATION_TYPES} entry.
 */
const EASTERN_BLOC_ALL_SECTORS_SOE: CorporationType[] = [...CORPORATION_TYPES];

/**
 * Command-economy regime model.
 *
 * AHD is a general-equilibrium MARKET simulator, but the USSR and command-era
 * China were quantity-planned SHORTAGE economies: a fixed, non-convertible
 * official currency; an administered price/inflation path rather than a market
 * Phillips curve; a passive monobank (no Taylor-rule chair); soft budget
 * constraints (state firms do not go bankrupt); two-circuit money (cash vs
 * non-cash); and a repressed second (black-market) economy. Modeling their
 * currency as a floating, convertible, chair-managed market currency is the
 * wrong KIND of economy — the same class of failure that produced the naira
 * 100x FX incident.
 *
 * The regime is not a switch but a DIAL — `marketizationLevel` (0 fully
 * command → 100 fully market). China migrates ALONG it across eras (1953 ≈
 * command, 1991 ≈ dual-track, 2019 ≈ market); the Soviet ruble sits near the
 * command end through dissolution. Subsystems activate on threshold bands:
 *
 *   level <  COMMAND_CEILING     → FULLY COMMAND   (fixed non-convertible
 *                                   currency, passive monobank, administered
 *                                   CPI, soft budget, administered prices,
 *                                   two-circuit money, second economy)
 *   COMMAND_CEILING..DUAL_TRACK  → DUAL-TRACK      (plan + market engines run
 *                                   in parallel, output split by `plannedShare`)
 *   level >= DUAL_TRACK_CEILING  → MARKET          (standard engine)
 *
 * Everything is gated behind the `commandEconomyEnabled` GameConfig flag
 * (default OFF) — existing worlds are byte-identical until an operator opts in.
 */

/** Fully-market marketization level (dial at 100). */
export const MARKET_LEVEL = 100;
/** Below this the economy is fully command (all planned subsystems active). */
export const COMMAND_CEILING = 30;
/** Below this (and >= COMMAND_CEILING) the economy is dual-track. */
export const DUAL_TRACK_CEILING = 70;

type MarketizationStep = { throughYear: number; level: number };

/**
 * Per-country marketization trajectory. Each step's `level` applies for years
 * up to and including `throughYear`; past the last step the country is fully
 * marketized (MARKET_LEVEL). Absent country → always market.
 */
export const MARKETIZATION_SCHEDULE: Partial<Record<CountryId, MarketizationStep[]>> = {
  // Soviet ruble — command through the 1991 dissolution.
  RU: [{ throughYear: 1991, level: 10 }],
  // Soviet republics (Ukrainian SSR, Byelorussian SSR, Baltic SSRs) — constituent parts of the
  // USSR planning system, so they carry RU's union-wide trajectory. Absent from
  // this map they read as fully marketized even with the command flag on.
  BLR: [{ throughYear: 1991, level: 10 }],
  BAL: [{ throughYear: 1991, level: 10 }],
  UKR: [{ throughYear: 1991, level: 10 }],
  // China's migration: First-Five-Year-Plan command (1953) → post-Deng
  // dual-track / dual-rate (1979–92) → largely marketized reform era (1993+).
  CN: [
    { throughYear: 1978, level: 10 }, // pre-Deng planned economy
    { throughYear: 1992, level: 50 }, // dual-track (guidance + market prices, dual FX)
    { throughYear: 2018, level: 85 }, // socialist market economy
  ],
  // NPP-run Eastern-bloc satellites — closed planned economies (already
  // excluded from the forex market) until the 1989–90 revolutions / German
  // reunification decommunise them. Mostly AI(NPP)-governed, so the planned
  // regime is what the NPP brain operates for them.
  DD: [{ throughYear: 1990, level: 10 }], // East Germany → reunified Oct 1990
  PL: [{ throughYear: 1989, level: 12 }], // Poland → Round Table / Balcerowicz
  HU: [{ throughYear: 1989, level: 15 }], // Hungary → "goulash" was least rigid
  CS: [{ throughYear: 1989, level: 10 }], // Czechoslovakia → Velvet Revolution
  BG: [{ throughYear: 1990, level: 10 }], // Bulgaria
  RO: [{ throughYear: 1989, level: 8 }], // Romania → most autarkic/rigid
  // Yugoslavia → self-management made it the least command of the bloc, but a
  // flat 35 described LATE self-management (post-1965 market reforms) and
  // applied it to 1953, when the country was still running Five-Year-Plan
  // central allocation — the 1950 workers'-council law had barely begun to
  // devolve anything. At 35 it sat above COMMAND_CEILING, so a planned economy
  // was simulated as a floating market one with no monetary authority to
  // respond, and its CPI ratcheted past the 15% clamp to 16.6 by turn 25.
  YU: [
    { throughYear: 1964, level: 20 }, // plan-directed; councils nominal
    { throughYear: 1990, level: 35 }, // post-1965 market-socialist reforms
  ],
};

/**
 * Command Economy v2 (P0) — stored, endogenous marketization levels.
 *
 * `marketizationLevel` used to be a pure schedule function. Under v2 the level
 * becomes STATEFUL: it drifts each turn on black-market pressure, SOE
 * performance and policy stance (see {@link marketizationDrift}) and is
 * persisted per country. To keep the accessor's signature/behaviour contract
 * intact for the ~16 downstream consumers, the stored value lives in this
 * process-level registry: the command-economy turn phase hydrates it from the
 * DB at the start of the turn and writes the drifted value back, so every
 * later phase in the same turn (forex, insolvency, pricing, CPI, …) sees the
 * current level through the unchanged accessor. Absent an entry, the accessor
 * falls back to the era SCHEDULE (which also seeds the stored value the first
 * time). Empty registry ⇒ pure schedule behaviour (flag-off worlds never
 * populate it, so they stay byte-identical).
 *
 * SEAM (P1/P2): read-only API/UI request paths run in separate processes and
 * won't share this registry; they should hydrate it from
 * `FederalBudget.economicFactors.marketizationLevel` before rendering the
 * marketization gauge. The turn engine (single process) is fully covered here.
 */
const storedMarketizationLevels = new Map<string, number>();

/** Store/override a country's live marketization level (clamped 0..100). */
export function setStoredMarketizationLevel(countryId: string, level: number): void {
  if (!countryId || !Number.isFinite(level)) return;
  storedMarketizationLevels.set(countryId, Math.max(0, Math.min(MARKET_LEVEL, level)));
}

/** Read the stored live level for a country, or undefined if none is stored. */
export function getStoredMarketizationLevel(countryId: string): number | undefined {
  return storedMarketizationLevels.get(countryId);
}

/** Replace the whole registry from persisted state (turn-phase hydration). */
export function hydrateStoredMarketizationLevels(entries: Iterable<[string, number]>): void {
  storedMarketizationLevels.clear();
  for (const [countryId, level] of entries) setStoredMarketizationLevel(countryId, level);
}

/** Clear all stored levels (test isolation / world teardown). */
export function clearStoredMarketizationLevels(): void {
  storedMarketizationLevels.clear();
}

/**
 * The era-schedule marketization level for a country/year — the SEED value the
 * stored level starts from. Pure; used by the persistence layer to initialise a
 * country that has no stored level yet.
 */
export function scheduledMarketizationLevel(
  countryId: string | null | undefined,
  currentYear: number | null | undefined
): number {
  if (!countryId) return MARKET_LEVEL;
  const steps = MARKETIZATION_SCHEDULE[countryId as CountryId];
  if (!steps || currentYear == null || !Number.isFinite(currentYear)) return MARKET_LEVEL;
  for (const step of steps) {
    if (currentYear <= step.throughYear) return step.level;
  }
  return MARKET_LEVEL;
}

/**
 * Marketization level (0 command → 100 market) for a country in a given in-game
 * year. Pure and hot-loop safe. Returns the STORED live level when one is
 * present (v2 endogenous drift), otherwise falls back to the era SCHEDULE (the
 * seed). Fail-safe: unknown country/year → MARKET_LEVEL. Does NOT consult the
 * feature flag — callers gate on `enabled` themselves (see the band predicates).
 */
export function marketizationLevel(
  countryId: string | null | undefined,
  currentYear: number | null | undefined
): number {
  if (countryId) {
    const stored = storedMarketizationLevels.get(countryId);
    if (stored != null) return stored;
  }
  return scheduledMarketizationLevel(countryId, currentYear);
}

/**
 * Back-compat view of the command band as a per-country {throughYear}. Retained
 * for readability/tests; the schedule above is the source of truth.
 */
export const COMMAND_ECONOMY_REGIMES: Partial<Record<CountryId, { throughYear: number }>> = {
  RU: { throughYear: 1991 },
  CN: { throughYear: 1978 },
};

/**
 * True when the country is a FULLY COMMAND economy in the given year AND the
 * feature is enabled. Fail-safe (flag off / unknown → false). This gates the
 * binary planned subsystems: fixed non-convertible currency, passive monobank,
 * administered CPI, soft budget.
 */
export function isCommandEconomy(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined
): boolean {
  if (!enabled) return false;
  return marketizationLevel(countryId, currentYear) < COMMAND_CEILING;
}

/**
 * First currency in `currencies` whose anchor country is fully command in
 * `currentYear` (flag on). Fail-safe: flag off / unknown → null. Used by FX
 * placement routes to refuse open-market trades of non-convertible money.
 */
export function nonConvertibleTradeCurrency(
  currencies: readonly CurrencyCode[],
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined
): CurrencyCode | null {
  if (!enabled) return null;
  for (const code of currencies) {
    if (isCommandEconomy(getCountryIdForCurrency(code), currentYear, enabled)) {
      return code;
    }
  }
  return null;
}

/** Player-facing refusal copy for {@link nonConvertibleTradeCurrency}. */
export function nonConvertibleCurrencyMessage(currency: CurrencyCode): string {
  return `${currency} is non-convertible under a command economy and cannot be traded on the open market.`;
}

/**
 * True when the country is DUAL-TRACK (plan + market in parallel) in the given
 * year AND the feature is enabled.
 */
export function isDualTrackEconomy(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined
): boolean {
  if (!enabled) return false;
  const level = marketizationLevel(countryId, currentYear);
  return level < DUAL_TRACK_CEILING && level >= COMMAND_CEILING;
}

/**
 * True when ANY planned machinery is active (command OR dual-track) AND enabled.
 * Convenience gate for subsystems (overhang, administered prices, second
 * economy) that operate across both bands, scaled by `plannedShare`.
 */
export function isPlannedEconomy(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined
): boolean {
  if (!enabled) return false;
  return marketizationLevel(countryId, currentYear) < DUAL_TRACK_CEILING;
}

/**
 * Planned economies whose TRADE is nevertheless open to the market world.
 *
 * Yugoslavia: expelled from the Cominform in June 1948 and embargoed by the
 * bloc, it reoriented toward Western trade, credits, and aid years before the
 * era worlds begin (1953) while keeping a planned domestic economy. Curtaining
 * it walls it in with the exact countries that were embargoing it and cuts it
 * off from its real trading partners. Domestic planned machinery (administered
 * prices, SOEs, overhang) still applies through `isPlannedEconomy`; only the
 * curtain membership is exempted. Note the wall is absolute both ways, so the
 * exemption also severs YU from the Comecon book, which matches the 1948-55
 * bloc embargo years the era opens in.
 */
export const CURTAIN_EXEMPT_COUNTRIES: ReadonlySet<string> = new Set(["YU"]);

/**
 * True when a country sits behind the iron curtain for TRADE purposes: a
 * planned economy that is not curtain-exempt. This is the single membership
 * authority for `buildTradeAffinity`'s `curtainedCountries` at every call
 * site — the ledger and the corp clearing books must never disagree about who
 * is behind the wall.
 */
export function isCurtained(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined
): boolean {
  if (countryId && CURTAIN_EXEMPT_COUNTRIES.has(countryId)) return false;
  return isPlannedEconomy(countryId, currentYear, enabled);
}

/**
 * Share of an economy's activity governed by the PLAN rather than the market
 * (1 at full command → 0 at the dual-track ceiling and above). Drives dual-track
 * splits, administered-price coverage, and overhang accumulation. Returns 0 when
 * the flag is off or the country is market.
 */
export function plannedShare(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined
): number {
  if (!enabled) return 0;
  const level = marketizationLevel(countryId, currentYear);
  if (level >= DUAL_TRACK_CEILING) return 0;
  return Math.max(0, Math.min(1, 1 - level / DUAL_TRACK_CEILING));
}

// ── Command Economy v2 (P0): multiple SOEs + endogenous marketization drift ──

/**
 * Sectors the state operates as SEPARATE SOEs (one enterprise per sector) for a
 * command country. Country/era-tunable: only countries listed here get the
 * multi-SOE split when `commandEconomyEnabled` is on; everyone else is untouched.
 *
 * Eastern bloc / YU: full `CorporationType` stack (plants in every sector).
 * CN keeps a shorter dual-track set. Maps design labels onto engine types —
 * heavy industry→manufacturing, consumer goods→retail, chemicals→chemical_industries,
 * transport→logistics.
 */
export const COMMAND_ECONOMY_SOE_SECTORS: Partial<Record<CountryId, CorporationType[]>> = {
  // USSR + union republics + Warsaw Pact + Yugoslavia: full sector stack.
  // (Historical "commanding heights only" lists left most plants missing under
  // the plants market tier — see ticket #1014 / EASTERN_BLOC_ALL_SECTORS_SOE.)
  RU: EASTERN_BLOC_ALL_SECTORS_SOE,
  UKR: EASTERN_BLOC_ALL_SECTORS_SOE,
  BLR: EASTERN_BLOC_ALL_SECTORS_SOE,
  BAL: EASTERN_BLOC_ALL_SECTORS_SOE,
  DD: EASTERN_BLOC_ALL_SECTORS_SOE,
  // Germany carries no planned band in the SCHEDULE (market by seed), but a
  // German Question `challenger` outcome carries the GDR's regime onto it
  // (`mergeEconomicRegime`). This entry is INERT until that stored dial puts DE
  // in the command band — every consumer gates on `isCommandEconomy` /
  // `isPlannedEconomy` first — and exists so a reunified socialist Germany has
  // an SOE stack to operate rather than a planned economy with no plan.
  DE: EASTERN_BLOC_ALL_SECTORS_SOE,
  PL: EASTERN_BLOC_ALL_SECTORS_SOE,
  HU: EASTERN_BLOC_ALL_SECTORS_SOE,
  CS: EASTERN_BLOC_ALL_SECTORS_SOE,
  BG: EASTERN_BLOC_ALL_SECTORS_SOE,
  RO: EASTERN_BLOC_ALL_SECTORS_SOE,
  YU: EASTERN_BLOC_ALL_SECTORS_SOE,
  // China keeps a shorter dual-track-aware set — it migrates toward market and
  // is not an Eastern-bloc satellite in this model.
  CN: ["manufacturing", "energy", "extraction", "agriculture", "retail", "chemical_industries"],
};

/** The SOE sector set for a country (empty when the country isn't multi-SOE). */
export function commandEconomySoeSectors(countryId: string | null | undefined): CorporationType[] {
  if (!countryId) return [];
  return COMMAND_ECONOMY_SOE_SECTORS[countryId as CountryId] ?? [];
}

/**
 * Per-turn drift weights for the endogenous-marketization formula. The phase
 * runs EVERY turn (48/yr), so these are deliberately small: a starved world
 * (high black-market pressure + failing SOEs) drifts up by ~+0.3/turn (~+15/yr)
 * and reforms out of the command band over a few in-game years, while a
 * well-run orthodox world sits at a slightly-negative drift and holds at the
 * command floor. Tuned to avoid both a death spiral and a frozen dial; final
 * balance pass is P3.
 *
 *   Δlevel = w_bm  * blackMarketPressure           // shortages/grey market → +
 *          + w_soe * (SOE_PERF_BASELINE - soePerf) // weak SOEs → +, strong → −
 *          + w_pol * policyStance                  // reformist → +, orthodox → −
 */
export const MARKETIZATION_DRIFT_WEIGHTS = {
  /**
   * Weight on black-market pressure (0..1). Max +0.22/turn. P3 raised this from
   * 0.30 to 0.34 so the shortage→black-market reform spiral genuinely moved the
   * dial rather than only the readouts.
   *
   * 1.1: trimmed to 0.22. Two reasons, and the second is the binding one.
   *
   * First, `accumulateOverhang` now counts the unmet plan as a goods deficit,
   * so the same world produces more shortage pressure than it did when 0.34 was
   * tuned; without a trim the whole reform spiral simply ran that much hotter.
   *
   * Second, and this is a PRE-EXISTING bug the new term only made more visible:
   * the USSR-to-1991 guard was failing. Scenario E in
   * `commandEconomyBalanceHarness` (a competently-run, orthodox, hands-off USSR)
   * crossed COMMAND_CEILING in 1984 on the old weights, which is the Soviet
   * Union voluntarily marketizing halfway through Chernenko. It was invisible
   * because the scenario only ran 10 of the 38 years it was guarding. At 0.22
   * it stays COMMAND for the full run to 1991.
   *
   * The mismanagement and collapse paths are almost untouched by the trim: they
   * are dominated by the soePerformance and policyStance terms, so scenario C
   * still reforms at yr+3.5 and scenario F still reaches market at yr+6.5.
   */
  blackMarket: 0.22,
  /** Weight on the SOE plan-fulfillment shortfall (baseline − perf). P3: trimmed
   *  from 0.25 so chronic plan misses remain the primary player-driven reform
   *  channel without a totally-collapsed world rocketing to fully-market in a few
   *  years (the extreme corner used to hit level 100 in ~10yr). */
  soePerformance: 0.18,
  /** Weight on the signed reform-vs-orthodox policy stance (−1..+1). P3: nudged
   *  from 0.10 now that government reformism is wired live end-to-end (a
   *  reformist elected majority should visibly move marketization). */
  policyStance: 0.12,
} as const;

export type MarketizationDriftWeights = typeof MARKETIZATION_DRIFT_WEIGHTS;

/**
 * The signed per-turn change in marketization level (before clamping), from the
 * three fully-free drivers. This function itself carries NO era gravity — it is
 * the pure player/economy channel, and history can break. The weak restoring
 * pull toward the era schedule is a SEPARATE, smaller term the turn phase adds
 * on top ({@link marketizationGravity}), kept separate precisely so the free
 * drivers can be reasoned about — and beat it — on their own.
 * See {@link MARKETIZATION_DRIFT_WEIGHTS}.
 *
 * @param blackMarketPressure 0..1 — shortage / black-market / second-economy pressure
 * @param soePerf             aggregate SOE plan fulfillment (1.0 = on plan)
 * @param policyStance        −1 (hardline orthodox) .. +1 (reformist)
 */
export function marketizationDrift(
  blackMarketPressure: number,
  soePerf: number,
  policyStance: number,
  weights: MarketizationDriftWeights = MARKETIZATION_DRIFT_WEIGHTS
): number {
  const clamp = (v: number, lo: number, hi: number) =>
    !Number.isFinite(v) ? lo : Math.min(hi, Math.max(lo, v));
  const bm = clamp(blackMarketPressure, 0, 1);
  const perf = Number.isFinite(soePerf) ? soePerf : SOE_PERF_BASELINE;
  const pol = clamp(policyStance, -1, 1);
  return (
    weights.blackMarket * bm +
    weights.soePerformance * (SOE_PERF_BASELINE - perf) +
    weights.policyStance * pol
  );
}

/**
 * Per-turn restoring pull, in level-points per point of gap, toward the era
 * SCHEDULE. See {@link marketizationGravity}.
 */
export const MARKETIZATION_GRAVITY_RATE = 0.004;
/**
 * Hard cap on the magnitude of the gravity term per turn (≈ ±0.96 level-points
 * per 48-turn year). Deliberately of the SAME order as the free drivers, never
 * larger — gravity must lose to a determined government.
 */
export const MARKETIZATION_GRAVITY_MAX_STEP = 0.02;

/**
 * The signed per-turn ERA-GRAVITY term: a weak restoring pull from the live
 * level back toward {@link scheduledMarketizationLevel}.
 *
 * This is GRAVITY, not RAILS, and the distinction is the whole design:
 *
 *  - It is a small, saturating restoring FORCE (rate × gap, capped at
 *    {@link MARKETIZATION_GRAVITY_MAX_STEP}), never an assignment. Nothing here
 *    ever sets the level to the scheduled value.
 *  - It is capped BELOW what the three free drivers can sustain
 *    ({@link MARKETIZATION_DRIFT_WEIGHTS} sum to 0.64 of headroom), so a
 *    government that actually reforms — or one that runs a tight enough plan to
 *    entrench past history — overwhelms it. History is beatable.
 *  - It is exactly zero when the level sits at the scheduled value, so a world
 *    that has never drifted is byte-identical.
 *
 * The v2 P0 model shipped with NO gravity ("history can break"), which sounded
 * freer than it played: with the policy-stance term pinned negative (see
 * {@link blendGovernmentReformism}) every bloc country ratcheted monotonically
 * to the 0 floor, ending up BELOW the authored schedule regardless of play. The
 * intended default when nobody intervenes is the historical level; deviation
 * should be something a player earns in either direction.
 */
export function marketizationGravity(level: number, scheduledLevel: number): number {
  if (!Number.isFinite(level) || !Number.isFinite(scheduledLevel)) return 0;
  const pull = MARKETIZATION_GRAVITY_RATE * (scheduledLevel - level);
  return Math.max(-MARKETIZATION_GRAVITY_MAX_STEP, Math.min(MARKETIZATION_GRAVITY_MAX_STEP, pull));
}

/** Apply a drift to a stored level, clamped to [0, MARKET_LEVEL]. */
export function driftMarketizationLevel(level: number, drift: number): number {
  const base = Number.isFinite(level) ? level : MARKET_LEVEL;
  const d = Number.isFinite(drift) ? drift : 0;
  return Math.max(0, Math.min(MARKET_LEVEL, base + d));
}

// ── Command Economy v2 (P1): active-Gosbank defaults + real policy stance ────

/**
 * NPP-brain Gosbank defaults, used when a planned country has no derived
 * `commandStance` yet and no P2 player directive. Deliberately "orthodox-
 * competent": fairly SOFT budgets (historical planned-economy behaviour) and a
 * moderate credit posture. P2 player panels override per country via
 * `economicFactors.gosbankDirective`; the NPP government brain overrides via
 * `governmentFormations.commandStance`.
 */
export const NPP_DEFAULT_CREDIT_AGGRESSIVENESS = 0.55;
export const NPP_DEFAULT_BUDGET_SOFTNESS = 0.85;
export const NPP_DEFAULT_REFORMISM = 0;
/** NPP-brain / last-resort internal-repression default when no per-country stance
 *  or player directive exists — a MODERATE dial (an orthodox regime with no
 *  reform lean neither fully represses nor fully tolerates the second economy). */
export const NPP_DEFAULT_INTERNAL_REPRESSION = 0.5;

/**
 * Command Economy v2 (internal repression): map a government's signed reformism
 * [-1 hardline orthodox … +1 reformist] to a DEFAULT internal-repression level
 * in [0, 1]. Orthodox governments repress the second economy to stay communist
 * (moderate-to-high); reformist governments let it breathe (low). Neutral (0) →
 * the moderate {@link NPP_DEFAULT_INTERNAL_REPRESSION}. Derived from the SAME
 * reformism read that drives the marketization policy stance, so the NPP brain's
 * repression posture and its reform posture stay consistent. NaN-guarded.
 */
export function internalRepressionFromReformism(reformism: number | null | undefined): number {
  const r =
    typeof reformism === "number" && Number.isFinite(reformism)
      ? Math.max(-1, Math.min(1, reformism))
      : 0;
  return Math.max(0, Math.min(1, NPP_DEFAULT_INTERNAL_REPRESSION - 0.5 * r));
}

/** Softness at/above which an insolvent SOE is SPARED (soft budget); below it the
 *  SOE is allowed to fold (hard budget → efficiency pressure → reform). */
export const BUDGET_SOFTNESS_FOLD_THRESHOLD = 0.5;

/**
 * Whether an insolvent command SOE is SPARED (kept alive, losses persist) under a
 * given budget-softness dial. Soft (≥ threshold) → spared; hard (< threshold) →
 * allowed to fold. Absent/non-finite softness → the NPP-brain soft default, so a
 * world that hasn't written a softness yet keeps the historical spare-everyone
 * behaviour. Consumed by `nppInsolvencyDissolution`.
 */
export function isSoeSpared(budgetSoftness: number | undefined | null): boolean {
  const s =
    typeof budgetSoftness === "number" && Number.isFinite(budgetSoftness)
      ? budgetSoftness
      : NPP_DEFAULT_BUDGET_SOFTNESS;
  return s >= BUDGET_SOFTNESS_FOLD_THRESHOLD;
}

/**
 * Command Economy v2 (P3): the LIVE government-reformism signal in [-1, 1],
 * derived from the elected governing party's economic position (−5 command-left …
 * +5 market-right → −1 … +1). This closes the P2 read-path seam: instead of the
 * marketization drift's government-reformism term depending solely on the
 * NPP-brain's `commandStance.reformism` (which is never written for a
 * player-headed government), it now reads WHO ACTUALLY GOVERNS. A market-leaning
 * ruling party (or one shifted rightward through position-shift gameplay) reads
 * reformist (+, marketization rises); an orthodox command-left party reads
 * hardline (−, entrenches). Reflects election outcomes and party-position shifts
 * for both player- and NPP-led governments. NaN-guarded; absent → undefined so
 * the caller can fall back to the NPP-brain stance then the neutral default.
 */
export function governmentReformismFromEconomicPosition(
  economicPosition: number | null | undefined
): number | undefined {
  if (typeof economicPosition !== "number" || !Number.isFinite(economicPosition)) {
    return undefined;
  }
  return Math.max(-1, Math.min(1, economicPosition / 5));
}

/**
 * Weight on the ruling party's CHARTERED economic line in the government-
 * reformism blend (see {@link blendGovernmentReformism}).
 */
export const REFORMISM_PARTY_WEIGHT = 0.5;
/**
 * Weight on the SITTING government's live command stance in the government-
 * reformism blend (see {@link blendGovernmentReformism}).
 */
export const REFORMISM_CABINET_WEIGHT = 0.5;

/**
 * The government-reformism signal fed to {@link computePolicyStance}, blended
 * from the two things that legitimately speak for "the regime":
 *
 *  1. `partyReformism` — the RULING PARTY's chartered economic line
 *     ({@link governmentReformismFromEconomicPosition} of
 *     `politicalParties.economicPosition`). This is the SLOW anchor: it only
 *     moves when a party committee passes a `positionShift` proposal
 *     (`applyPositionShiftEffect`, one ±1 step per axis behind a 336-turn ≈
 *     7-game-year cooldown) or when an election changes which party governs.
 *  2. `cabinetReformism` — the SITTING government's live command stance
 *     (`governmentFormations.commandStance.reformism`, re-derived every turn by
 *     `deriveCommandStance` from the head of government's economic scalar and
 *     governing archetype, which itself drifts via `processNppStanceDrift`).
 *     This is the FAST component: what the government actually does now.
 *
 * P3 originally made (1) take absolute PRECEDENCE over (2). That was a
 * regression, not a fix: `economicPosition` is written only by the player-only
 * committee-proposal path, so in an NPP-run one-party state it is a CONSTANT for
 * the entire game — and because it shadowed the live cabinet stance entirely, it
 * pinned `policyStance` negative no matter how the government behaved. With a
 * chartered line at −5 (reformism −1) the term contributes
 * POLICY_GOV_WEIGHT × −1 = −0.6, which no amount of reformist Gosbank posture
 * (max +POLICY_GOSBANK_WEIGHT = +0.4) can outweigh: the dial could only ever
 * fall. Blending restores a live input in BOTH directions while keeping the
 * chartered line as a genuine, hard-to-move commitment.
 *
 * Returns `undefined` when neither input is finite so the caller can fall back
 * to {@link NPP_DEFAULT_REFORMISM}.
 */
export function blendGovernmentReformism(
  partyReformism: number | null | undefined,
  cabinetReformism: number | null | undefined
): number | undefined {
  const finite = (v: number | null | undefined): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : undefined;
  const party = finite(partyReformism);
  const cabinet = finite(cabinetReformism);
  if (party == null && cabinet == null) return undefined;
  if (party == null) return cabinet;
  if (cabinet == null) return party;
  return Math.max(
    -1,
    Math.min(1, REFORMISM_PARTY_WEIGHT * party + REFORMISM_CABINET_WEIGHT * cabinet)
  );
}

/** Weight on the GOVERNMENT's reformism in the policy-stance blend. */
export const POLICY_GOV_WEIGHT = 0.6;
/** Weight on the GOSBANK posture (credit + softness) in the policy-stance blend. */
export const POLICY_GOSBANK_WEIGHT = 0.4;

/**
 * The signed reform-vs-orthodox POLICY STANCE in [-1, 1] feeding the
 * marketization drift's `w_pol` term. Replaces the P0 tolerance placeholder with
 * a genuine read of two inputs:
 *
 *  1. GOVERNMENT composition (`reformism`, −1 hardline orthodox … +1 reformist)
 *     — derived from the head of government's economic scalar + archetype
 *     (reformist cabinet/legislature pushes toward the market).
 *  2. GOSBANK posture — restrained credit + HARD budgets read as reformist (+,
 *     market discipline); flooding SOEs with credit + SOFT budgets read as
 *     orthodox (−, propping up the plan). Both dials are centered at 0.5.
 *
 * Reformist government + a disciplined Gosbank → positive (marketization rises);
 * orthodox government + a soft, credit-flooding Gosbank → negative (entrenches).
 */
export function computePolicyStance(
  reformism: number,
  creditAggressiveness: number,
  budgetSoftness: number
): number {
  const clamp = (v: number, lo: number, hi: number) =>
    !Number.isFinite(v) ? lo : Math.min(hi, Math.max(lo, v));
  const r = clamp(reformism, -1, 1);
  const ca = clamp(creditAggressiveness, 0, 1);
  const bs = clamp(budgetSoftness, 0, 1);
  // Orthodox Gosbank = aggressive credit AND soft budgets → negative posture.
  const gosbank = clamp(-(ca - 0.5 + (bs - 0.5)), -1, 1);
  return clamp(POLICY_GOV_WEIGHT * r + POLICY_GOSBANK_WEIGHT * gosbank, -1, 1);
}
