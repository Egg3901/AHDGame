// src/lib/constants/currencies.ts
/**
 * Exchange rates and what moves them (for example GBP to USD). COUNTRY_CURRENCY_MAP
 * ties each country to its currency; INITIAL_RATES and the era tables set the
 * starting rate per preset (getInitialRates). Each turn the rate drifts toward a
 * macro target at DRIFT_SPEED, gets up to +/-0.4% noise (RATE_NOISE_MAX), player
 * trade volume moves it at most 5% (VOLUME_PRESSURE_CAP), and it stays within 50%
 * to 150% of the base rate (RATE_FLOOR_MULTIPLIER, RATE_CEILING_MULTIPLIER).
 */
import type { CountryId } from "./countries";
import { STARTING_YEAR, getStartingYearForPreset } from "./turnTime";

/**
 * Currency codes for all countries — active and future.
 * Active v1: USD, GBP, JPY. Future: CAD, EUR (added when those countries launch).
 */
export type CurrencyCode =
  | "USD"
  | "GBP"
  | "JPY"
  | "CAD"
  | "EUR"
  | "IEP"
  | "BRL"
  | "CNY"
  | "NGN"
  | "HUF"
  | "PLZ"
  | "ROL"
  | "YUD"
  | "BGL"
  | "CSK"
  | "SUR"
  | "FRF"
  | "ITL"
  | "ESP"
  | "SEK"
  | "TRL"
  | "GRD"
  | "ATS"
  | "FIM"
  | "DDM";

/** Zod-compatible tuple for CurrencyCode validation */
export const ZOD_CURRENCY_ENUM: [CurrencyCode, CurrencyCode, ...CurrencyCode[]] = [
  "USD",
  "GBP",
  "JPY",
  "CAD",
  "EUR",
  "IEP",
  "BRL",
  "CNY",
  "NGN",
  "HUF",
  "PLZ",
  "ROL",
  "YUD",
  "BGL",
  "CSK",
  "SUR",
  "FRF",
  "ITL",
  "ESP",
  "SEK",
  "TRL",
  "GRD",
  "ATS",
  "FIM",
  "DDM",
];

/** Map country → home currency. Authoritative source for this mapping. */
export const COUNTRY_CURRENCY_MAP: Record<CountryId, CurrencyCode> = {
  US: "USD",
  UK: "GBP",
  JP: "JPY",
  DE: "EUR",
  // Irish pound (Saorstát/IEP). Distinct from EUR so 1953 Bretton Woods par
  // (1:1 GBP) can have its own exchangeRates doc without colliding with DE's DM/EUR rate.
  // Display shows "€" when gameState.eurozoneEnabled (see getEraAwareCurrencySymbol).
  IE: "IEP",
  BR: "BRL",
  CN: "CNY",
  NG: "NGN",
  HU: "HUF",
  PL: "PLZ",
  RO: "ROL",
  YU: "YUD",
  BG: "BGL",
  BLR: "SUR",
  UKR: "SUR",
  CS: "CSK",
  BAL: "SUR",
  RU: "SUR",
  FR: "FRF",
  IT: "ITL",
  ES: "ESP",
  SE: "SEK",
  TR: "TRL",
  GR: "GRD",
  AT: "ATS",
  FI: "FIM",
  DD: "DDM",
  SCO: "GBP", // sterlingized — shares the UK's GBP (anchor stays UK)
  WAL: "GBP", // sterlingized — shares the UK's GBP (anchor stays UK)
};

/**
 * The single country that "anchors" each currency — i.e. the one whose
 * `exchangeRates` doc holds the live rate and central bank for that currency.
 *
 * This is authoritative and EXPLICIT (not derived from `COUNTRY_CURRENCY_MAP`
 * iteration order). EUR is DE-only (West German DM proxy pre-eurozone; euro
 * after). IEP is IE-only. SCO/WAL share GBP with UK as the anchor.
 *
 * CAD has no launched country, so it resolves to US (USD parity) — matching the
 * legacy fallback.
 */
export const CURRENCY_ANCHOR_COUNTRY: Record<CurrencyCode, CountryId> = {
  USD: "US",
  GBP: "UK",
  JPY: "JP",
  CAD: "US", // no launched CAD country; USD-parity fallback
  EUR: "DE",
  IEP: "IE",
  BRL: "BR",
  CNY: "CN",
  NGN: "NG",
  HUF: "HU",
  PLZ: "PL",
  ROL: "RO",
  YUD: "YU",
  BGL: "BG",
  CSK: "CS",
  SUR: "RU", // Soviet ruble — anchor is the USSR/Russia entity (shared by RU + BY + BAL)
  FRF: "FR",
  ITL: "IT",
  ESP: "ES",
  SEK: "SE",
  TRL: "TR",
  GRD: "GR",
  ATS: "AT",
  FIM: "FI",
  DDM: "DD",
};

/**
 * The country whose central bank / exchange-rate doc backs a currency.
 * National prime rate / savings APY / FX rate lookups use this (one country per
 * currency). See {@link CURRENCY_ANCHOR_COUNTRY}.
 */
export function getCountryIdForCurrency(code: CurrencyCode): CountryId {
  return CURRENCY_ANCHOR_COUNTRY[code] ?? "US";
}

/**
 * Countries with active forex trading. IE is forex-active with its own IEP rate
 * (historically the Irish pound; sterling-linked 1927–1979). DE anchors EUR.
 * NG is forex-active even though the country is still `coming-soon`: its sovereign
 * bonds already settle in NGN, so the naira must be exchangeable or holders are
 * trapped.
 */
// SU/FR/IT/ES/SE/TR join for the 1979 Cold-War preset (player/economy-enabled
// there). Like NG, they stay forex-active across eras even while coming-soon in
// 2019/1991 — their currencies must be exchangeable so holders aren't trapped.
// The NPP-run bloc (DD/HU/PL/…) is NOT forex-active (closed planned economy until
// it decommunises).
export const FOREX_ACTIVE_COUNTRIES: CountryId[] = [
  "US",
  "UK",
  "JP",
  "DE",
  "IE",
  "CN",
  "BR",
  "NG",
  "RU",
  "DD",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
];

/** Only currencies that participate in forex */
export const FOREX_ACTIVE_CURRENCIES: CurrencyCode[] = [
  "USD",
  "GBP",
  "JPY",
  "EUR",
  "IEP",
  "CNY",
  "BRL",
  "NGN",
  "SUR",
  "DDM",
  "FRF",
  "ITL",
  "ESP",
  "SEK",
  "TRL",
  "GRD",
  "ATS",
  "FIM",
];

/** Zod-compatible tuple for ACTIVE currencies only (used in forex route schemas) */
export const ZOD_ACTIVE_CURRENCY_ENUM: [CurrencyCode, CurrencyCode, ...CurrencyCode[]] = [
  "USD",
  "GBP",
  "JPY",
  "EUR",
  "IEP",
  "CNY",
  "BRL",
  "NGN",
  "SUR",
  "DDM",
  "FRF",
  "ITL",
  "ESP",
  "SEK",
  "TRL",
  "GRD",
  "ATS",
  "FIM",
];

// ── Spread schedule ──────────────────────────────────────────────────────────
/**
 * Reduced FX spread applied to cross-currency sector flows — foreign operating
 * income repatriated to the corp's home currency, and costs paid on foreign
 * sectors. Half the market-maker rate (0.5%) so multinational operations carry
 * real FX friction without nerfing core business income as hard as a market trade.
 */
export const SECTOR_FX_SPREAD = 0.005;

/**
 * Chair-controlled multiplier on the spread fee charged when their currency is
 * sold (the FROM leg of a trade). 1.0 = normal; the chair can dial it 0.5×–1.5×.
 * Higher = pricier to trade their currency → more reserve/revenue + capital-flow
 * friction, but less attractive/liquid. Lower = cheaper to trade → more volume +
 * reserve-currency appeal, but less fee income. Adjustable once per cooldown.
 */
export const FOREX_SPREAD_STRENGTH_MIN = 0.5;
export const FOREX_SPREAD_STRENGTH_MAX = 1.5;
export const FOREX_SPREAD_STRENGTH_DEFAULT = 1.0;
/** Turns (= hours, 1 turn = 1h) a chair must wait between spread-strength changes. */
export const FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS = 48;

/** Clamp a raw spread-strength to the allowed band; non-finite → default. */
export function clampForexSpreadStrength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return FOREX_SPREAD_STRENGTH_DEFAULT;
  return Math.min(FOREX_SPREAD_STRENGTH_MAX, Math.max(FOREX_SPREAD_STRENGTH_MIN, value));
}
// Tiers scaled up 3.64× from the original 0.275%/0.175%/0.10% so the headline
// (instant/market) spread is 1%, preserving the relative tier discounts.
export const MARKET_MAKER_SPREAD = 0.01; // 1%
export const LIMIT_ORDER_SPREAD = 0.0064; // ~0.64% (proportional limit-order discount)
export const DIRECT_TRADE_SPREAD = 0.0036; // ~0.36% (proportional direct-trade discount)

// ── Rate dynamics ────────────────────────────────────────────────────────────
export const DRIFT_SPEED = 0.05; // ~48 turns to 90% convergence
export const RATE_NOISE_MAX = 0.004; // ±0.4% per-turn jitter (bumped from ±0.3% for livelier movement)

// ── Currency pressure cycles (12-hour regimes) ───────────────────────────────
// 1 turn = 1 real hour (MS_PER_TURN), so a 12-turn window ≈ 12 hours. Each
// currency holds a randomly-rolled directional regime for the window, applying a
// small sustained pressure on top of the fundamentals. The magnitudes are
// deliberately small: a sustained regime settles only ~pressure/DRIFT_SPEED off
// the macro target (moderate ≈ 3%, slight ≈ 1.4%), so a currency with strong
// fundamentals pulling the other way generally overcomes the cycle.
export const CYCLE_PRESSURE_TURNS = 12;

export type CurrencyCyclePressureRegime =
  "moderate_strengthen" | "slight_strengthen" | "neutral" | "slight_weaken" | "moderate_weaken";

export const CYCLE_PRESSURE_REGIMES: readonly CurrencyCyclePressureRegime[] = [
  "moderate_strengthen",
  "slight_strengthen",
  "neutral",
  "slight_weaken",
  "moderate_weaken",
] as const;

/**
 * Per-turn pressure for each regime. Positive = strengthens the currency (lowers
 * the rate), mirroring volume pressure's `1 - pressure` convention.
 */
export const CYCLE_PRESSURE_BY_REGIME: Record<CurrencyCyclePressureRegime, number> = {
  moderate_strengthen: 0.0015,
  slight_strengthen: 0.0007,
  neutral: 0,
  slight_weaken: -0.0007,
  moderate_weaken: -0.0015,
};

/** Pick a uniformly-random regime — called when a currency's 12-turn window rolls over. */
export function rollCyclePressureRegime(): CurrencyCyclePressureRegime {
  return CYCLE_PRESSURE_REGIMES[Math.floor(Math.random() * CYCLE_PRESSURE_REGIMES.length)];
}
/**
 * Per-turn volatility reductions for the top reserve currencies by rank
 * (1-indexed): the #1 "leading exchange currency" trades 50% calmer, #2 25%
 * calmer, #3 12.5% calmer; everything else gets the full market jitter. A status
 * buff — the more a currency is held in reserves, the steadier it trades.
 */
export const RESERVE_CURRENCY_VOLATILITY_REDUCTIONS = [0.5, 0.25, 0.125] as const;

/** Noise multiplier for a reserve currency at `rank` (1-indexed). 1 = no buff. */
export function reserveCurrencyVolatilityMultiplier(rank: number): number {
  const reduction = RESERVE_CURRENCY_VOLATILITY_REDUCTIONS[rank - 1] ?? 0;
  return 1 - reduction;
}

/** @deprecated Use {@link reserveCurrencyVolatilityMultiplier}. #1's multiplier. */
export const LEADING_RESERVE_CURRENCY_VOLATILITY_MULTIPLIER =
  reserveCurrencyVolatilityMultiplier(1);
export const RATE_FLOOR_MULTIPLIER = 0.5; // 50% below base rate
export const RATE_CEILING_MULTIPLIER = 1.5; // 50% above base rate

// ── Macro sensitivity coefficients ───────────────────────────────────────────
export const PRIME_RATE_SENSITIVITY = 0.02;
export const INFLATION_SENSITIVITY = 0.015;
export const GDP_GROWTH_SENSITIVITY = 0.01;
export const TRADE_GROWTH_SENSITIVITY = 0.005;

// ── Absolute-inflation depreciation (carry-trade fix, #3064 Phase 2) ──────────
// The macro target's inflation term is a deviation from each currency's OWN
// targetInflation, so a currency whose baseline is set high (e.g. IT/TR/SE in the
// late-1970s profiles) sits at par despite crippling inflation — which is exactly
// what let high-nominal-rate currencies pay a free real carry. This term adds a
// persistent weakening keyed off ABSOLUTE inflation above a healthy ceiling,
// independent of the currency's own baseline, so high inflation actually costs the
// holder (relative-PPP direction). Only bites above the threshold, so developed
// markets (~1-2% inflation) are unaffected and their calibration is preserved.
export const ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD = 6.0; // pp; healthy inflation ceiling
export const ABSOLUTE_INFLATION_SENSITIVITY = 0.015; // per excess pp above the threshold

// ── Volume pressure ──────────────────────────────────────────────────────────
export const VOLUME_PRESSURE_SENSITIVITY = 0.0001;
export const VOLUME_PRESSURE_CAP = 0.05; // ±5% max rate impact
// Weight of trade volume vs macro fundamentals in the direction of rate movement.
// 0.2 = volume accounts for 20% of direction; macro accounts for 80%.
export const VOLUME_DIRECTION_WEIGHT = 0.2;
export const VOLUME_LOOKBACK_TURNS = 24; // ~6 game months

// ── Order expiry ─────────────────────────────────────────────────────────────
export const DIRECT_TRADE_EXPIRY_TURNS = 24;

// ── Initial exchange rates (local currency per 1 internal unit) ──────────────
export const INITIAL_RATES: Partial<Record<CountryId, number>> = {
  US: 1.0,
  UK: 0.75,
  JP: 106.0,
  DE: 0.92, // EUR starts near USD parity (ECB policy rate similar to Fed baseline)
  IE: 0.92, // IEP — euro-era parity with EUR (display € when eurozoneEnabled)
  BR: 5.0, // BRL — ~5 BRL per USD
  CN: 7.2, // CNY — ~7.2 CNY per USD
  NG: 1550, // NGN — approximate naira per USD reference point
  // 1979-only-modeled countries: only enabled in the 1979 preset. These entries
  // exist so the forex invariants hold across eras (like NG while coming-soon);
  // values mirror their 1979 administered/market rate since they aren't enabled
  // in 2019/1991.
  RU: 2.22, // SUR per USD (administered)
  DD: 2.22, // DDM administered placeholder (DD enabled only in 1953/1979)
  FR: 4.2, // FRF per USD
  IT: 833, // ITL per USD
  ES: 67, // ESP per USD
  SE: 4.29, // SEK per USD
  TR: 34.5, // TRL per USD
  GR: 37.0, // GRD per USD (1979-continuity game unit)
  AT: 13.4, // ATS per USD (hard-schilling policy)
  FI: 3.9, // FIM per USD (1979-continuity game unit)
  SCO: 0.75, // GBP — shares UK's sterling rate (not forex-active)
  WAL: 0.75, // GBP — shares UK's sterling rate (not forex-active)
};

/**
 * 1991-era starting exchange rates (local currency per 1 internal unit / per 1 USD).
 * Sources: IMF IFS annual averages 1991.
 *
 * DE uses an EUR-equivalent derived from the 1991 DEM rate converted through the
 * fixed DM→EUR parity (1 EUR = 1.95583 DEM). IE uses real IEP (Irish pound) —
 * ~0.85 IEP/USD in 1991 (ERM era; sterling link had ended in 1979).
 *
 * BR is excluded: Brazil's cruzeiro was in hyperinflation in 1991 (Plano Collor
 * failed; monthly inflation ~20%). A stable parity with USD cannot be
 * meaningfully represented. BRL 5.0 (the 2019-default rate) is kept as a
 * fallback to avoid divide-by-zero in forex math.
 */
export const INITIAL_RATES_1991: Partial<Record<CountryId, number>> = {
  US: 1.0,
  UK: 0.57, // GBP/USD annual average 1991
  JP: 134.5, // JPY/USD annual average 1991
  DE: 0.85, // DEM→EUR-equivalent (1.66 DEM/USD ÷ 1.95583 DEM/EUR)
  IE: 0.85, // IEP/USD ~1991 (post-sterling-link; ERM)
  BR: 5.0, // placeholder — cruzeiro hyperinflation makes 1991 rate meaningless
  CN: 5.32, // CNY/USD official 1991 rate
  NG: 9.9, // NGN/USD official 1991 rate (pre-SAP devaluations)
  // 1979-only-modeled countries — placeholders to satisfy forex invariants (not
  // enabled in 1991); mirror the 1979 rate.
  RU: 2.22,
  DD: 2.22, // DDM placeholder (DD not enabled in 1991)
  FR: 4.2,
  IT: 833,
  ES: 67,
  SE: 4.29,
  TR: 34.5,
  GR: 37.0,
  AT: 13.4,
  FI: 3.9,
};

/**
 * 1953-era starting exchange rates (local currency per 1 USD).
 * Bretton Woods era — most currencies pegged to the dollar at fixed IMF par values.
 * Command-economy currencies (SUR etc.) use administered/official rates.
 */
export const INITIAL_RATES_1953: Partial<Record<CountryId, number>> = {
  US: 1.0,
  UK: 0.357, // GBP: Bretton Woods par $2.80/£ → 0.357 £/USD
  JP: 360.0, // JPY: Dodge Line 360¥/USD (fixed 1949–71)
  DE: 4.2, // DEM: post-reform fixed rate 4.2 DEM/USD (Bretton Woods)
  // IEP: Currency Commission / CBI sterling link 1927–1979 — hard 1:1 with GBP
  // at Bretton Woods par $2.80/£. Seeded with hardPeg (see getSeedHardPeg).
  IE: 0.357,
  BR: 18.8, // BRZ: cruzeiro 1953 avg ~18.8/USD
  CN: 2.46, // CNY: official PRC rate 1953
  NG: 0.357, // NGN: West African pound = GBP par (colonial)
  RU: 9.0, // SUR: Western GNP-estimate conversion basis (pre-1961 rouble). The
  // administered official rate was 4/USD, but at 4 the ₽1.4T rollup reads
  // near-US-sized; 9/USD lands the RU/US economic ratio in the historical
  // ~35–45% band (political-legislation spec §4.1 SUR joint-calibration ruling).
  DD: 4.2, // DDM: administered near West-DM par (Mark der DDR, 1:1 official with West DEM)
  FR: 350.0, // FRF: post-devaluation ~350 old francs/USD
  IT: 625.0, // ITL: Bretton Woods par ~625 lira/USD
  ES: 39.6, // ESP: official peseta rate 1953
  SE: 5.17, // SEK: Bretton Woods par 5.17/USD
  TR: 2.8, // TRL: lira 1953 par rate
  GR: 30.0, // GRD: post-April-1953 Markezinis devaluation rate (30 dr/USD, game-abstract)
  AT: 26.0, // ATS: 1953 Bretton Woods schilling parity
  FI: 230.0, // FIM: 1953 old markka par (redenominated 100:1 in 1963 — cf. FR old francs)

  // ── Warsaw Pact / non-aligned satellites (refs #3778 §1) ───────────────────
  // These six are NOT in FOREX_ACTIVE_COUNTRIES and `seedExchangeRates` never
  // writes a row for them — they are budget-only economies. The entries exist so
  // ERA_COUNTRY_CONFIG_OVERRIDES["1953-default"] has ONE table to derive its
  // `usdExchangeRate` from, exactly as the forex-active countries above do, and
  // so the two never drift apart again.
  //
  // WHY NOT THE OFFICIAL PARITY. Every bloc currency had a published gold parity
  // and a resulting official USD rate, and every one of them was an accounting
  // fiction: the plan, not a market, set it, and no one could transact at it.
  // Converting an authored plan-accounting national GDP at the official parity
  // produces absurd results — Poland would read as a $75B economy in 1953, more
  // than West Germany plus the United Kingdom combined. This repo already made
  // that call once, for RU above: the official rouble rate was 4/USD and the
  // seed uses 9/USD instead, citing the Western GNP-estimate basis. The same
  // ruling is applied here, and each entry records the official rate it departs
  // from and the documented rate or cross it lands on. Every result is
  // sanity-checked against Maddison-consistent 1953 USD GDP and against the
  // seeded GDR ($11.9B / 18.4M people) as the in-world yardstick.
  PL: 24.0, // PLZ: official parity 4 zł/USD (30 Oct 1950 reform, gold content
  // 0.222168 g — the same as the rouble, hence the 1:1 rouble cross). The
  // NON-COMMERCIAL / tourist rate was 24 zł/USD. At 4 the authored zł 300B seed
  // reads $75B; at 24 it reads ~$12.5B (~$490/capita), just above the GDR in
  // total and well below it per head — the historically correct shape for a
  // 25.5M-person economy that was poorer per head than East Germany.
  CS: 27.0, // CSK: the 1 June 1953 reform set the base rate at 7.20 Kčs/USD
  // (gold content 0.123426 g). For non-socialist settlement a coefficient of
  // 3.75 applied, giving 27 Kčs/USD for tourism — the rate a Westerner actually
  // faced. At 7.20 the authored Kčs 200B seed reads $27.8B, larger than West
  // Germany; at 27 it reads ~$7.4B (~$600/capita), the richest bloc economy per
  // head after the GDR, which matches Czechoslovakia's prewar Skoda/ČKD base.
  RO: 13.5, // ROL: the 1952 reform re-pegged the leu to gold, and the Jan 1954
  // parity (0.148112 g) gives the familiar official 6 lei/USD and a 1.50
  // lei/rouble cross. The leu was pegged to the ROUBLE, not the dollar, so the
  // cross is the meaningful number: carried through this repo's own 9 SUR/USD
  // Soviet basis (see RU above) it gives 1.50 × 9 = 13.5 lei/USD. At the
  // official 6 the authored lei 80B seed reads $13.3B (~$800/capita — richer
  // than Czechoslovakia); at 13.5 it reads ~$5.9B (~$357/capita).
  HU: 20.0, // HUF: official parity 11.74 Ft/USD (1946 forint reform, held
  // nominally until 1976); separate tourist rates from 1 April 1957, and the
  // "devisa forint" was set at 30 Ft/USD in 1968. Neither bracket fits 1953: at
  // 11.74 the authored Ft 100B seed reads $8.5B (~$897/capita, richer than
  // Czechoslovakia); at 30 it reads $3.3B (~$351/capita, below Romania). 20 Ft
  // sits between the two published rates and lands ~$5.0B (~$526/capita) —
  // between Poland and Czechoslovakia, matching Maddison's 1953 ordering.
  BG: 15.3, // BGL: the May 1952 reform fixed the lev's gold content at
  // 0.130687 g in line with the rouble, giving official rates of 1.70
  // leva/rouble and 6.80 leva/dollar. As with RO the rouble cross is the real
  // peg, so it is carried through the repo's 9 SUR/USD basis: 1.70 × 9 = 15.3
  // leva/USD. At the official 6.80 the authored leva 40B seed reads $5.9B
  // (~$600/capita — Bulgaria richer per head than Poland, which is wrong); at
  // 15.3 it reads ~$2.6B (~$358/capita), the smallest bloc economy.
  YU: 16.667, // YUD: Yugoslavia left the bloc in 1948, so there is no rouble
  // cross. Its official rate was 300 din/USD from the IMF-advised January 1952
  // devaluation (from 50) until 1961, though effective rates averaged ~2x that
  // by end-1953 under a multiple-rate system. 300 cannot be applied directly
  // because the two YU seeds disagree on magnitude: `yuRegions1953` is authored
  // in REAL dinars (Σ ₮1.8T, which at 300 is ~$6.0B — correct), but the national
  // budget seed is a ₮100B game unit 18x smaller, and `reconcileStateGdp`
  // normalizes the regions DOWN to it. So the era rate carries the same 18x:
  // 300 / 18 = 16.667 din/USD reproduces the real-dinar answer, ~$6.0B
  // (~$355/capita). Fixing the ₮100B magnitude instead would rescale every YU
  // local-currency budget line by 18 while its absolute per-capita law costs
  // stayed put — tracked separately, not carried in this change.
};

/**
 * 1979-era starting exchange rates (local currency per 1 USD). Real ~1979 annual
 * averages / administered rates. Covers the Cold-War forex-active roster.
 */
export const INITIAL_RATES_1979: Partial<Record<CountryId, number>> = {
  US: 1.0,
  UK: 0.47, // GBP/USD 1979 avg
  JP: 219.0, // JPY/USD 1979 avg
  DE: 0.936, // 1.83 DEM/USD ÷ 1.95583 DEM/EUR (EUR-equiv)
  // IEP: Ireland joined EMS Mar 1979 and broke the 1:1 GBP peg; seed floats
  // (no hardPeg). Rate near contemporaneous GBP as a starting value.
  IE: 0.47,
  BR: 5.0, // cruzeiro placeholder (high-inflation era)
  CN: 1.55, // CNY/USD official 1979
  NG: 0.6, // naira/USD 1979 (strong pre-oil-bust naira)
  RU: 2.22, // SUR/USD administered
  DD: 2.22, // DDM/USD administered (config 0.45 USD/DDM)
  FR: 4.2, // FRF/USD 1979
  IT: 833.0, // ITL/USD 1979 (~830 lira)
  ES: 67.0, // ESP/USD 1979 (~67 pesetas)
  SE: 4.29, // SEK/USD 1979
  TR: 34.5, // TRL/USD 1979 (~35 lira)
  GR: 37.0, // GRD/USD 1979 (~37 drachmae)
  AT: 13.4, // ATS/USD 1979 (hard-schilling DM shadow)
  FI: 3.9, // FIM/USD 1979 (post-devaluation markka)
};

/**
 * Return the initial exchange rates for the given preset.
 * Falls back to INITIAL_RATES (2019-era) for unknown presets.
 */
export function getInitialRates(preset: string): Partial<Record<CountryId, number>> {
  if (preset === "1953-default") return INITIAL_RATES_1953;
  if (preset === "1979-default") return INITIAL_RATES_1979;
  if (preset === "1991-default") return INITIAL_RATES_1991;
  // 1999 and 2007 have no authored table and used to fall through to the 2019
  // one, so a 1999 world started with 2019 money: Nigeria at 1550 naira/USD
  // when the real 1999 rate was about 97, a 16x error on day one. Interpolate
  // between the authored anchors instead. See getInitialRatesForYear.
  const year = getStartingYearForPreset(preset);
  if (year !== STARTING_YEAR) return getInitialRatesForYear(year);
  return INITIAL_RATES;
}

/**
 * Authored exchange-rate anchors, ascending by year.
 *
 * Built on CALL, not at module load. `STARTING_YEAR` comes from `turnTime`,
 * which some suites mock; evaluating it in a module-level const made importing
 * this file throw whenever that mock was in place (it took out
 * `centralBankChairSelection.test.ts`). Resolving inside the function keeps the
 * import graph inert.
 */
function rateAnchors(): ReadonlyArray<{ year: number; rates: Partial<Record<CountryId, number>> }> {
  return [
    { year: 1953, rates: INITIAL_RATES_1953 },
    { year: 1979, rates: INITIAL_RATES_1979 },
    { year: 1991, rates: INITIAL_RATES_1991 },
    { year: STARTING_YEAR, rates: INITIAL_RATES },
  ];
}

/**
 * Seed exchange rates for an arbitrary year, interpolated between the authored
 * anchors above.
 *
 * GEOMETRIC, not linear. Exchange rates compound — a currency that goes 9.9 to
 * 1550 over 28 years is running at a steady proportional rate, not adding a
 * fixed number of units per year. Straight-line interpolation of Nigeria at
 * 1999 gives about 450; the geometric mean gives about 42 against a real ~97.
 * Neither is exact, because that devaluation was not smooth, but one is the
 * right shape and the other is off by an order of magnitude in the wrong
 * direction.
 *
 * Deliberately NOT new authored history: this interpolates data that already
 * exists rather than inventing per-country year tables. Gentle by construction.
 *
 * Anchor identity: at an authored year the anchor's own table is returned
 * unchanged, so 1953/1979/1991/2019 worlds are byte-identical. Years past the
 * last anchor clamp to it rather than extrapolating a runaway curve.
 */
export function getInitialRatesForYear(year: number): Partial<Record<CountryId, number>> {
  if (!Number.isFinite(year)) return INITIAL_RATES;
  const anchors = rateAnchors();
  const exact = anchors.find((a) => a.year === year);
  if (exact) return exact.rates;
  if (year <= anchors[0].year) return anchors[0].rates;
  const last = anchors[anchors.length - 1];
  if (year >= last.year) return last.rates;

  let lo = anchors[0];
  let hi = last;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (year >= anchors[i].year && year <= anchors[i + 1].year) {
      lo = anchors[i];
      hi = anchors[i + 1];
      break;
    }
  }
  const t = (year - lo.year) / (hi.year - lo.year);
  const out: Partial<Record<CountryId, number>> = {};
  const ids = new Set<string>([...Object.keys(lo.rates), ...Object.keys(hi.rates)]);
  for (const id of ids) {
    const key = id as CountryId;
    const a = lo.rates[key];
    const b = hi.rates[key];
    // A country present in only one anchor keeps that anchor's rate rather than
    // being dropped: a missing entry means "not authored", not "no currency".
    if (a == null || a <= 0) {
      if (b != null) out[key] = b;
      continue;
    }
    if (b == null || b <= 0) {
      out[key] = a;
      continue;
    }
    out[key] = Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
  }
  return out;
}

/**
 * Seed-time hard peg for exchange-rate docs. When set, `processForexTurn`
 * holds the rate fixed (skips macro drift / intervention) until cleared.
 *
 * IE 1953: Irish pound at Bretton Woods par, legally 1:1 with sterling from the
 * 1927 Currency Act through EMS entry in March 1979 (Currency Commission, then
 * Central Bank of Ireland from 1943). A fixed hardPeg at the seeded GBP-par
 * rate models that link under Bretton Woods (both currencies dollar-pegged at
 * the same par). Live tracking of GBP if sterling later drifts is a follow-up.
 */
export function getSeedHardPeg(countryId: CountryId, preset: string): number | undefined {
  if (preset === "1953-default" && countryId === "IE") {
    return INITIAL_RATES_1953.IE;
  }
  return undefined;
}

// ── Spread fee split ─────────────────────────────────────────────────────────
// Each spread fee splits three ways (must sum to 1): a deflationary money sink,
// home-currency CB revenue, and the foreign-currency reserve slice that builds
// FX reserves. Weighted toward reserves so foreign reserves accrue meaningfully.
/** Fraction of spread fees destroyed (deflationary sink) */
export const SPREAD_FEE_DESTROY_RATIO = 0.25;
/** Fraction of each spread fee booked as home-currency central-bank revenue */
export const SPREAD_FEE_FOREX_REVENUE_RATIO = 0.25;
/** Fraction of each spread fee accrued as a foreign-currency reserve (builds FX reserves) */
export const SPREAD_FEE_RESERVE_RATIO = 0.5;
/** Fraction of spread fees deposited to the central bank (revenue + reserves) */
export const SPREAD_FEE_CENTRAL_BANK_RATIO =
  SPREAD_FEE_FOREX_REVENUE_RATIO + SPREAD_FEE_RESERVE_RATIO;

/** Human-readable currency symbols for display */
export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: "$",
  GBP: "£",
  JPY: "¥",
  CAD: "C$",
  EUR: "€",
  IEP: "IR£",
  BRL: "R$",
  CNY: "¥",
  NGN: "₦",
  HUF: "Ft",
  PLZ: "zł",
  ROL: "lei",
  YUD: "din",
  BGL: "лв",
  CSK: "Kčs",
  SUR: "руб",
  FRF: "₣",
  ITL: "₤",
  ESP: "₧",
  SEK: "kr",
  TRL: "₺",
  GRD: "₯",
  ATS: "öS",
  FIM: "mk",
  DDM: "M",
};

/** Presets where the Eurozone currency union had not yet been formed.
 *  EUR did not exist; DE used DM, IE used IEP. */
const PRE_EUROZONE_PRESETS = new Set<string>(["1953-default", "1979-default", "1991-default"]);

/** Presets where Brazil's Real (BRL) had not yet replaced the Cruzeiro.
 *  The Real was introduced 1 July 1994. */
const PRE_REAL_PRESETS = new Set<string>(["1953-default", "1979-default", "1991-default"]);

/**
 * Returns the player-visible currency symbol for `code` in the given game
 * context, accounting for historical currency regimes in early-era presets.
 *
 * Internal codes: DE stays on EUR (DM proxy pre-euro); IE uses IEP. Display:
 * - EUR + DE → "DM" in pre-eurozone presets when eurozone is off
 * - IEP → "€" when eurozone is on; "IR£" otherwise
 * - BRL → "Cr$" in pre-Real presets
 *
 * `anchorCountryId` picks the right pre-euro label for EUR. When absent,
 * EUR always falls back to "€".
 */
export function getEraAwareCurrencySymbol(
  code: CurrencyCode,
  preset: string,
  eurozoneEnabled: boolean,
  anchorCountryId?: CountryId
): string {
  if (code === "IEP") {
    return eurozoneEnabled ? "€" : CURRENCY_SYMBOLS.IEP;
  }
  if (code === "EUR" && !eurozoneEnabled && PRE_EUROZONE_PRESETS.has(preset)) {
    if (anchorCountryId === "DE") return "DM";
    // Legacy callers that still pass IE with EUR code (pre-IEP split).
    if (anchorCountryId === "IE") return "IEP";
  }
  if (code === "BRL" && PRE_REAL_PRESETS.has(preset)) return "Cr$";
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** Baseline real-economy values per country for FX macro drift. */
export interface EconomicBaseline {
  gdpGrowth: number;
  tradeGrowth: number;
}

export const ECONOMIC_BASELINES: Partial<Record<CountryId, EconomicBaseline>> = {
  US: { gdpGrowth: 2.5, tradeGrowth: 0 },
  UK: { gdpGrowth: 1.5, tradeGrowth: 0 },
  JP: { gdpGrowth: 1.0, tradeGrowth: 0 },
  DE: { gdpGrowth: 1.5, tradeGrowth: 0 },
  IE: { gdpGrowth: 3.5, tradeGrowth: 2.5 },
  BR: { gdpGrowth: 2.5, tradeGrowth: 2.0 },
  CN: { gdpGrowth: 5.0, tradeGrowth: 4.0 },
  NG: { gdpGrowth: 3.0, tradeGrowth: 2.5 },
};

/**
 * Central-bank policy baselines.
 *
 * These are the fair-play reference points for judging monetary policy, not a
 * promise that a country starts every scenario there. Developed markets share a
 * low-inflation/low-rate regime; emerging markets retain higher nominal neutral
 * rates without making crisis-level inflation (e.g. Nigeria's 20%+) "normal".
 */
export interface MonetaryBaseline {
  targetInflation: number;
  neutralPrimeRate: number;
}

export const MONETARY_BASELINES: Record<CountryId, MonetaryBaseline> = {
  US: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  UK: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  JP: { targetInflation: 1.0, neutralPrimeRate: 1.0 },
  DE: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  IE: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  BR: { targetInflation: 4.0, neutralPrimeRate: 8.0 },
  CN: { targetInflation: 2.0, neutralPrimeRate: 4.0 },
  NG: { targetInflation: 6.0, neutralPrimeRate: 12.0 },
  HU: { targetInflation: 3.0, neutralPrimeRate: 5.0 },
  PL: { targetInflation: 4.0, neutralPrimeRate: 5.0 },
  RO: { targetInflation: 3.0, neutralPrimeRate: 5.0 },
  YU: { targetInflation: 15.0, neutralPrimeRate: 12.0 }, // Yugoslav high-inflation
  BG: { targetInflation: 2.0, neutralPrimeRate: 4.0 },
  BLR: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  UKR: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  CS: { targetInflation: 2.0, neutralPrimeRate: 4.0 },
  BAL: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  RU: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  FR: { targetInflation: 10.0, neutralPrimeRate: 9.5 }, // late-1970s French inflation
  IT: { targetInflation: 15.0, neutralPrimeRate: 12.0 }, // late-1970s Italian inflation
  ES: { targetInflation: 16.0, neutralPrimeRate: 14.0 }, // late-1970s Spanish transition inflation
  SE: { targetInflation: 8.0, neutralPrimeRate: 9.0 }, // late-1970s Swedish inflation
  TR: { targetInflation: 20.0, neutralPrimeRate: 20.0 }, // late-1970s Turkish crisis inflation
  GR: { targetInflation: 15.0, neutralPrimeRate: 16.5 }, // late-1970s drachma inflation regime
  AT: { targetInflation: 4.0, neutralPrimeRate: 5.5 }, // hard-schilling DM shadow policy
  FI: { targetInflation: 6.0, neutralPrimeRate: 8.5 }, // late-1970s markka devaluation-cycle regime
  DD: { targetInflation: 2.0, neutralPrimeRate: 5.0 }, // administered GDR planned-economy prices
  SCO: { targetInflation: 2.0, neutralPrimeRate: 3.0 }, // mirrors UK (sterling zone)
  WAL: { targetInflation: 2.0, neutralPrimeRate: 3.0 }, // mirrors UK (sterling zone)
};

// ── FX Intervention (chair standing policy) ─────────────────────────────────

/** Scales synthetic volume per unit of breach distance. Tunable during playtest.
 *  A persistent 3% breach should burn a typical reserve pool in ~15–20 turns.
 *  Raised from 2,000 → 20,000,000 after forex revenue/transfer accumulation
 *  pushed real reserve pools into the billions. */
export const INTERVENTION_AGGRESSIVENESS = 20_000_000;

/** Turns a chair must wait between narrow/cancel actions. Matches prime-rate cadence. */
export const INTERVENTION_POLICY_COOLDOWN_TURNS = 6;

/** Infamy penalty for a single breach-cycle failure (reserves depleted or guardrail hit). */
export const INTERVENTION_FAILURE_INFAMY = 15;

/** Max fraction of annual federal revenue that can move from Treasury → FX reserve per turn. */
export const TREASURY_TRANSFER_MAX_PER_TURN_FRACTION = 0.005;

/** Max intervention audit-log entries retained per currency. */
export const INTERVENTION_HISTORY_MAX = 24;

/** Max treasury-transfer audit-log entries retained per central bank. */
export const TREASURY_TRANSFER_HISTORY_MAX = 50;

/**
 * The authored era rate for a currency (local units per ₳), independent of
 * whether `exchangeRates` carries a row for it.
 *
 * ⚠️ This exists because "has a currency code" and "has an exchange-rate row"
 * are NOT the same set. `COUNTRY_CURRENCY_MAP` assigns a currency to 28
 * countries; `FOREX_ACTIVE_COUNTRIES` lists 18. The ten-country gap includes the
 * six Warsaw-Pact members, which are deliberately budget-only economies — see
 * INITIAL_RATES_1953's note — so `seedExchangeRates` never writes them a row.
 *
 * Every FX helper that branched on the CODE therefore took the convert path,
 * found no document, and fell through to 1.0 — valuing a Polish corporation's
 * złoty revenue as though 1 zł = ₳1, a ~24x overstatement on the 1953 rate.
 * `commodityPriceTurn.ts` already worked around this for budgets and stated the
 * rule: "The authored era rate is the correct answer, so resolve it from the
 * preset's table before conceding to 1.0." This is that rule, extracted so the
 * corporation-valuation helpers can apply it too.
 *
 * Returns `undefined` for a code no country uses, so callers keep their own
 * final fallback rather than being handed a fabricated rate.
 */
export function eraRateForCurrency(
  code: CurrencyCode | undefined,
  preset: string | undefined
): number | undefined {
  if (!code) return undefined;
  const eraRates = getInitialRates(preset ?? "");
  for (const [countryId, assigned] of Object.entries(COUNTRY_CURRENCY_MAP)) {
    if (assigned !== code) continue;
    const rate = eraRates[countryId as CountryId] ?? INITIAL_RATES[countryId as CountryId];
    if (rate !== undefined && rate > 0) return rate;
  }
  return undefined;
}
