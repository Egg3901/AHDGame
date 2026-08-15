/**
 * Commodity system constants.
 * Maps sector types to the commodities they supply and demand.
 * Only owned sectors create demand or supply.
 *
 * Retail generates consumer demand for ALL commodities, scaled by GDP growth
 * (50% national average + 50% regional). This makes retail the primary demand
 * driver for the commodity market.
 *
 * Supply/demand in UNITS:
 *   units = (sector daily revenue × rate) / basePrice
 *
 * Market price is dynamic with sliding logarithmic returns:
 *   rawRatio = max(totalDemand, MIN_COMMODITY_FLOW_UNITS) / max(totalSupply, MIN_COMMODITY_FLOW_UNITS)
 *   effectiveRatio = rawRatio inside the 3x soft-knee, compressed beyond it
 *   if effectiveRatio >= 1: price = basePrice × (1 + PRICE_LOG_SCALE × ln(effectiveRatio))
 *   else:                   price = basePrice / (1 + PRICE_LOG_SCALE × ln(1 / effectiveRatio))
 *
 * Pricing blend: 50% global + 25% national (country-aggregate) + 25% regional (state-level).
 */

import type { CorporationType } from "./corporations";
import { getEffectiveStrategyRates, applyPlannedEconomyOutputMix } from "./sectorStrategies";
import { getOutputMultiplier, getInputMultiplier } from "@/lib/utils/productionPolicy";
import { TRADE_EMBARGO_EXPORT_LOSS_SHARE } from "@/lib/trade/constants";

export const COMMODITY_TYPES = [
  "steel",
  "electronics",
  "energy",
  "chemicals",
  "pharmaceuticals",
  "fertilizers",
  "food",
  "building_materials",
  "construction_services",
  "healthcare_services",
  "real_estate_services",
  "software",
  "financial_services",
  "advertising",
  "vehicles",
  "retail",
  "freight",
  "consulting_services",
  "iron",
  "coal",
  "oil",
  "rare_earth",
  "timber",
  "natural_gas",
  "ordnance",
  "plastics",
  "network_services",
  "entertainment_services",
] as const;

export type CommodityType = (typeof COMMODITY_TYPES)[number];

export const EXTRACTABLE_RESOURCES = [
  "oil",
  "coal",
  "iron",
  "natural_gas",
  "timber",
  "rare_earth",
] as const;

export type ExtractableResource = (typeof EXTRACTABLE_RESOURCES)[number];

/**
 * Per-resource extraction output scale (audit t873, "structural extraction
 * shortage"). In the S/D ratio the base price cancels, so a commodity's
 * shortage is purely Σ(extraction_revenue × supply_rate) vs Σ(manufacturing
 * _revenue × demand_rate) — and manufacturing sectors out-mass extraction in
 * revenue, so every extractable runs chronically short (copper/rare_earth 4-5×,
 * iron/gas 2-3×). This map lifts the supply side per-resource, calibrated to how
 * short each one is (coal is near-balanced, so it stays 1.0 and is omitted).
 *
 * This is a CALIBRATION STABILIZER, not the durable fix: it gets the board to a
 * sane starting point so the clearing/capital tiers can equilibrate (shortage →
 * premium → extraction profit → investment → supply) from there. It is a static
 * multiplier and will drift as the economy grows — re-tune periodically.
 *
 * Gated: only applied when gameConfig.extractionOutputScaleEnabled is true, so
 * it is inert on prod until deliberately dialed in (same pattern as
 * marketSystemMode). Applied BEFORE the capacity haircut so the boost fills the
 * ample idle deposit capacity rather than exceeding it.
 *
 * RE-TUNE FLAG (t961, before first enabling live): copper's 2.5× was
 * calibrated at t873 against a global copper S/D that has since also received
 * a large one-off manual boost (5 focused sectors at ₳25M each, ~+10,000 tons,
 * see ops-knowledge memory ahd-copper-structural-formula-t873) — a much bigger
 * per-resource intervention than any other entry here got. Live check at t972:
 * copper S/D is still 0.49 (51% idle capacity) so there's no evidence of an
 * immediate overshoot, but stacking the full systemic 2.5× on top of that
 * manual boost is more supply-side lift than this value was actually
 * calibrated for. Worth a deliberate call on whether to trim this before
 * flipping extractionOutputScaleEnabled on, rather than assuming 2.5× still
 * holds unchanged — not adjusted here since that's a live economic judgment
 * call, not a mechanical fix.
 */
export const EXTRACTION_OUTPUT_SCALE: Partial<Record<ExtractableResource, number>> = {
  rare_earth: 2.5,
  natural_gas: 2.0,
  iron: 1.8,
  timber: 1.6,
  oil: 1.4,
  // coal omitted — S/D ~0.84 is already near-balanced; scaling it would glut.
};

/**
 * Resolve the output-scale multiplier for one resource. Returns 1 (inert) when
 * the feature is disabled or the commodity isn't a scaled extractable, so
 * callers can multiply unconditionally.
 */
export function extractionOutputScaleFor(commodity: CommodityType, enabled: boolean): number {
  if (!enabled) return 1;
  return EXTRACTION_OUTPUT_SCALE[commodity as ExtractableResource] ?? 1;
}

/**
 * Per-state commodity list prices normally use a 50/25/25 blend of global,
 * national (country-aggregate), and regional (state) raw prices. For these
 * commodities the *regional* leg falls through to country-national S/D — state
 * activity is meaningless because the market is driven by nationwide budgets,
 * campaigns, or bond issuance rather than a single state's local balance, so the
 * effective blend becomes 50% global + 50% national.
 */
export const COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND: ReadonlySet<CommodityType> = new Set([
  "financial_services",
  "healthcare_services",
  "advertising",
  "real_estate_services",
]);

export const COMMODITY_LABELS: Record<CommodityType, string> = {
  steel: "Steel & Metals",
  electronics: "Electronics & Semiconductors",
  energy: "Electricity",
  chemicals: "Industrial Chemicals",
  pharmaceuticals: "Pharmaceuticals",
  fertilizers: "Fertilizers",
  food: "Food Products",
  building_materials: "Building Materials",
  construction_services: "Construction Services",
  healthcare_services: "Healthcare Services",
  real_estate_services: "Real Estate Services",
  software: "Software & IT Services",
  financial_services: "Financial Services",
  advertising: "Advertising & Media",
  vehicles: "Vehicles & Machinery",
  retail: "Consumer Goods",
  freight: "Freight & Transportation",
  consulting_services: "Consulting Services",
  iron: "Iron Ore",
  coal: "Coal",
  oil: "Crude Oil",
  rare_earth: "Rare Earth Minerals",
  timber: "Timber & Lumber",
  natural_gas: "Natural Gas",
  ordnance: "Ordnance & Weapons Systems",
  plastics: "Plastics & Polymers",
  network_services: "Network Services",
  entertainment_services: "Entertainment Services",
};

export const COMMODITY_ICONS: Record<CommodityType, string> = {
  steel: "Fe",
  electronics: "Si",
  energy: "kW",
  chemicals: "Ch",
  pharmaceuticals: "Rx",
  fertilizers: "NPK",
  food: "Ag",
  building_materials: "BM",
  construction_services: "Cn",
  healthcare_services: "HC",
  real_estate_services: "RE",
  software: "SW",
  financial_services: "Fi",
  advertising: "Ad",
  vehicles: "Ve",
  retail: "CG",
  freight: "Fr",
  consulting_services: "Cs",
  iron: "Fe",
  coal: "Co",
  oil: "Oi",
  rare_earth: "RE",
  timber: "Ti",
  natural_gas: "NG",
  ordnance: "Ord",
  plastics: "Pl",
  network_services: "NS",
  entertainment_services: "Ent",
};

/** Hero image slug for each commodity (served by /api/images/hero/[slug]) */
export const COMMODITY_HERO_SLUGS: Record<CommodityType, string> = {
  steel: "commodity-steel",
  electronics: "commodity-electronics",
  energy: "commodity-energy",
  chemicals: "commodity-chemicals",
  pharmaceuticals: "commodity-pharmaceuticals",
  fertilizers: "commodity-fertilizers",
  food: "commodity-food",
  building_materials: "commodity-building-materials",
  construction_services: "commodity-construction-services",
  healthcare_services: "commodity-healthcare-services",
  real_estate_services: "commodity-real-estate-services",
  software: "commodity-software",
  financial_services: "commodity-financial-services",
  advertising: "commodity-advertising",
  vehicles: "commodity-vehicles",
  retail: "commodity-retail",
  freight: "commodity-freight",
  consulting_services: "commodity-consulting-services",
  iron: "commodity-iron",
  coal: "commodity-coal",
  oil: "commodity-oil",
  rare_earth: "commodity-rare-earth",
  timber: "commodity-timber",
  natural_gas: "commodity-natural-gas",
  ordnance: "commodity-ordnance",
  plastics: "commodity-plastics",
  network_services: "commodity-network-services",
  entertainment_services: "commodity-entertainment-services",
};

/** Alt text for commodity hero images */
export const COMMODITY_HERO_ALTS: Record<CommodityType, string> = {
  steel: "Showa Steel Works industrial facility",
  electronics: "TSMC semiconductor fabrication plant",
  energy: "High-voltage power lines at sunset",
  chemicals: "BASF chemical plant in Ludwigshafen",
  pharmaceuticals: "Pharmaceutical manufacturing line with packaged medicines",
  fertilizers: "Agricultural fertilizer spreader in a crop field",
  food: "Combine harvester gathering wheat",
  building_materials: "Construction site with building materials",
  construction_services: "Construction crews working on a high-rise project",
  healthcare_services: "Modern hospital ward providing patient care",
  real_estate_services: "Residential and commercial real estate skyline",
  software: "Wikimedia Foundation server room",
  financial_services: "New York Stock Exchange building on Wall Street",
  advertising: "Broadway and Times Square lit up at night",
  vehicles: "Hyundai car assembly line",
  retail: "Macy's department store at Herald Square",
  freight: "Sovereign Maersk container ship at sea",
  consulting_services: "Booz Allen Hamilton office in Washington D.C.",
  iron: "Iron ore factory in Karnataka, India",
  coal: "North Antelope Rochelle coal mine, Wyoming",
  oil: "Petrobras P-51 offshore oil platform, Brazil",
  rare_earth:
    "Rare earth oxide samples: praseodymium, cerium, lanthanum, neodymium, samarium, gadolinium",
  timber: "Timber logging operation in the Pacific Northwest",
  natural_gas: "Natural gas processing plant and pipeline infrastructure",
  ordnance: "Ordnance assembly line at a weapons manufacturing facility",
  plastics: "Industrial polymer extrusion and plastics manufacturing plant",
  network_services: "Fiber optic data center network infrastructure",
  entertainment_services: "Concert arena filled with an audience",
};

/**
 * Base price per unit for each commodity (in dollars).
 * Used to convert dollar-equivalent flows into unit quantities.
 */
export const COMMODITY_BASE_PRICES: Record<CommodityType, number> = {
  steel: 800, // $/ton
  electronics: 500, // $/unit
  energy: 60, // $/MWh
  chemicals: 220, // $/barrel-equivalent
  pharmaceuticals: 1200, // $/lot
  fertilizers: 180, // $/ton
  food: 200, // $/ton
  building_materials: 400, // $/ton
  construction_services: 3500, // $/crew-day
  healthcare_services: 2500, // $/visit-equivalent
  real_estate_services: 2200, // $/lease-equivalent
  software: 1000, // $/license-seat
  financial_services: 2000, // $/contract
  advertising: 150, // $/campaign-unit
  vehicles: 25000, // $/vehicle
  retail: 150, // $/basket (consumer goods basket)
  freight: 3000, // $/TEU (twenty-foot equivalent container unit)
  consulting_services: 5000, // $/engagement
  iron: 120, // $/ton
  coal: 150, // $/ton
  oil: 80, // $/barrel
  rare_earth: 21000, // $/ton — merged copper + rare earth ("Rare Earth Minerals"); demand-weighted blend of copper $9k + rare earth $50k
  timber: 400, // $/m³
  natural_gas: 25, // $/MMBtu
  ordnance: 4500, // $/lot (weapons system lot)
  plastics: 1000, // $/ton
  network_services: 1200, // $/subscription-equivalent
  entertainment_services: 600, // $/event-equivalent
};

/**
 * The base-price table on a world's ERA unit basis: every entry divided by the
 * era unit scale (`getEraUnitScale(preset)` — 1 for modern worlds, ~70 for
 * 1953). Dividing prices by the scale is exactly equivalent to multiplying
 * unit counts by it, so a pipeline that adopts this table wholesale moves ALL
 * of its ₳↔unit conversions, its ratio terms (which cancel) and its price
 * LEVELS onto the era basis in one substitution — which also lands the price
 * levels on the same magnitudes `seedCommodityPrices` era-seeds into the
 * commodity docs. Returns the shared modern table untouched at scale 1 so
 * every live world is byte-identical and no per-turn allocation happens.
 */
export function eraScaledBasePrices(unitScale: number): Record<CommodityType, number> {
  if (!(typeof unitScale === "number" && Number.isFinite(unitScale)) || unitScale === 1) {
    return COMMODITY_BASE_PRICES;
  }
  const scaled = {} as Record<CommodityType, number>;
  for (const key of Object.keys(COMMODITY_BASE_PRICES) as CommodityType[]) {
    scaled[key] = Math.max(0.01, COMMODITY_BASE_PRICES[key] / unitScale);
  }
  return scaled;
}

/** Unit labels for display (e.g., "tons", "MWh") */
export const COMMODITY_UNITS: Record<CommodityType, string> = {
  steel: "tons",
  electronics: "units",
  energy: "MWh",
  chemicals: "bbl",
  pharmaceuticals: "lots",
  fertilizers: "tons",
  food: "tons",
  building_materials: "tons",
  construction_services: "crew-days",
  healthcare_services: "visits",
  real_estate_services: "leases",
  software: "seats",
  financial_services: "contracts",
  advertising: "campaigns",
  vehicles: "vehicles",
  retail: "baskets",
  freight: "TEU",
  consulting_services: "engagements",
  iron: "tons",
  coal: "tons",
  oil: "bbl",
  rare_earth: "tons",
  timber: "m³",
  natural_gas: "MMBtu",
  ordnance: "lots",
  plastics: "tons",
  network_services: "subscriptions",
  entertainment_services: "events",
};

/**
 * Small unit floor for commodity markets and sector modifiers.
 * Prevents divide-by-zero while still letting no-supply / no-demand scenarios
 * keep moving as the opposite side grows.
 */
export const MIN_COMMODITY_FLOW_UNITS = 0.01;

/**
 * Base supply and demand added to every commodity at the global level.
 * Acts as a stabilizer — prevents extreme price swings when real activity
 * is near zero (e.g. early game). At 50,000 it is only ~2% of a high-volume
 * market like iron, but 70–85% of a thin market like copper or rare earth, so
 * it currently flattens those thin markets' displayed ratios toward 1.0×
 * regardless of real supply (audit t786). Prefer COMMODITY_STABILIZER below,
 * which sizes the stabilizer per-commodity; this flat value is retained only as
 * the fallback for any commodity missing from that map.
 */
export const BASE_COMMODITY_SUPPLY_DEMAND = 50_000;

/**
 * Per-commodity global stabilizer, added to both supply and demand before
 * computing global prices/ratios. Sized to ~5% of each commodity's real
 * activity (clamped to [1500, 50000]), calibrated against live turn-787
 * demand (audit t786). This keeps the stabilizer a small, roughly uniform
 * fraction of every market instead of a flat 50k that dominated thin markets
 * (copper/rare_earth/ordnance/vehicles were 70–85% stabilizer, pinning their
 * displayed ratios near 1.0× regardless of a real 5–35× shortage).
 *
 * Big markets keep 50k (already <5% of their flow, so behaviour is unchanged);
 * only thin markets drop, unmasking their true supply/demand pressure.
 */
export const COMMODITY_STABILIZER: Record<CommodityType, number> = {
  // thin markets — unmasked
  rare_earth: 4214, // merged: value-weighted sum of copper+rare-earth 1500-unit floors at the $21k base
  vehicles: 1500,
  ordnance: 1500,
  entertainment_services: 2900,
  healthcare_services: 3200,
  consulting_services: 4100,
  pharmaceuticals: 4400,
  construction_services: 4800,
  network_services: 5500,
  real_estate_services: 6900,
  freight: 9000,
  timber: 16000,
  financial_services: 17000,
  fertilizers: 18000,
  plastics: 25000,
  coal: 30000,
  building_materials: 38000,
  software: 40000,
  steel: 41000,
  food: 48000,
  // high-volume markets — unchanged from the flat 50k
  electronics: 50000,
  energy: 50000,
  chemicals: 50000,
  advertising: 50000,
  retail: 50000,
  iron: 50000,
  oil: 50000,
  natural_gas: 50000,
};

/**
 * Commodities income demographics demand as end consumers: EVERY commodity
 * EXCEPT the raw extractables (a household buys petrol/electronics/services,
 * not crude oil or copper ore). Consumers pull the whole finished + intermediate
 * chain; only the raw resources themselves are excluded (2026-07-06 owner spec).
 */
export const DEMOGRAPHIC_CONSUMER_COMMODITIES: readonly CommodityType[] = COMMODITY_TYPES.filter(
  (c) => !(EXTRACTABLE_RESOURCES as readonly string[]).includes(c)
);

/**
 * Demographic consumer demand model (`demographicsDemandEnabled`). Per state,
 * per non-extractable commodity, demand is UPLIFTED as a bounded fraction of
 * that commodity's EXISTING per-state demand:
 *
 *   demandUnits += existingDemand × DEMOGRAPHIC_UPLIFT_PCT × wealthMult
 *
 * Proportional-to-existing is the shock-free, realistic shape: existing demand
 * already encodes real consumption patterns (nobody spends equal ₳ on cars and
 * chewing gum), so a flat per-capita rate would swamp small categories (+1000%
 * on entertainment). It scales with POPULATION and GDP because existing demand
 * does (economy size = population × productivity), and `wealthMult` (GDP per
 * capita) makes richer states consume MORE of everything. Bounded so it never
 * shocks a shortage-prone market; still likely needs a small output-rate boost
 * when enabled (owner-flagged).
 */
export const DEMOGRAPHIC_UPLIFT_PCT = 0.1;
/** GDP-per-capita that reads as "par" wealth (wealthMult ≈ 1). */
export const DEMOGRAPHIC_GDP_PER_CAPITA_REF = 0.03;
/** Bounds on the wealth multiplier so extremes don't distort demand. */
export const DEMOGRAPHIC_WEALTH_MULT_MIN = 0.5;
export const DEMOGRAPHIC_WEALTH_MULT_MAX = 2.0;

/** Wealth multiplier for a state from its GDP per capita (richer → more consumption). */
export function demographicWealthMultiplier(gdp: number, population: number): number {
  if (!(population > 0) || !(gdp > 0)) return DEMOGRAPHIC_WEALTH_MULT_MIN;
  const perCapita = gdp / population;
  const raw = Math.sqrt(perCapita / DEMOGRAPHIC_GDP_PER_CAPITA_REF);
  return Math.max(DEMOGRAPHIC_WEALTH_MULT_MIN, Math.min(DEMOGRAPHIC_WEALTH_MULT_MAX, raw));
}

/** Global stabilizer for a commodity — per-commodity value, flat fallback. */
export function getCommodityStabilizer(commodity: CommodityType): number {
  return COMMODITY_STABILIZER[commodity] ?? BASE_COMMODITY_SUPPLY_DEMAND;
}

/**
 * State-level stabilizer for margin calculations only (not prices).
 * Applied in the output-blend margin path to prevent extreme ratios
 * when a state has zero supply of a commodity. At 250, a state with
 * no local production but 500 demand sees ratio = 750/250 = 3× instead
 * of 500/0.01 = 50,000×. State prices remain fully dynamic (no stabilizer).
 */
export const STATE_COMMODITY_SUPPLY_DEMAND = 250;

/**
 * State-level stabilizer for EXTRACTABLE RESOURCE margin calculations.
 * Oil, gas, iron, copper, timber, coal, and rare earth are globally traded —
 * a state with zero local extraction can realistically import these resources,
 * so treating the local zero-supply pocket as a hard shortage overstates the
 * margin penalty. At 2500, a state with no local oil but 1000 demand sees
 * ratio ≈ 2500/3500 = 0.71 instead of the 1000/250 = 4× the default stabilizer
 * would produce. State prices are unchanged (visual locality preserved).
 */
export const EXTRACTABLE_RESOURCE_STATE_STABILIZER = 2500;

/**
 * Country-level stabilizer added to both supply and demand before computing
 * national (country-aggregate) prices. At 500, a country with minimal sector
 * activity still produces a bounded ratio rather than a degenerate price spike.
 * Chosen to be ~10% of typical single-country S/D to smooth early-game noise
 * without masking real shortages.
 */
export const NATIONAL_COMMODITY_STABILIZER = 500;

/**
 * Bounded mean-reverting drift applied to every commodity's global supply
 * and demand, sized relative to that commodity's own stabilizer (audit
 * t101 follow-up: sandbox-seed-audit-t101 found commodities with zero owned-
 * sector footprint sitting at `supply === demand === stabilizer` forever —
 * 9 of 28 seeded commodities showed exactly 0.000% price deviation after
 * 101 turns). Supply and demand drift out of phase (±DRIFT_AMPLITUDE of the
 * stabilizer, opposite sine phase) so their ratio genuinely oscillates
 * instead of staying pinned — a real price signal for commodities nothing
 * currently produces/consumes, without inventing new GDP-share economics.
 * For commodities with real sector/macro-demand activity the term is
 * negligible (it scales with the commodity's own stabilizer, not with its
 * accumulated supply/demand), so this does not add noise on top of markets
 * that are already dynamic.
 *
 * Deliberately conservative starting values — retune with real playtesting
 * once this lands. See docs/plans/2026-07-03-market-structural-plan.md.
 */
export const UNOWNED_DRIFT_AMPLITUDE = 0.06;
/** Full drift cycle length in turns — bounds the perturbation to mean-revert rather than trend. */
export const UNOWNED_DRIFT_PERIOD_TURNS = 40;

/** Deterministic per-commodity phase offset in [0, 2π) so different commodities don't move in lockstep. */
function commodityDriftPhaseSeed(commodity: string): number {
  let hash = 0;
  for (let i = 0; i < commodity.length; i++) {
    hash = (hash * 31 + commodity.charCodeAt(i)) | 0;
  }
  const unit = (hash >>> 0) / 0xffffffff;
  return unit * 2 * Math.PI;
}

/**
 * Applies the bounded drift term in place to every commodity's global
 * supply/demand. No-op when `currentTurn` is unavailable (callers that don't
 * pass a turn number keep the pre-existing deterministic stabilizer-only
 * behavior, e.g. unit tests that don't care about turn-to-turn drift).
 */
function applyUnownedCommodityDrift(
  global: Map<CommodityType, { supply: number; demand: number }>,
  currentTurn: number | undefined
): void {
  if (currentTurn === undefined) return;
  for (const [commodity, balance] of global) {
    const stab = getCommodityStabilizer(commodity);
    const phase = commodityDriftPhaseSeed(commodity);
    const angle = (2 * Math.PI * currentTurn) / UNOWNED_DRIFT_PERIOD_TURNS + phase;
    // Opposite phase for supply vs. demand so the ratio itself oscillates,
    // not just both sides moving in lockstep (which would cancel out).
    balance.supply += stab * UNOWNED_DRIFT_AMPLITUDE * Math.sin(angle);
    balance.demand += stab * UNOWNED_DRIFT_AMPLITUDE * Math.sin(angle + Math.PI);
  }
}

/**
 * How strongly log supply/demand pressure moves market prices away from base.
 * Higher values make shortages and surpluses bite harder, while still applying
 * diminishing returns via the logarithm.
 */
export const COMMODITY_PRICE_LOG_SCALE = 0.7;

/**
 * Soft-knee for commodity pressure. Raw D/S remains visible in displays and
 * diagnostics, but price and margin math compress the tail beyond 3x shortage
 * or 3x oversupply so extreme markets still worsen without dominating balance.
 */
export const COMMODITY_PRESSURE_SOFT_KNEE = 3;

/**
 * Tail slope applied in log space after COMMODITY_PRESSURE_SOFT_KNEE.
 * At 0.25, each 4x increase in raw tail pressure acts like a 1.41x increase
 * in effective pressure. This is symmetric for shortages and oversupply.
 */
export const COMMODITY_PRESSURE_TAIL_SLOPE = 0.25;

/**
 * Wider soft-knee for the seven EXTRACTABLE resources in PRICE math.
 * The default knee (3) compresses pressure exactly where the clearing-era
 * economy is scarcest (rare earth ran 4.1× demand/supply at t899 with its
 * signal squashed to ~3.3× effective). Extractables are the commodities the
 * scarcity incentive most needs to reach, so their prices keep full pressure
 * fidelity out to 8× before tail compression. Margin math keeps the default
 * knee — this only widens what PRICES are allowed to say.
 */
export const EXTRACTABLE_PRESSURE_SOFT_KNEE = 8;

/** The soft-knee to use for a commodity's PRICE computation. */
export function getPriceSoftKnee(commodity: CommodityType): number {
  return (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity)
    ? EXTRACTABLE_PRESSURE_SOFT_KNEE
    : COMMODITY_PRESSURE_SOFT_KNEE;
}

/**
 * Fraction of corporate marketing budgets that converts to advertising commodity demand.
 * E.g. at 0.40, a $1M/day total marketing budget adds 2,667 campaign-units/day of demand
 * (1,000,000 × 0.40 / $150 base price = 2,667 campaigns/day).
 * History: 0.60 -> 0.40 to ease a critical advertising SHORTAGE (S/D ~0.38).
 * That market has since inverted completely — prod at turn 114 read 44x
 * OVERSUPPLIED with the price pinned to the 0.32x deflation clamp — so the cut
 * is reversed and then some. Raised to 0.90 alongside buyer-side rates for the
 * consumer-facing sectors that actually advertise; no single lever reaches a
 * 21x gap, and the rate caps at 1.0 (a corp cannot spend more than its whole
 * marketing budget).
 */
export const MARKETING_ADVERTISING_DEMAND_RATE = 0.9;

/**
 * Fraction of annual national healthcare budget spending (normalized to ₳) that
 * converts to healthcare_services commodity demand per turn. Calibrated so that
 * the US budget (~$935B ≈ ₳873B) produces ~180k demand units/turn, with UK and
 * JP scaling proportionally via their FX-adjusted spending.
 * Raw conversion: (annualSpendAnchor / 48 turns / ₳2500 base price) × rate.
 *
 * History: reduced in stages 0.025 → 0.018 → 0.013 → 0.005 against the OLD
 * era-inflated budgets (US ~$935B). The era-cost rework then cut those budgets
 * ~9x without touching this rate, collapsing healthcare demand to ~21% of
 * supply (issue #3137, forensic report t1048). Budgets were re-normalized to
 * real-world %GDP shares on 2026-07-12 (US $375B / UK $40B / JP ¥23.1T /
 * DE $180B / CN ¥48.5B / IE €3.7B), and this rate re-raised to 0.015 against
 * them: global D/S 0.335 → ~0.68, every country except DE below the 1.5
 * shortage cap (DE is structurally under-supplied — no rate fixes it; imports
 * relieve ~half via trade convergence). Staged follow-up: step toward
 * 0.02–0.025 (global band 0.9–1.1) once US/DE healthcare supply grows.
 */
export const GOVT_HEALTHCARE_DEMAND_RATE = 0.015;

/**
 * Budget category keys that all mean "government health spending", in priority
 * order.
 *
 * The seed reference authors most countries with `healthcare` but UK, CN and IE
 * with `health` (see `seeds/reference/budgets.ts`; `BASELINE_OVERRIDE_CATEGORIES`
 * there already lists both spellings). The commodity demand leg read only
 * `healthcare`, so those three countries produced ZERO healthcare_services
 * demand — the UK's NHS line, authored at £570M/yr with the comment "NHS — new
 * (1948) but growing fast", reached the market as nothing at all. Confirmed on
 * prod: UK, CN and IE were the only budgets carrying a defense line and no
 * healthcare line.
 *
 * Resolved by alias rather than renamed in the seed because live worlds already
 * hold documents spelled `health`, and a rename would need a migration to reach
 * them while this does not.
 */
/**
 * Share of a PLANNED economy's education budget that buys state broadcasting.
 *
 * A command economy funds its media directly rather than selling airtime, so
 * this is the buyer that replaces the advertising market its broadcasters were
 * pointed at (see `applyPlannedEconomyOutputMix`). Applies ONLY to planned
 * economies — a market economy's education budget buys no such thing.
 *
 * Sized against prod at turn 114. Poland's media puts out 731,673 units/day of
 * advertising, which value-conserves to 182,918 units/day of state
 * broadcasting; its education line is 19.4bn zloty, ~₳810M/yr at the era rate,
 * which is 1,962,000 units/turn of headroom at the era base price. 182,918 /
 * 1,962,000 = 0.093. Bloc-wide that is roughly ₳345M/yr of state media
 * spending, which is a real and visible slice of a propaganda state's budget
 * rather than a rounding error, and it lands bloc entertainment services near
 * balance instead of 700x oversupplied.
 */
export const STATE_MEDIA_DEMAND_RATE = 0.09;

export const GOVT_HEALTHCARE_BUDGET_CATEGORIES = ["healthcare", "health"] as const;

/**
 * Government budget category aliases per demand leg. Single-entry lists are the
 * normal case; healthcare is the one with a spelling split.
 */
export const GOVT_SPEND_CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  healthcare: GOVT_HEALTHCARE_BUDGET_CATEGORIES,
  defense: ["defense"],
};

/**
 * First matching category amount from a budget's `byCategory` map, in alias
 * priority order. First match rather than a sum: a document carries one
 * spelling, and summing would double-count anything that somehow held both.
 */
export function govtSpendForCategory(
  byCategory: Record<string, number> | undefined | null,
  aliases: readonly string[]
): number {
  if (!byCategory) return 0;
  for (const key of aliases) {
    const amount = byCategory[key];
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

/**
 * Fraction of a government's annual defense budget that converts to `ordnance`
 * demand (procurement of weapons systems), the defense analogue of
 * {@link GOVT_HEALTHCARE_DEMAND_RATE}.
 *
 * Before this existed, healthcare was the ONLY government budget category that
 * reached the commodity market, so `SECTOR_SUPPLY.defense` produced ordnance
 * with no state customer at all: the sole consumer was `SECTOR_DEMAND.extraction`
 * at 0.06 ("bulk mining explosives"). The result was that ordnance markets sized
 * themselves to a country's MINING industry — the largest were PL/RU/CS — while
 * the US defense budget ($53.5B/yr in the 1953 sandbox) generated exactly zero
 * demand and the commodity read as inert to players (#3880).
 *
 * Rate chosen at 0.005, not healthcare's 0.015. Reasons, measured against the
 * live 1953 sandbox at turn 20 (global ordnance S 2,069 / D 2,302, price 4,640
 * vs 4,500 base — the smallest real market in the game):
 *  - At 0.015 the same arithmetic adds ~5,743 units/turn: it triples the market
 *    and pins the price at the 1.81x shortage ceiling permanently, because only
 *    ~39 small defense sectors exist to supply it.
 *  - At 0.005 it adds ~1,914 units/turn → D/S ~2.04, price ~1.50x base. Firmly
 *    profitable for defense sectors, and it leaves headroom to raise the rate
 *    once defense supply actually grows.
 *  - Real 1953 defense budgets are majority personnel and operations, not
 *    procurement, so a procurement share well below the healthcare share is the
 *    historically defensible reading rather than a purely mechanical one.
 *
 * Known consequence, accepted: ordnance is a cost input to `extraction`, the
 * largest sector class, so a sustained ordnance price rise is mild cost-push
 * into mining. That is the intended trade — the alternative leaves the entire
 * defense industry without a customer.
 */
export const GOVT_DEFENSE_ORDNANCE_DEMAND_RATE = 0.005;

/**
 * Fraction of state GDP that converts to network_services demand (broadband/connectivity).
 * Raised 1e-6 → 4e-6: cross-sector B2B demand (technology, media, financial, retail,
 * entertainment all consuming network services) now adds substantial sector-derived
 * demand; the macro signal is proportionally larger to match.
 * At 4e-6, a $500B-GDP state generates ~1,667 units/day ($500B × 4e-6 / $1200 base price).
 */
export const NETWORK_SERVICES_GDP_DEMAND_FRACTION = 4e-6;

/**
 * Fraction of state GDP that converts to entertainment_services demand (leisure spending).
 * Raised 6e-7 → 2.5e-6: retail and media sectors now also demand entertainment services,
 * so the macro baseline is scaled to match the expanded demand profile.
 * At 2.5e-6, a $500B-GDP state generates ~2,083 units/day ($500B × 2.5e-6 / $600 base price).
 */
export const ENTERTAINMENT_SERVICES_GDP_DEMAND_FRACTION = 2.5e-6;

/**
 * Fraction of state GDP that converts to construction_services demand (infrastructure/GDP expansion).
 * Represents public and private infrastructure investment scaling with economic size.
 * At 5e-7, a $500B-GDP state generates ~71 units/day ($500B × 5e-7 / $3500 base price).
 */
export const CONSTRUCTION_SERVICES_GDP_DEMAND_FRACTION = 5e-7;

/**
 * Natcorp (country-owned corporation) commodity supply/demand multiplier.
 * State-owned sectors participate in commodity markets like any private producer
 * (1.0×): a nationalized energy company supplies energy normally. A near-zero
 * value here would mean nationalizing a commodity producer collapses that
 * commodity's national supply (Bug #0775) — the state-run "cost" is already
 * modelled by the SOE margin-efficiency penalty, the treasury compensation, and
 * the transition revenue haircut, not by erasing output. Tunable if a future
 * balance pass wants a state-inefficiency discount (e.g. 0.85).
 */
export const NATCORP_COMMODITY_MULTIPLIER = 1.0;

/** Blend weights: 50% global / 25% national (country-aggregate) / 25% regional (state). */
export const GLOBAL_PRICE_WEIGHT = 0.5;
export const NATIONAL_PRICE_WEIGHT = 0.25;
export const REGIONAL_PRICE_WEIGHT = 0.25;

/**
 * Per-turn drift rate for commodity prices toward supply/demand equilibrium.
 * At 0.06, a price gap is 95% closed after 48 turns (one game year).
 * After a nudge or peg removal, prices drift gradually from the intervention
 * value rather than snapping back to equilibrium.
 */
export const COMMODITY_PRICE_DRIFT_RATE = 0.06;

/**
 * Convert a dollar-equivalent flow to units at a given price.
 * units = dollarFlow / price
 */
export function dollarsToUnits(dollarFlow: number, price: number): number {
  if (price <= 0) return 0;
  return dollarFlow / price;
}

/**
 * The embargo write-off factor for a sector's SUPPLY leg, under plants.
 *
 * `0` under the legacy total-embargo suspension, otherwise
 * `1 − exportExposure × TRADE_EMBARGO_EXPORT_LOSS_SHARE`. Same shape as
 * `sectorTurn`'s `embargoRevenueFactor` and the ledger feed in
 * `commodityPriceTurn`, exported so the clearing offer cannot drift from the
 * world-supply ledger: goods that cannot be exported must disappear from both,
 * or the two disagree.
 *
 * Always returns a finite factor in [0, 1]; it never returns null.
 */
export function embargoSupplyFactorFor(sector: {
  embargoSuspended?: boolean | null;
  embargoExportExposure?: number | null;
}): number {
  // Same shape as sectorTurn's embargoRevenueFactor and the ledger feed in
  // commodityPriceTurn: a total-embargo suspension is a hard 0, otherwise the
  // exported share is written off. Exported so the clearing offer cannot drift
  // from the supply ledger.
  if (sector.embargoSuspended) return 0;
  return (
    1 -
    Math.max(0, Math.min(1, sector.embargoExportExposure ?? 0)) * TRADE_EMBARGO_EXPORT_LOSS_SHARE
  );
}

/**
 * Plants tier: the ONE canonical scaling chain applied on top of a sector's
 * measured `producedUnits` to get the units that actually reach the world
 * market.
 *
 * `producedUnits` is what the plant physically made. Ticket #1072: the
 * production-policy output multiplier is NO LONGER applied here — it is a
 * PHYSICAL throttle and now lives in `sectorTurn`'s `productionFactor`, so
 * `producedUnits` already carries it. Applying it here as well made a throttled
 * plant build full tonnage and offer less than it made, leaving the difference
 * as permanently unsold inventory the owner still paid to produce.
 *
 * What `producedUnits` still does NOT carry is `natcorpScale` and the embargo
 * write-off, so both the world-supply ledger below
 * (`computeRawSupplyDemand`) and the clearing OFFER (turn/corporation/index.ts)
 * have to apply them. They MUST apply the identical chain: the offer is flagged
 * `realUnits` and is therefore EXEMPT from clearing's lagged-supply
 * normalization, which is the safety net that used to hide any divergence. An
 * embargoed sector previously over-offered relative to ledger supply because
 * only the ledger applied `embargoSupplyFactor`, and nothing reconciled it.
 * Keep this the single source of the formula — a duplicated chain is the bug.
 *
 * Returns null when there is no measured production to scale (the sector has
 * never run a plants turn), which is the caller's signal to fall back to the
 * revenue nameplate.
 */
export function plantsSupplyScaledUnits(args: {
  producedUnits: number | null | undefined;
  isNatcorp: boolean;
  /**
   * 0 under the legacy total-mothball suspension, else
   * 1 − exportExposure × TRADE_EMBARGO_EXPORT_LOSS_SHARE. Non-finite/absent ⇒ 1.
   */
  embargoSupplyFactor?: number | null;
}): number | null {
  if (typeof args.producedUnits !== "number" || !Number.isFinite(args.producedUnits)) return null;
  const embargo = Number.isFinite(args.embargoSupplyFactor)
    ? Math.max(0, Math.min(1, args.embargoSupplyFactor as number))
    : 1;
  return (
    Math.max(0, args.producedUnits) * (args.isNatcorp ? NATCORP_COMMODITY_MULTIPLIER : 1) * embargo
  );
}

/**
 * Same chain as `plantsSupplyScaledUnits`, but starting from NAMEPLATE CAPACITY
 * rather than measured production. Capacity is what the plant could make at
 * policy 0, so the production-policy output multiplier still has to be applied
 * here — a capacity figure has never been through `sectorTurn`.
 *
 * Used by the supply-agreement capacity validator, which sizes a proposed
 * contract against what the sector could deliver.
 */
export function plantsCapacityScaledUnits(args: {
  capacityUnits: number | null | undefined;
  isNatcorp: boolean;
  productionPolicyLevel: number | null | undefined;
  embargoSupplyFactor?: number | null;
}): number | null {
  if (typeof args.capacityUnits !== "number" || !Number.isFinite(args.capacityUnits)) return null;
  return plantsSupplyScaledUnits({
    producedUnits:
      Math.max(0, args.capacityUnits) * getOutputMultiplier(args.productionPolicyLevel ?? 0),
    isNatcorp: args.isNatcorp,
    embargoSupplyFactor: args.embargoSupplyFactor,
  });
}

/**
 * One commodity's share of a sector's output mix, by the same rate/basePrice
 * weights `impliedOutputUnits` (capacityEconomy) uses.
 *
 * This is the CANONICAL split for turning a scalar output-unit count (plants
 * `producedUnits`, `soldUnits`, a capacity figure) into per-commodity units.
 * Market clearing, the world supply ledger, the inventory advance and the
 * supply-agreement capacity check all call it, so a multi-output sector's mix
 * is identical everywhere and none of those surfaces can drift apart.
 *
 * Returns 0 when the commodity is not produced, has no base price, or the mix
 * is degenerate.
 */
export function commodityMixWeight(
  supplyRates: Partial<Record<CommodityType, number>>,
  basePrices: Record<CommodityType, number>,
  commodity: CommodityType
): number {
  let total = 0;
  for (const c of Object.keys(supplyRates) as CommodityType[]) {
    const r = supplyRates[c] ?? 0;
    const b = basePrices[c];
    if (r > 0 && b > 0) total += r / b;
  }
  const base = basePrices[commodity];
  const rate = supplyRates[commodity] ?? 0;
  if (!(total > 0) || !(base > 0) || rate <= 0) return 0;
  return rate / base / total;
}

/**
 * Calculate market price from effective supply/demand pressure with
 * logarithmic diminishing returns and no hard cap.
 *
 * If one side of the market is empty, the other side can keep pushing price
 * further as it grows; the soft-knee and log curve slow the rate of change.
 * If both are 0, returns base price.
 */
export function computeMarketPrice(
  basePrice: number,
  supplyUnits: number,
  demandUnits: number,
  softKnee?: number
): number {
  const ratio = computeEffectiveCommodityPressureRatio(supplyUnits, demandUnits, softKnee);
  const logPressure = Math.log(ratio);
  const multiplier =
    logPressure >= 0
      ? 1 + COMMODITY_PRICE_LOG_SCALE * logPressure
      : 1 / (1 + COMMODITY_PRICE_LOG_SCALE * -logPressure);
  return Math.round(basePrice * multiplier * 100) / 100;
}

/**
 * Blend global, national, and regional prices.
 * blendedPrice = 0.5 * globalPrice + 0.25 * nationalPrice + 0.25 * regionalPrice
 */
export function blendPrice(
  globalPrice: number,
  nationalPrice: number,
  regionalPrice: number
): number {
  return (
    Math.round(
      (GLOBAL_PRICE_WEIGHT * globalPrice +
        NATIONAL_PRICE_WEIGHT * nationalPrice +
        REGIONAL_PRICE_WEIGHT * regionalPrice) *
        100
    ) / 100
  );
}

// ─── Retail consumer demand GDP scaling ──────────────────────────────────────

/** How strongly GDP growth scales retail consumer demand.
 *  multiplier = 1 + (blendedGdpGrowth / 100) × this
 *  At scale=10 and 2% GDP growth: 1.20 (20% more demand).
 *  At scale=10 and -1% GDP growth: 0.90 (10% less demand). */
export const RETAIL_GDP_DEMAND_SCALE = 15;

/** Blend weight for national vs regional GDP growth on retail demand */
export const RETAIL_GDP_NATIONAL_WEIGHT = 0.5;
export const RETAIL_GDP_REGIONAL_WEIGHT = 0.5;

/** Clamp bounds for the retail GDP demand multiplier */
export const RETAIL_GDP_MULTIPLIER_MIN = 0.5;
export const RETAIL_GDP_MULTIPLIER_MAX = 2.0;

/**
 * Fraction of state GDP that converts to building materials demand (construction/infrastructure).
 * At 0.00002, a state with $500B GDP generates 25 tons/day of building materials demand
 * ($500B × 0.00002 / $400 base price = 25 units). Scaled by GDP growth multiplier.
 */
export const BUILDING_MATERIALS_GDP_DEMAND_FRACTION = 0;

/**
 * Real estate services demand as a fraction of state GDP.
 * Set to 0 to disable real estate GDP-driven demand.
 */
export const REAL_ESTATE_GDP_DEMAND_FRACTION = 0.00002;

/**
 * Retail sectors face only 25% of negative commodity input penalties.
 * Retail is less dependent on commodity inputs than heavy industry —
 * shortages compress margins less because retail can substitute or absorb costs.
 */
export const RETAIL_NEGATIVE_COMMODITY_PENALTY_FACTOR = 0.25;

/**
 * Compute the retail demand multiplier from blended GDP growth.
 * @param nationalGdpGrowth National average GDP growth (percentage points, e.g. 1.5)
 * @param stateGdpGrowth State-level GDP growth (percentage points)
 * @returns Multiplier on retail demand rates (0.5–2.0)
 */
export function computeRetailDemandMultiplier(
  nationalGdpGrowth: number,
  stateGdpGrowth: number
): number {
  const blended =
    RETAIL_GDP_NATIONAL_WEIGHT * nationalGdpGrowth + RETAIL_GDP_REGIONAL_WEIGHT * stateGdpGrowth;
  const raw = 1 + (blended / 100) * RETAIL_GDP_DEMAND_SCALE;
  return Math.max(
    RETAIL_GDP_MULTIPLIER_MIN,
    Math.min(RETAIL_GDP_MULTIPLIER_MAX, Math.round(raw * 1000) / 1000)
  );
}

// ─── Financial services latent demand (rate environment + debt issuance) ─────

/**
 * Fraction of recent debt issuance that converts to latent financial services demand.
 * This keeps financial-services demand grounded in underwriting and refinancing activity
 * rather than exploding just because aggregate GDP is large.
 * Reduced by ~33% from 0.00005 to offset the 12→48 turn window expansion so aggregate
 * financial services demand stays roughly in the same range.
 *
 * Reduced again from 0.0000335 → 0.000022 (−34%): live financial_services D/S was 2.67×
 * with a 48-turn avg of 1.66× base price. Debt issuance is the primary demand driver and
 * was over-contributing relative to available financial sector supply.
 */
export const FINANCIAL_DEMAND_ISSUANCE_FRACTION = 0.000022;

/**
 * "Neutral" interest rate where financial services demand is neither boosted nor suppressed.
 * Based on the average of default prime rates across countries (US 2.5, UK 3.0, CA 2.75, DE 2.0).
 */
export const FINANCIAL_NEUTRAL_RATE = 2.75;

/**
 * How strongly the prime rate deviates from neutral affects financial services demand.
 * At 0.12, each percentage point below neutral boosts demand by ~12%,
 * and each point above neutral suppresses demand by ~12%.
 * Lower rates = cheaper money = more borrowing, M&A, IPOs, mortgage activity.
 */
export const FINANCIAL_RATE_SENSITIVITY = 0.12;

/** Clamp bounds for the rate environment multiplier */
export const FINANCIAL_RATE_MULTIPLIER_MIN = 0.6;
export const FINANCIAL_RATE_MULTIPLIER_MAX = 1.4;

/**
 * Rate-sensitive signed delta demand fractions (per anchor-GDP unit).
 * delta = anchorGdp × fraction × (FINANCIAL_NEUTRAL_RATE - primeRate) / basePrice
 * Zero at neutral, negative at high rates (suppresses demand), positive at low rates (adds demand).
 */
export const FOOD_RATE_GDP_FRACTION = 4e-8;
export const VEHICLE_RATE_GDP_FRACTION = 4e-7;
export const FINANCIAL_RATE_GDP_FRACTION = 1e-7;

/**
 * Compute the rate environment multiplier for financial services demand.
 * Lower rates boost demand (cheap money → more financial activity).
 * Higher rates suppress demand (expensive money → less borrowing).
 *
 * @param primeRate The country's central bank prime rate (e.g. 2.5)
 * @returns Multiplier on financial services demand (0.5–1.5)
 */
export function computeRateEnvironmentMultiplier(primeRate: number): number {
  const deviation = FINANCIAL_NEUTRAL_RATE - primeRate;
  const raw = 1 + deviation * FINANCIAL_RATE_SENSITIVITY;
  return Math.max(
    FINANCIAL_RATE_MULTIPLIER_MIN,
    Math.min(FINANCIAL_RATE_MULTIPLIER_MAX, Math.round(raw * 1000) / 1000)
  );
}

/**
 * Data needed to compute latent financial services demand per country.
 */
export interface FinancialServicesDemandInput {
  /** Country's central bank prime rate */
  primeRate: number;
  /** Recent debt issuance dollars over the current demand window: stateId → issuance */
  stateDebtIssuance: Map<string, number>;
}

/**
 * Compute latent financial services demand per state for a country.
 * Demand = recentDebtIssuance × issuanceFraction × rateMultiplier / basePrice
 *
 * @returns Map of stateId → demand in units (contracts)
 */
export function computeLatentFinancialDemand(
  input: FinancialServicesDemandInput
): Map<string, number> {
  const rateMultiplier = computeRateEnvironmentMultiplier(input.primeRate);
  const basePrice = COMMODITY_BASE_PRICES["financial_services"];
  const result = new Map<string, number>();

  for (const [stateId, issuanceDollars] of input.stateDebtIssuance) {
    const baseDemandDollars = issuanceDollars * FINANCIAL_DEMAND_ISSUANCE_FRACTION;
    const adjustedDemandDollars = baseDemandDollars * rateMultiplier;
    const units = adjustedDemandDollars / basePrice;
    if (units > 0) {
      result.set(stateId, Math.round(units * 100) / 100);
    }
  }

  return result;
}

// ─── Commodity shortage/surplus margin modifiers ─────────────────────────────

/**
 * Logarithmic scaling constant for commodity margin modifiers.
 * modifier = K × Σ(rate_i × ln(effectivePressure_i))
 *
 * At K=40, commodities are a meaningful margin factor. Moderate shortages
 * produce noticeable pain; sellers in scarce markets get bonuses.
 * Per-commodity contributions are soft-capped at ±50% before summing.
 *
 * Reference values (rate=0.25):
 *   1× demand (balanced): 0%
 *   1.1× demand (mild): -0.95%
 *   1.4× demand (moderate): -3.4%
 *   2× demand (severe): -6.9%
 *   5× demand (extreme, past soft-knee): -12.3%
 *
 * Multi-commodity stacking (defense inputs, all ~39% short at 1.39×):
 *   Steel(0.2) -2.6% + Electronics(0.2) -2.6% + Software(0.1) -1.3% = -6.5% total
 *
 * Effective margin can go negative — sectors drain corporate cash when
 * input costs exceed revenue.
 */
export const COMMODITY_LOG_K = 40;

/**
 * Per-commodity soft cap on margin contributions (percentage points).
 * Prevents a single extreme market from dominating the total margin modifier.
 * Multiple commodities can still stack beyond this cap in aggregate.
 */
export const COMMODITY_PER_ITEM_CAP = 50;

/**
 * Aggregate floor on the blended input cost modifier (percentage points).
 * After all per-commodity penalties are summed and the 50/25/25 blend is
 * applied, the combined inputMod is clamped to this floor so no sector can
 * be commercially destroyed by stacked commodity shortages from routine market
 * conditions. Stacked 5× shortages on every input would otherwise drive energy,
 * automobiles, and construction to −50+ in normal gameplay.
 */
export const COMMODITY_AGGREGATE_INPUT_CAP = 30;

/**
 * Per-commodity ceiling on the ERA-RESCALED ledger demand (see
 * `ledgerUnitScale` on `computeRawSupplyDemand`), as a multiple of the SAME
 * pass's global supply - the intermediate-leg sibling of
 * `PLANTS_HOUSEHOLD_SUPPLY_CAP` (householdConsumption.ts), same value on
 * purpose. The static 1953 seed projection shows the raw x69.8 re-anchor
 * flipping about a third of the market from deep glut into deep shortage
 * (electronics 4.1x demand/supply, software 6.1x, fertilizers 75x): the
 * SECTOR_DEMAND rate tables were tuned against the undercounted basis, so at
 * full era scale they ask for more than the seeded plants can physically make.
 * Bounding the rescaled total at this multiple keeps a clear, bounded
 * build-here signal instead of a pinned price cap.
 *
 * The cap NEVER cuts demand below its unscaled (legacy-basis) level - a
 * commodity already in genuine shortage on the legacy basis (fertilizers,
 * pharma) keeps its full pressure; only the scale-up is bounded.
 */
export const PLANTS_LEDGER_DEMAND_SUPPLY_CAP = 1.5;

/**
 * Aggregate ceiling on the blended output surplus modifier (percentage points).
 * Prevents diversified extraction from earning +40 net commodity margin simply
 * by selling into every scarce market at once. Focused strategies remain
 * attractive and can still reach the cap with fewer inputs.
 */
export const COMMODITY_AGGREGATE_SURPLUS_CAP = 30;
/**
 * Floor on the COMBINED commodity margin channel (input scarcity + output glut).
 *
 * The per-leg caps bound each side alone but not their sum, and the surplus leg
 * had no downside bound whatsoever. 15pp is deep enough to make commodity
 * conditions a real strategic pressure, shallow enough that it cannot single-
 * handedly bankrupt an otherwise well-run firm.
 */
export const COMMODITY_COMBINED_FLOOR = 15;

/**
 * Convert raw supply/demand into a stable pressure ratio.
 * When one side is near zero, the floor keeps the ratio finite without
 * introducing a hard cap — pressure can still keep growing as the opposite
 * side increases.
 */
export function computeCommodityPressureRatio(supplyUnits: number, demandUnits: number): number {
  if (supplyUnits <= 0 && demandUnits <= 0) return 1;
  const supply = Math.max(supplyUnits, MIN_COMMODITY_FLOW_UNITS);
  const demand = Math.max(demandUnits, MIN_COMMODITY_FLOW_UNITS);
  return demand / supply;
}

/**
 * Convert raw supply/demand pressure into the effective pressure used by price
 * and margin math. Ratios within 3x shortage or 3x oversupply are unchanged.
 * Beyond that soft-knee, the log-pressure tail keeps increasing at a steeply
 * diminishing rate. The transform is symmetric around 1x.
 */
export function computeEffectiveCommodityPressureRatio(
  supplyUnits: number,
  demandUnits: number,
  softKnee: number = COMMODITY_PRESSURE_SOFT_KNEE
): number {
  const rawRatio = computeCommodityPressureRatio(supplyUnits, demandUnits);
  if (rawRatio <= 0 || !Number.isFinite(rawRatio)) return 1;

  const logPressure = Math.log(rawRatio);
  const absLogPressure = Math.abs(logPressure);
  const kneeLogPressure = Math.log(softKnee);
  if (absLogPressure <= kneeLogPressure) return rawRatio;

  const compressedLogPressure =
    kneeLogPressure + (absLogPressure - kneeLogPressure) * COMMODITY_PRESSURE_TAIL_SLOPE;
  return Math.exp(Math.sign(logPressure) * compressedLogPressure);
}

/**
 * Compute commodity margin modifier for a sector that BUYS commodities (input costs).
 * Uses logarithmic scaling: penalty = -K × Σ(rate_i × ln(effectivePressure_i))
 *
 * Symmetric with the surplus bonus — same curve, opposite sign.
 * - Shortage (D > S): negative modifier (higher input costs compress margins)
 * - Oversupply (D < S): positive modifier (cheaper inputs boost margins)
 *
 * Returns a margin modifier in percentage points (e.g., -5.5 means -5.5% margin).
 */
/**
 * Accept either a `CommodityFlow[]` (matches SECTOR_DEMAND/SECTOR_SUPPLY) or
 * a `Partial<Record<CommodityType, number>>` (matches EffectiveStrategyRates),
 * returning the array form the per-commodity loops consume. Keeps callers
 * free to pass strategy rates directly without a conversion step.
 */
function normalizeFlows(
  input: Partial<Record<CommodityType, number>> | readonly CommodityFlow[]
): CommodityFlow[] {
  if (Array.isArray(input)) return input as CommodityFlow[];
  const record = input as Partial<Record<CommodityType, number>>;
  const out: CommodityFlow[] = [];
  for (const [commodity, rate] of Object.entries(record)) {
    if (typeof rate === "number" && rate > 0) {
      out.push({ commodity: commodity as CommodityType, rate });
    }
  }
  return out;
}

export function computeCommodityMarginModifier(
  sectorType: CorporationType,
  /** Map of commodity -> { supplyUnits, demandUnits } for this state or global */
  commodityBalances: Map<CommodityType, { supply: number; demand: number }>,
  /**
   * Optional override flow rates — supersedes SECTOR_DEMAND[sectorType].
   * When a sector runs a non-standard operating strategy, callers must pass
   * the effective strategy's demand rates so the computed modifier matches
   * what the sector actually consumes (kept in sync with the per-row display
   * in the sector-detail API).
   */
  demandOverride?: Partial<Record<CommodityType, number>> | readonly CommodityFlow[]
): number {
  const demands =
    demandOverride != null ? normalizeFlows(demandOverride) : SECTOR_DEMAND[sectorType];
  if (!demands || demands.length === 0) return 0;

  let modifier = 0;

  for (const flow of demands) {
    const balance = commodityBalances.get(flow.commodity);
    if (!balance) continue;

    const demandPressure = computeEffectiveCommodityPressureRatio(balance.supply, balance.demand);
    const perCommodity = -COMMODITY_LOG_K * flow.rate * Math.log(demandPressure);
    // Soft cap: no single commodity can contribute more than ±COMMODITY_PER_ITEM_CAP
    modifier += Math.max(-COMMODITY_PER_ITEM_CAP, Math.min(COMMODITY_PER_ITEM_CAP, perCommodity));
  }

  return Math.round(modifier * 100) / 100;
}

/**
 * Compute commodity margin modifier for a sector that SELLS commodities (output demand).
 * Uses logarithmic scaling: bonus = +K × Σ(rate_i × ln(effectivePressure_i))
 *
 * Symmetric with the input cost modifier — same curve, opposite sign.
 * - Shortage (D > S): positive modifier (sellers benefit from premium pricing)
 * - Oversupply (D < S): negative modifier (sellers suffer from price pressure)
 *
 * Returns a margin modifier in percentage points (e.g., +5.5 means +5.5% margin).
 */
export function computeCommoditySurplusBonus(
  sectorType: CorporationType,
  commodityBalances: Map<CommodityType, { supply: number; demand: number }>,
  /**
   * Optional override flow rates — supersedes SECTOR_SUPPLY[sectorType]. Pass
   * the sector's effective strategy supply rates when the sector is on a
   * non-standard strategy, otherwise the bonus is computed against the wrong
   * commodity set.
   */
  supplyOverride?: Partial<Record<CommodityType, number>> | readonly CommodityFlow[]
): number {
  const supplies =
    supplyOverride != null ? normalizeFlows(supplyOverride) : SECTOR_SUPPLY[sectorType];
  if (!supplies || supplies.length === 0) return 0;

  let bonus = 0;

  for (const flow of supplies) {
    const balance = commodityBalances.get(flow.commodity);
    if (!balance) continue;

    const demandPressure = computeEffectiveCommodityPressureRatio(balance.supply, balance.demand);
    const perCommodity = COMMODITY_LOG_K * flow.rate * Math.log(demandPressure);
    // Soft cap: no single commodity can contribute more than ±COMMODITY_PER_ITEM_CAP
    bonus += Math.max(-COMMODITY_PER_ITEM_CAP, Math.min(COMMODITY_PER_ITEM_CAP, perCommodity));
  }

  return Math.round(bonus * 100) / 100;
}

/**
 * Apply retail penalty reduction: retail sectors face only 25% of negative
 * commodity input penalties. Positive modifiers (oversupply benefits) are unaffected.
 */
export function applyRetailPenaltyFactor(
  sectorType: CorporationType,
  commodityInputMod: number
): number {
  if (sectorType === "retail" && commodityInputMod < 0) {
    return commodityInputMod * RETAIL_NEGATIVE_COMMODITY_PENALTY_FACTOR;
  }
  return commodityInputMod;
}

/**
 * Compute blended commodity margin modifiers using the output-blend approach.
 * Computes modifiers at global, national, and state level independently, then blends
 * them with tariff-aware weights.
 *
 * State balances get STATE_COMMODITY_SUPPLY_DEMAND added to both sides to prevent
 * extreme ratios when a state has zero supply. National balances are used as-is.
 *
 * @returns { inputMod, surplusMod } — both in percentage points of margin
 */
export function computeBlendedMarginModifiers(
  sectorType: CorporationType,
  globalBalances: Map<CommodityType, { supply: number; demand: number }>,
  nationalBalances: Map<CommodityType, { supply: number; demand: number }>,
  stateBalances: Map<CommodityType, { supply: number; demand: number }>,
  globalWeight: number = 0.5,
  nationalWeight: number = 0.25,
  localWeight: number = 0.25,
  /**
   * Optional effective supply/demand overrides — when the sector is on a
   * non-standard operating strategy, passing its current strategy rates keeps
   * the blended modifier consistent with the commodity rows displayed in the
   * sector-detail UI. Omit to fall back to SECTOR_SUPPLY/SECTOR_DEMAND
   * (appropriate only when the sector is on the default strategy).
   */
  supplyOverride?: Partial<Record<CommodityType, number>> | readonly CommodityFlow[],
  demandOverride?: Partial<Record<CommodityType, number>> | readonly CommodityFlow[]
): { inputMod: number; surplusMod: number } {
  // Add state stabilizer to state balances for margin calculation.
  // Extractable resources use a larger stabilizer because they are globally
  // traded — a state without local iron/oil/gas can import it, so pure
  // zero-supply local penalties over-penalise sectors in resource-poor states.
  const stabilizedState = new Map<CommodityType, { supply: number; demand: number }>();
  for (const c of COMMODITY_TYPES) {
    const s = stateBalances.get(c) ?? { supply: 0, demand: 0 };
    const stab = (EXTRACTABLE_RESOURCES as readonly string[]).includes(c)
      ? EXTRACTABLE_RESOURCE_STATE_STABILIZER
      : STATE_COMMODITY_SUPPLY_DEMAND;
    stabilizedState.set(c, {
      supply: s.supply + stab,
      demand: s.demand + stab,
    });
  }

  // Compute modifiers at each level
  const globalInput = computeCommodityMarginModifier(sectorType, globalBalances, demandOverride);
  const nationalInput = computeCommodityMarginModifier(
    sectorType,
    nationalBalances,
    demandOverride
  );
  const stateInput = computeCommodityMarginModifier(sectorType, stabilizedState, demandOverride);
  const globalSurplus = computeCommoditySurplusBonus(sectorType, globalBalances, supplyOverride);
  const nationalSurplus = computeCommoditySurplusBonus(
    sectorType,
    nationalBalances,
    supplyOverride
  );
  const stateSurplus = computeCommoditySurplusBonus(sectorType, stabilizedState, supplyOverride);

  // Blend outputs using caller-supplied weights (default 50/25/25).
  const rawInput =
    globalWeight * globalInput + nationalWeight * nationalInput + localWeight * stateInput;
  // Apply retail penalty before aggregate cap (retail's reduced penalty is the
  // intended floor for retail, not a workaround to skip the aggregate cap).
  const penaltiedInput = applyRetailPenaltyFactor(sectorType, Math.round(rawInput * 100) / 100);
  // Aggregate cap: stacked multi-commodity pressure cannot collapse a sector
  // below −COMMODITY_AGGREGATE_INPUT_CAP regardless of how many inputs are scarce.
  const inputMod = Math.max(-COMMODITY_AGGREGATE_INPUT_CAP, penaltiedInput);

  const rawSurplus =
    globalWeight * globalSurplus + nationalWeight * nationalSurplus + localWeight * stateSurplus;
  // Aggregate ceiling: diversified extraction cannot exceed the surplus cap even
  // when selling into every scarce market simultaneously.
  const surplusMod = Math.min(COMMODITY_AGGREGATE_SURPLUS_CAP, Math.round(rawSurplus * 100) / 100);

  // Combined floor across BOTH legs.
  //
  // Each leg was capped independently — input at -30, surplus only on its
  // UPSIDE (Math.min) with no downside floor at all. So a sector whose inputs
  // were scarce AND whose output was glutted took both hits stacked, unbounded
  // below the input cap. That is the common case, not a corner: on the 1000-turn
  // run the two legs fired negative together for -11.9pp average (the single
  // largest margin drag), with agriculture at -35.5 and entertainment at -24.4 —
  // past the point any firm can survive, and with no agent able to respond
  // because nothing repoints a sector away from a glutted output.
  //
  // Scaling both legs proportionally preserves their relative signal (which
  // commodity is hurting, and how much) while bounding the total.
  const combined = inputMod + surplusMod;
  if (combined < -COMMODITY_COMBINED_FLOOR) {
    const scale = COMMODITY_COMBINED_FLOOR / Math.abs(combined);
    return {
      inputMod: Math.round(inputMod * scale * 100) / 100,
      surplusMod: Math.round(surplusMod * scale * 100) / 100,
    };
  }

  return { inputMod, surplusMod };
}

export const COMMODITY_COLORS: Record<CommodityType, string> = {
  steel: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  electronics: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  energy: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  chemicals: "bg-green-500/15 text-green-400 border-green-500/30",
  pharmaceuticals: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  fertilizers: "bg-lime-500/15 text-lime-400 border-lime-500/30",
  food: "bg-lime-500/15 text-lime-400 border-lime-500/30",
  building_materials: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  construction_services: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  healthcare_services: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  real_estate_services: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  software: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  financial_services: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  advertising: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  vehicles: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  retail: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  freight: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  consulting_services: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  iron: "bg-red-500/15 text-red-400 border-red-500/30",
  coal: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  oil: "bg-stone-500/15 text-stone-400 border-stone-500/30",
  rare_earth: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  timber: "bg-lime-700/15 text-lime-600 border-lime-700/30",
  natural_gas: "bg-cyan-600/15 text-cyan-500 border-cyan-600/30",
  ordnance: "bg-red-700/15 text-red-600 border-red-700/30",
  plastics: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  network_services: "bg-sky-700/15 text-sky-600 border-sky-700/30",
  entertainment_services: "bg-rose-600/15 text-rose-500 border-rose-600/30",
};

interface CommodityFlow {
  commodity: CommodityType;
  /** Fraction of sector daily revenue that translates to this commodity flow */
  rate: number;
}

/**
 * What each sector type SUPPLIES (produces).
 * Retail does not supply commodities — it is a pure consumer-facing sector.
 */
export const SECTOR_SUPPLY: Partial<Record<CorporationType, CommodityFlow[]>> = {
  manufacturing: [
    { commodity: "steel", rate: 0.4 },
    { commodity: "building_materials", rate: 0.2 },
  ],
  technology: [
    { commodity: "electronics", rate: 0.35 },
    { commodity: "software", rate: 0.35 },
  ],
  // Raised from 0.6 → 0.65: energy producers buy several scarce inputs (oil, gas, copper)
  // but currently sit near break-even. Higher output rate partially compensates.
  energy: [{ commodity: "energy", rate: 0.65 }],
  chemical_industries: [
    { commodity: "chemicals", rate: 0.5 },
    // Plastics co-production: polymer synthesis is a core output of petrochemical plants.
    // Raised 0.15 → 0.25 to boost supply for critical plastics shortage (S/D ~0.37).
    { commodity: "plastics", rate: 0.25 },
  ],
  healthcare: [{ commodity: "healthcare_services", rate: 0.5 }],
  // Reduced from 0.55 → 0.50: food moved to oversupply (D/S ~0.85×) so the prior
  // supply boost is now counterproductive. Lower rate brings supply back toward balance.
  agriculture: [{ commodity: "food", rate: 0.5 }],
  automobiles: [{ commodity: "vehicles", rate: 0.5 }],
  financial: [{ commodity: "financial_services", rate: 0.5 }],
  media: [{ commodity: "advertising", rate: 0.5 }],
  defense: [
    { commodity: "vehicles", rate: 0.2 },
    { commodity: "electronics", rate: 0.15 },
    { commodity: "ordnance", rate: 0.1 },
  ],
  real_estate: [{ commodity: "real_estate_services", rate: 0.45 }],
  construction: [{ commodity: "construction_services", rate: 0.45 }],
  telecommunications: [
    { commodity: "software", rate: 0.2 },
    { commodity: "network_services", rate: 0.4 },
  ],
  entertainment: [
    { commodity: "advertising", rate: 0.2 },
    { commodity: "entertainment_services", rate: 0.4 },
  ],
  retail: [{ commodity: "retail", rate: 0.5 }],
  logistics: [
    { commodity: "freight", rate: 0.45 },
    { commodity: "consulting_services", rate: 0.25 },
  ],
  // Broad-mix extraction rates. copper/rare_earth were previously 0.03 on the
  // assumption they were "near-balanced" — but that balance was an artifact of
  // the flat 50k stabilizer masking a real 34×/33× shortage (617 units copper vs
  // 21k demand). With the stabilizer unmasked (audit t786), copper/rare_earth are
  // bumped 0.03 → 0.15/0.12 so broad-mix extraction actually produces a
  // meaningful amount. This is partial relief only — closing the gap fully
  // depends on extraction sectors adopting the copper_mining/rare_earth_mining
  // strategies (rate 0.72) in the states that carry those deposits, which is the
  // durable fix (automated strategy adoption).
  extraction: [
    { commodity: "iron", rate: 0.4 },
    { commodity: "coal", rate: 0.3 },
    { commodity: "oil", rate: 0.14 },
    { commodity: "rare_earth", rate: 0.27 },
    { commodity: "natural_gas", rate: 0.24 },
    { commodity: "timber", rate: 0.2 },
  ],
};

/**
 * What each sector type DEMANDS (consumes as inputs).
 *
 * Retail generates consumer demand for ALL commodities, representing end-consumer
 * purchasing flowing through retail channels. Retail demand is scaled at runtime
 * by GDP growth (50% national average + 50% regional) via computeRetailDemandMultiplier.
 */
export const SECTOR_DEMAND: Partial<Record<CorporationType, CommodityFlow[]>> = {
  manufacturing: [
    { commodity: "energy", rate: 0.15 },
    { commodity: "iron", rate: 0.1 },
    { commodity: "coal", rate: 0.06 },
    { commodity: "electronics", rate: 0.1 },
    { commodity: "freight", rate: 0.1 },
    { commodity: "real_estate_services", rate: 0.03 },
    { commodity: "rare_earth", rate: 0.08 },
    { commodity: "natural_gas", rate: 0.05 },
    { commodity: "timber", rate: 0.03 },
    { commodity: "plastics", rate: 0.06 },
  ],
  technology: [
    { commodity: "energy", rate: 0.15 },
    { commodity: "rare_earth", rate: 0.14 },
    { commodity: "steel", rate: 0.05 },
    { commodity: "consulting_services", rate: 0.08 },
    { commodity: "real_estate_services", rate: 0.03 },
    { commodity: "network_services", rate: 0.1 },
  ],
  energy: [
    { commodity: "steel", rate: 0.15 },
    { commodity: "coal", rate: 0.15 },
    // Reduced oil 0.1→0.07 and copper 0.07→0.04: energy plants are not primary oil
    // consumers (fuel switching to gas/coal is realistic), and copper is already
    // severely scarce. Reduced inputs improve energy sector viability without
    // distorting the commodity signal.
    { commodity: "oil", rate: 0.07 },
    { commodity: "vehicles", rate: 0.1 },
    { commodity: "construction_services", rate: 0.05 },
    { commodity: "rare_earth", rate: 0.04 },
    { commodity: "natural_gas", rate: 0.08 },
  ],
  chemical_industries: [
    { commodity: "energy", rate: 0.18 },
    { commodity: "oil", rate: 0.1 },
    { commodity: "freight", rate: 0.08 },
    { commodity: "real_estate_services", rate: 0.02 },
    /** Tankers, specialized road transport, and plant vehicle fleet */
    { commodity: "vehicles", rate: 0.1 },
    { commodity: "natural_gas", rate: 0.12 },
  ],
  healthcare: [
    // Reduced pharma 0.15→0.11 and electronics 0.15→0.11: healthcare D/S was running
    // 2.38× nationally with further govt spending pressure. Lower input rates ease the
    // margin squeeze without gutting the clinical-supply realism.
    { commodity: "pharmaceuticals", rate: 0.11 },
    { commodity: "electronics", rate: 0.11 },
    { commodity: "software", rate: 0.12 },
    { commodity: "energy", rate: 0.05 },
    { commodity: "real_estate_services", rate: 0.04 },
    /** Institutional catering and clinical nutrition */
    { commodity: "food", rate: 0.05 },
    /** Ambulances, mobile clinics, fleet vehicles */
    { commodity: "vehicles", rate: 0.025 },
    /** Syringes, tubing, disposable equipment, sterile packaging */
    { commodity: "plastics", rate: 0.06 },
  ],
  agriculture: [
    { commodity: "fertilizers", rate: 0.15 },
    { commodity: "vehicles", rate: 0.1 },
    { commodity: "energy", rate: 0.1 },
    { commodity: "freight", rate: 0.08 },
    { commodity: "natural_gas", rate: 0.05 },
    { commodity: "timber", rate: 0.04 },
    { commodity: "plastics", rate: 0.05 },
  ],
  automobiles: [
    { commodity: "steel", rate: 0.25 },
    { commodity: "iron", rate: 0.08 },
    { commodity: "electronics", rate: 0.15 },
    { commodity: "energy", rate: 0.1 },
    { commodity: "freight", rate: 0.08 },
    { commodity: "real_estate_services", rate: 0.02 },
    { commodity: "rare_earth", rate: 0.08 },
    { commodity: "plastics", rate: 0.1 },
  ],
  financial: [
    { commodity: "software", rate: 0.2 },
    { commodity: "electronics", rate: 0.05 },
    { commodity: "consulting_services", rate: 0.1 },
    { commodity: "real_estate_services", rate: 0.04 },
    { commodity: "network_services", rate: 0.06 },
  ],
  media: [
    { commodity: "software", rate: 0.15 },
    { commodity: "electronics", rate: 0.1 },
    { commodity: "consulting_services", rate: 0.06 },
    { commodity: "real_estate_services", rate: 0.03 },
    { commodity: "network_services", rate: 0.1 },
    { commodity: "entertainment_services", rate: 0.06 },
  ],
  defense: [
    { commodity: "steel", rate: 0.2 },
    { commodity: "iron", rate: 0.1 },
    { commodity: "rare_earth", rate: 0.05 },
    { commodity: "electronics", rate: 0.2 },
    { commodity: "software", rate: 0.1 },
    { commodity: "construction_services", rate: 0.05 },
    /** Motor pools, light tactical and support vehicles (commodity pool) */
    { commodity: "vehicles", rate: 0.03 },
  ],
  real_estate: [
    { commodity: "construction_services", rate: 0.2 },
    { commodity: "building_materials", rate: 0.12 },
    { commodity: "steel", rate: 0.08 },
    { commodity: "energy", rate: 0.08 },
    // Reduced financial_services 0.15→0.10: real estate was stacking financial services
    // demand (sector input + GDP macro + rate signal) creating persistent 2.67× pressure.
    { commodity: "financial_services", rate: 0.1 },
    { commodity: "timber", rate: 0.07 },
  ],
  construction: [
    // Reduced building_materials 0.20→0.15, copper 0.06→0.04, natural_gas 0.03→0.02,
    // timber 0.10→0.08: construction stacks 9 scarce inputs simultaneously, driving
    // aggregate input penalties near the -30pp floor. These further reductions bring
    // construction into target profitability band.
    { commodity: "building_materials", rate: 0.15 },
    { commodity: "steel", rate: 0.15 },
    { commodity: "energy", rate: 0.12 },
    { commodity: "vehicles", rate: 0.1 },
    { commodity: "financial_services", rate: 0.05 },
    { commodity: "rare_earth", rate: 0.04 },
    { commodity: "natural_gas", rate: 0.02 },
    { commodity: "timber", rate: 0.06 },
    /** PVC pipe, window frames, insulation, vapour barriers */
    { commodity: "plastics", rate: 0.07 },
  ],
  telecommunications: [
    // Reduced electronics 0.25→0.18 and copper 0.12→0.09: telecom was over-contributing
    // to electronics and copper shortages. Lower rates reflect that most capex is now
    // capitalised infrastructure rather than ongoing component consumption.
    { commodity: "electronics", rate: 0.18 },
    { commodity: "energy", rate: 0.1 },
    { commodity: "building_materials", rate: 0.06 },
    { commodity: "construction_services", rate: 0.08 },
    { commodity: "real_estate_services", rate: 0.03 },
    { commodity: "rare_earth", rate: 0.09 },
  ],
  entertainment: [
    { commodity: "software", rate: 0.15 },
    { commodity: "electronics", rate: 0.1 },
    { commodity: "energy", rate: 0.06 },
    { commodity: "real_estate_services", rate: 0.03 },
    { commodity: "network_services", rate: 0.08 },
  ],
  logistics: [
    { commodity: "vehicles", rate: 0.2 },
    { commodity: "energy", rate: 0.15 },
    { commodity: "software", rate: 0.1 },
    { commodity: "real_estate_services", rate: 0.03 },
    /** Cold chain and contract food distribution */
    { commodity: "food", rate: 0.06 },
  ],
  /** Retail: consumer demand for ALL commodities (base rates, scaled by GDP growth at runtime) */
  retail: [
    { commodity: "food", rate: 0.15 },
    { commodity: "electronics", rate: 0.1 },
    { commodity: "energy", rate: 0.08 },
    { commodity: "vehicles", rate: 0.08 },
    { commodity: "freight", rate: 0.07 },
    { commodity: "advertising", rate: 0.06 },
    { commodity: "software", rate: 0.06 },
    { commodity: "chemicals", rate: 0.03 },
    { commodity: "pharmaceuticals", rate: 0.03 },
    { commodity: "financial_services", rate: 0.05 },
    { commodity: "consulting_services", rate: 0.03 },
    { commodity: "building_materials", rate: 0.04 },
    { commodity: "steel", rate: 0.03 },
    { commodity: "oil", rate: 0.03 },
    { commodity: "healthcare_services", rate: 0.04 },
    { commodity: "real_estate_services", rate: 0.05 },
    { commodity: "natural_gas", rate: 0.02 },
    { commodity: "timber", rate: 0.01 },
    { commodity: "plastics", rate: 0.05 },
    { commodity: "network_services", rate: 0.05 },
    { commodity: "entertainment_services", rate: 0.03 },
  ],
  extraction: [
    { commodity: "energy", rate: 0.2 },
    { commodity: "vehicles", rate: 0.15 },
    { commodity: "freight", rate: 0.1 },
    { commodity: "chemicals", rate: 0.08 },
    { commodity: "construction_services", rate: 0.03 },
    /** Bulk mining explosives — blasting is the dominant cost in hard-rock and surface mining */
    { commodity: "ordnance", rate: 0.06 },
  ],
};

export interface CommoditySummaryRow {
  commodity: CommodityType;
  label: string;
  /** Supply in units/day */
  supply: number;
  /** Demand in units/day */
  demand: number;
  /** Balance in units/day (supply - demand) */
  balance: number;
  /** Base price for this commodity */
  basePrice: number;
  /** Unit label (tons, MWh, etc.) */
  unit: string;
}

/**
 * Compute aggregate commodity supply/demand for a set of owned sectors.
 * Returns values in UNITS (dollarFlow / basePrice).
 *
 * @param sectors Array of { sectorType, revenue } (revenue = daily)
 * @returns Array of commodity rows with supply, demand, and net balance in units
 */
export function computeCommoditySummary(
  sectors: { sectorType: string; revenue: number }[]
): CommoditySummaryRow[] {
  const supplyMap = new Map<CommodityType, number>();
  const demandMap = new Map<CommodityType, number>();

  for (const sector of sectors) {
    const st = sector.sectorType as CorporationType;

    const supplies = SECTOR_SUPPLY[st];
    if (supplies) {
      for (const flow of supplies) {
        const dollarFlow = sector.revenue * flow.rate;
        const units = dollarsToUnits(dollarFlow, COMMODITY_BASE_PRICES[flow.commodity]);
        supplyMap.set(flow.commodity, (supplyMap.get(flow.commodity) ?? 0) + units);
      }
    }

    const demands = SECTOR_DEMAND[st];
    if (demands) {
      for (const flow of demands) {
        const dollarFlow = sector.revenue * flow.rate;
        const units = dollarsToUnits(dollarFlow, COMMODITY_BASE_PRICES[flow.commodity]);
        demandMap.set(flow.commodity, (demandMap.get(flow.commodity) ?? 0) + units);
      }
    }
  }

  const rows: CommoditySummaryRow[] = [];
  for (const commodity of COMMODITY_TYPES) {
    const supply = supplyMap.get(commodity) ?? 0;
    const demand = demandMap.get(commodity) ?? 0;
    if (supply > 0 || demand > 0) {
      rows.push({
        commodity,
        label: COMMODITY_LABELS[commodity],
        supply: Math.round(supply * 100) / 100,
        demand: Math.round(demand * 100) / 100,
        balance: Math.round((supply - demand) * 100) / 100,
        basePrice: COMMODITY_BASE_PRICES[commodity],
        unit: COMMODITY_UNITS[commodity],
      });
    }
  }

  return rows;
}

/**
 * GDP growth data used to scale retail consumer demand.
 * Retail demand multiplier = f(50% national + 50% regional GDP growth).
 */
export interface GdpGrowthData {
  /** National average GDP growth in percentage points (e.g. 1.5 = 1.5%) */
  nationalAverage: number;
  /** Per-state GDP growth: stateId → percentage points */
  byState: Map<string, number>;
}

/**
 * Compute raw supply/demand maps in units for price calculation.
 * Used by turn processing to calculate market prices.
 *
 * When gdpGrowthData is provided, retail sector demand is scaled by a multiplier
 * derived from GDP growth (50% national average + 50% state-level).
 *
 * When stateGdpMap is provided, building materials macro demand is generated
 * proportional to each state's GDP (construction/infrastructure spending).
 */
export function computeRawSupplyDemand(
  sectors: {
    sectorType: string;
    revenue: number;
    stateId: string;
    sectorId?: string;
    isNatcorp?: boolean;
    strategyId?: string;
    transitionFromStrategyId?: string | null;
    transitionStartTurn?: number | null;
    productionPolicyLevel?: number;
    /** World Events v1 Phase 1: country the sector belongs to, used only to
     *  look up active `sectorDemandModifierPct` entries below. Optional so
     *  every existing caller (tests, other pricing paths) keeps compiling
     *  unchanged when it's omitted. */
    countryId?: string;
    /**
     * True when this sector sits in a command economy (caller resolves it via
     * `isPlannedEconomy`). Remaps media output off `advertising`, which is a
     * market institution a planned economy does not have.
     */
    plannedEconomy?: boolean;

    /**
     * Plants tier (`plantsEnabled`): the units this sector ACTUALLY produced
     * last turn (`sector.producedUnits`, daily, currency-free). When present the
     * sector's supply contribution is this number split across its output mix,
     * instead of the revenue×rate/basePrice nameplate derivation. Absent (a
     * sector that has never run a plants turn) falls back to the legacy
     * derivation, so the first plants turn is unchanged.
     */
    producedUnits?: number | null;
    /**
     * Share of this plant's output (0..1) shipped to a government arsenal under a defence
     * procurement contract. That output was already paid for per lot and does not also
     * reach the world market, so it comes off this sector's supply contribution.
     *
     * Already resolved for staleness by the caller (`freshMilitaryDiversion`), which owns
     * the turn context — this function only multiplies. Absent/0 is a pure no-op.
     */
    militaryDivertedFraction?: number;
    /**
     * Plants tier: the sector's capacity in output units/day (`capitalStock`).
     * With `producedUnits` it gives the utilization ratio that scales INPUT
     * demand — a throttled plant buys fewer inputs. Absent ⇒ utilization 1.
     */
    capacityUnits?: number | null;
    /** Plants tier: mothballed plants are cold — zero supply AND zero inputs. */
    mothballed?: boolean;
    /**
     * Plants tier: the same factor the sector's REVENUE is scaled by under an
     * embargo (0 under the legacy total-mothball suspension, else
     * 1 − exportExposure × TRADE_EMBARGO_EXPORT_LOSS_SHARE). Applied to the
     * supply contribution for symmetry: goods that cannot be exported do not
     * reach the world market either, so the ledger must not keep counting them
     * as available supply while the revenue leg has already written them off.
     * Deliberately NOT applied to input demand — the plant still runs and still
     * buys its inputs; the embargo blocks the sale, not the production.
     * Absent/non-finite ⇒ 1 (unembargoed).
     */
    embargoSupplyFactor?: number | null;
    /**
     * Plants tier, EXTRACTION ONLY: realized ÷ nameplate output for this sector,
     * in [0,1]. Extraction keeps the legacy revenue-nameplate derivation below
     * (its rationing multipliers are applied in this loop and `producedUnits`
     * already carries its own capacity haircut, so the `producedUnits` override
     * would double-count the haircut) — but the nameplate is NOT what the plant
     * made. This fraction is the one the depletion booking in
     * `commodityPriceTurn.bookExtractionDepletion` charges reserves at, so
     * applying it here makes supply and depletion describe the same physical
     * units. Absent ⇒ 1, which is the pre-plants behaviour.
     */
    extractionRealizedFraction?: number | null;
  }[],
  gdpGrowthData?: GdpGrowthData,
  stateGdpMap?: Map<string, number>,
  currentTurn?: number,
  primeRates?: Map<string, number>,
  extractionMultipliers?: Map<string, Partial<Record<ExtractableResource, number>>>,
  extractionOutputScaleEnabled = false,
  /**
   * World Events v1 Phase 1: active `sectorDemandModifier` world-event
   * effects, keyed `${countryId}:${sectorType}` -> summed pct (e.g. a
   * royal-event's tourism bump). Additive on top of the existing
   * GDP-driven retail multiplier — see `getActiveSectorDemandModifierPctMap`
   * in `worldEvents/sectorDemandModifierMap.ts` for how this map is built.
   * Optional/absent is a pure no-op (all existing callers unaffected).
   */
  sectorDemandModifierPct?: Map<string, number>,
  /**
   * Household Ledger consolidation (`householdConsumptionEnabled`). When true,
   * retail's SECTOR_DEMAND inputs (food, electronics, …) are skipped — the
   * household basket owns those final-demand legs and would double-count them.
   *
   * The retail-commodity SELF-LOOP below is deliberately NOT suppressed: under
   * plants, retail supply is physical `producedUnits` while household demand is
   * population × per-capita, and those scales do not match (ticket #1026: live
   * Consumer Goods sat at ~169× oversupply / ~8.3M supply vs ~49k demand). The
   * self-loop (`demand ≈ supply × GDP multiplier`) is what keeps the retail
   * OUTPUT commodity solvent; household's small `retail` basket weight stays as
   * a mild additive, not a replacement. Optional/false is a pure no-op.
   */
  suppressRetailConsumerDemand = false,
  /**
   * Plants tier (marketSystemMode >= "plants"). When true, a sector carrying a
   * persisted `producedUnits` contributes REAL production to the world supply
   * ledger (split across its output mix) instead of the revenue nameplate, and
   * scales its INPUT demand by capacity utilization. Mothballed sectors drop out
   * of both sides entirely. False/omitted is a pure no-op — every non-plants
   * path stays byte-identical.
   */
  plantsEnabled = false,
  /**
   * Plants tier, ERA WORLDS (ticket #1027 phase 2): the world's era unit-basis
   * scale (`getEraUnitScale(preset)`, ~69.8 for 1953, exactly 1 for modern).
   *
   * Under plants, SUPPLY became physical `producedUnits` from `capitalStock`,
   * which carries the era unit scale (one era ₳ buys ~70 modern-priced units -
   * see `capacityUnitYield`). But every dollars-to-units leg in THIS function
   * still divides era-nominal revenue by the MODERN `COMMODITY_BASE_PRICES`
   * table: intermediate SECTOR_DEMAND inputs, the macro GDP legs (real estate /
   * network / entertainment / construction services), and the legacy nameplate
   * supply path (unowned buckets, extraction). On a 1953 world those legs are
   * therefore undercounted ~70x against plants supply - the structural driver
   * of the 12-312x finished-good gluts and the 0.44-0.68x price floor cluster
   * that #4254's household re-anchor could not reach (it only moved the
   * household leg).
   *
   * Multiplying every dollars-derived leg by this scale re-expresses the whole
   * ledger in the era's own units, the same basis `eraScaledBasePrices` gives
   * the rest of `commodityPriceTurn`. Legacy-vs-legacy ratios (e.g. extraction
   * supply vs its industrial consumers - the currently healthy extractables)
   * are preserved exactly, because both sides scale together; only the
   * legacy-vs-plants mismatch closes. The stabilizer and drift terms are
   * deliberately NOT scaled - they are modern-unit floors on both sides and
   * shrink in relative terms as the real economy is counted at full size.
   *
   * Passed ONLY by plants-era callers (`plantsLedgerEnabled ? eraUnitScale : 1`
   * in `commodityPriceTurn`); absent/1 is a pure no-op, so every legacy caller,
   * every modern world and every below-plants world stays byte-identical.
   */
  ledgerUnitScale = 1
): {
  global: Map<CommodityType, { supply: number; demand: number }>;
  byState: Map<string, Map<CommodityType, { supply: number; demand: number }>>;
} {
  const global = new Map<CommodityType, { supply: number; demand: number }>();
  const byState = new Map<string, Map<CommodityType, { supply: number; demand: number }>>();

  // Era ledger scale for every dollars-to-units leg (see `ledgerUnitScale` doc).
  // Garbage-tolerant like `safeUnitScale`: non-finite/non-positive means 1.
  const luScale =
    typeof ledgerUnitScale === "number" && Number.isFinite(ledgerUnitScale) && ledgerUnitScale > 0
      ? ledgerUnitScale
      : 1;
  // Parallel tally of what each demand leg would have been WITHOUT the era
  // rescale - the floor of the PLANTS_LEDGER_DEMAND_SUPPLY_CAP pass at the
  // bottom (a commodity in genuine shortage on the legacy basis keeps its full
  // pressure). Only allocated when the rescale is active.
  const demandUnscaled = luScale > 1 ? new Map<CommodityType, number>() : null;
  const addUnscaledDemand = (commodity: CommodityType, units: number) => {
    if (demandUnscaled) demandUnscaled.set(commodity, (demandUnscaled.get(commodity) ?? 0) + units);
  };

  // Initialize all commodity types with the per-commodity stabilizer. Big
  // markets keep the 50k default; thin markets use a smaller value so the
  // stabilizer no longer flattens their true supply/demand ratio (audit t786).
  for (const c of COMMODITY_TYPES) {
    const stab = getCommodityStabilizer(c);
    global.set(c, { supply: stab, demand: stab });
  }

  for (const sector of sectors) {
    const st = sector.sectorType as CorporationType;

    // Ensure state map exists (no base stabilizer — state level is fully dynamic)
    if (!byState.has(sector.stateId)) {
      const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
      for (const c of COMMODITY_TYPES) {
        stateMap.set(c, { supply: 0, demand: 0 });
      }
      byState.set(sector.stateId, stateMap);
    }
    const stateMap = byState.get(sector.stateId)!;

    // Natcorp sectors contribute only 0.25% of commodity flows
    const natcorpScale = sector.isNatcorp ? NATCORP_COMMODITY_MULTIPLIER : 1;
    // Production policy: asymmetric multipliers for output (supply) and input (demand)
    // High policy (+25): +15% output, +10% inputs, +10% revenue
    // Low policy (-25): -10% output, -15% inputs, -5% revenue
    const outputMultiplier = getOutputMultiplier(sector.productionPolicyLevel ?? 0);
    const inputMultiplier = getInputMultiplier(sector.productionPolicyLevel ?? 0);

    // Use operating strategy rates when available, fall back to hardcoded maps
    const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
    const strategyRates =
      hasStrategy || sector.transitionFromStrategyId
        ? getEffectiveStrategyRates(
            st,
            sector.strategyId ?? "standard",
            sector.transitionFromStrategyId,
            sector.transitionStartTurn,
            currentTurn ?? 0
          )
        : null;

    // Planned economies produce state information, not sold airtime. Applied to
    // BOTH the strategy path and the legacy SECTOR_SUPPLY fallback, and mirrored
    // on the clearing offer in turn/corporation/index.ts — the ledger and the
    // offered book must stay in the same commodities.
    const rawSupplyMix: Partial<Record<CommodityType, number>> = strategyRates
      ? strategyRates.supply
      : Object.fromEntries((SECTOR_SUPPLY[st] ?? []).map((f) => [f.commodity, f.rate]));
    const supplyEntries = Object.entries(
      applyPlannedEconomyOutputMix(st, rawSupplyMix, sector.plannedEconomy === true)
    ) as [CommodityType, number][];

    // ── Plants: real production replaces the revenue nameplate ────────────────
    // The nameplate derivation (revenue × rate / basePrice) is a PROXY for
    // output. Under plants the sector already measured what it made, so the
    // ledger reads that instead — this is what makes a throttled, mothballed or
    // capacity-constrained plant actually disappear from world supply.
    //
    // The scaling chain (natcorpScale × embargoSupplyFactor) is applied on top
    // because `producedUnits` does not carry those legs. The production-policy
    // output curve is NOT in this chain — since ticket #1072 it gates tonnage in
    // `sectorTurn`, so `producedUnits` already carries it. It lives in ONE place,
    // `plantsSupplyScaledUnits`, shared with the clearing offer in
    // turn/corporation/index.ts — the offered book and this ledger must stay in
    // the same units or clearing's lagged-supply reconciliation misfires (and
    // for `realUnits` offers it is switched off entirely, so nothing catches a
    // drift).
    //
    // EXTRACTION IS EXCLUDED on purpose: extraction supply carries the
    // per-resource output scale and the deposit-capacity rationing multipliers
    // applied further down this loop, and `producedUnits` already contains its
    // own capacity haircut. Mixing the two would double-count the rationing, so
    // extraction keeps the legacy derivation (owned by the extraction-rationing
    // pass). Mothballing still zeroes it, below — that is mode-level, not
    // extraction math.
    // Output sold to a state arsenal never reaches the market. Applied to both supply
    // paths below — the plants override and the revenue nameplate — because a contracted
    // plant diverts real production either way. The matching deduction on the cash side is
    // the `hourlyRevenue` leg in `sectorTurn`; the two must move together or the plant
    // loses revenue for goods the world still received.
    const militaryRetained = 1 - Math.min(1, Math.max(0, sector.militaryDivertedFraction ?? 0));

    const plantsMothballed = plantsEnabled && sector.mothballed === true;
    const plantsSupplyUnits =
      plantsEnabled && st !== "extraction"
        ? plantsSupplyScaledUnits({
            producedUnits: sector.producedUnits,
            isNatcorp: sector.isNatcorp === true,
            embargoSupplyFactor: sector.embargoSupplyFactor,
          })
        : null;
    // Utilization scales INPUT demand: producedUnits / capacity. A plant running
    // at 60% of nameplate consumes ~60% of its inputs rather than 100%.
    const plantsUtilization =
      plantsEnabled &&
      typeof sector.producedUnits === "number" &&
      typeof sector.capacityUnits === "number" &&
      sector.capacityUnits > 0
        ? Math.max(0, Math.min(1, sector.producedUnits / sector.capacityUnits))
        : 1;
    const plantsSupplyRates: Partial<Record<CommodityType, number>> | null =
      plantsSupplyUnits != null ? Object.fromEntries(supplyEntries) : null;

    for (const [commodity, rate] of supplyEntries) {
      // D12: a mothballed plant is cold — it supplies nothing to the world.
      if (plantsMothballed) continue;
      if (plantsSupplyUnits != null && plantsSupplyRates) {
        const units =
          plantsSupplyUnits *
          commodityMixWeight(plantsSupplyRates, COMMODITY_BASE_PRICES, commodity) *
          militaryRetained;
        if (units > 0) {
          global.get(commodity)!.supply += units;
          stateMap.get(commodity)!.supply += units;
        }
        continue;
      }
      // `luScale` (era plants worlds): the nameplate is era-nominal ₳ against
      // the modern price table, so without the scale this leg is ~70x under the
      // plants unit basis - see the `ledgerUnitScale` doc above.
      let units =
        dollarsToUnits(sector.revenue * rate, COMMODITY_BASE_PRICES[commodity]) *
        luScale *
        natcorpScale *
        outputMultiplier *
        militaryRetained;

      // Plants, extraction only: bring the nameplate down to what the plant
      // actually made. The SAME fraction the depletion booking charges the
      // state's reserves at — see `extractionRealizedFraction`. Without it the
      // ledger counted a ramping or throughput-limited field at full nameplate
      // while the ground was only debited for the real output.
      if (plantsEnabled && st === "extraction") {
        const f = sector.extractionRealizedFraction;
        if (typeof f === "number" && Number.isFinite(f)) units *= Math.max(0, Math.min(1, f));
      }

      // Structural extraction shortage stabilizer (audit t873): boost extraction
      // output per-resource BEFORE the capacity haircut, so the extra output
      // fills idle deposit capacity rather than exceeding it. Inert (×1) unless
      // gameConfig.extractionOutputScaleEnabled — see EXTRACTION_OUTPUT_SCALE.
      if (st === "extraction") {
        units *= extractionOutputScaleFor(commodity, extractionOutputScaleEnabled);
      }

      if (st === "extraction" && sector.sectorId && extractionMultipliers) {
        const sectorMults = extractionMultipliers.get(sector.sectorId);
        if (sectorMults && (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity)) {
          const mult = sectorMults[commodity as ExtractableResource] ?? 1;
          units *= mult;
        }
      }

      const g = global.get(commodity)!;
      g.supply += units;
      const s = stateMap.get(commodity)!;
      s.supply += units;
    }

    const demandEntries = strategyRates
      ? (Object.entries(strategyRates.demand) as [CommodityType, number][])
      : (SECTOR_DEMAND[st] ?? []).map((f) => [f.commodity, f.rate] as [CommodityType, number]);

    // For retail sectors, scale demand by GDP growth multiplier
    let demandMultiplier = 1;
    if (st === "retail" && gdpGrowthData) {
      const stateGdp = gdpGrowthData.byState.get(sector.stateId) ?? 0;
      demandMultiplier = computeRetailDemandMultiplier(gdpGrowthData.nationalAverage, stateGdp);
    }

    // World Events v1 Phase 1: temporary world-event sector demand bump
    // (e.g. royal-event's tourism bump, modeled on the "entertainment"
    // sector — see worldEvents/handlers/royalEvent.ts). Additive with the
    // retail GDP multiplier above, not a replacement for it.
    if (sectorDemandModifierPct && sector.countryId) {
      const pct = sectorDemandModifierPct.get(`${sector.countryId}:${st}`);
      if (pct) {
        demandMultiplier *= 1 + pct / 100;
      }
    }

    // Household Ledger consolidation: retail's consumer-input demand is the
    // legacy consumer proxy — skip it when the household pass owns final demand.
    // D12 residual: a mothballed plant buys nothing either. Before this, cold
    // capacity kept demanding its full nameplate inputs from the world ledger.
    if (!(suppressRetailConsumerDemand && st === "retail") && !plantsMothballed) {
      for (const [commodity, rate] of demandEntries) {
        const units =
          dollarsToUnits(
            sector.revenue * rate * demandMultiplier,
            COMMODITY_BASE_PRICES[commodity]
          ) *
          luScale *
          natcorpScale *
          inputMultiplier *
          plantsUtilization;
        const g = global.get(commodity)!;
        g.demand += units;
        addUnscaledDemand(commodity, units / luScale);
        const s = stateMap.get(commodity)!;
        s.demand += units;
      }
    }
  }

  // ── Retail commodity: demand driven by GDP growth ──────────────────────────
  // Consumer demand for the "retail" commodity is derived from retail supply
  // scaled by the GDP growth multiplier. When GDP grows, demand > supply
  // (consumers want more), driving up retail prices. When GDP shrinks,
  // demand < supply (consumers pull back), depressing retail prices.
  //
  // Always runs — including when `suppressRetailConsumerDemand` is on. That flag
  // only drops retail's INPUT proxy (SECTOR_DEMAND); the household basket cannot
  // replace this self-loop at plants-scale physical supply (ticket #1026).
  if (gdpGrowthData) {
    for (const [stateId, stateMap] of byState) {
      const retailBal = stateMap.get("retail");
      if (!retailBal || retailBal.supply <= 0) continue;
      const stateGdp = gdpGrowthData.byState.get(stateId) ?? 0;
      const multiplier = computeRetailDemandMultiplier(gdpGrowthData.nationalAverage, stateGdp);
      const consumerDemand = retailBal.supply * multiplier;
      retailBal.demand += consumerDemand;
      const g = global.get("retail")!;
      g.demand += consumerDemand;
      // Supply-derived, already in the plants unit basis - not era-rescaled,
      // so its unscaled tally is the same value.
      addUnscaledDemand("retail", consumerDemand);
    }
  }

  // ── Real Estate Services: macro demand from GDP + Prime Rate ─────────────────
  // Each state generates real estate services demand proportional to its GDP,
  // scaled by the prime rate environment (lower rates → more demand).
  if (gdpGrowthData && stateGdpMap && primeRates) {
    const reBasePrice = COMMODITY_BASE_PRICES["real_estate_services"];
    for (const [stateId, gdp] of stateGdpMap) {
      if (gdp <= 0) continue;

      // We need the prime rate for the country this state belongs to.
      // To avoid a heavy lookup, we assume primeRates is passed as a Map of stateId -> primeRate.
      const primeRate = primeRates.get(stateId);
      if (primeRate === undefined) continue;

      const rateMultiplier = computeRateEnvironmentMultiplier(primeRate);
      const baseDemand = ((gdp * REAL_ESTATE_GDP_DEMAND_FRACTION) / reBasePrice) * luScale;
      const units = baseDemand * rateMultiplier;
      if (units <= 0) continue;

      // Add to global
      const g = global.get("real_estate_services")!;
      g.demand += units;
      addUnscaledDemand("real_estate_services", units / luScale);

      // Add to state
      if (!byState.has(stateId)) {
        const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) {
          stateMap.set(c, { supply: 0, demand: 0 });
        }
        byState.set(stateId, stateMap);
      }
      const s = byState.get(stateId)!.get("real_estate_services")!;
      s.demand += units;
    }
  }

  // ── Network Services: macro demand from GDP (broadband/connectivity) ─────────
  if (stateGdpMap) {
    const nsBasePrice = COMMODITY_BASE_PRICES["network_services"];
    for (const [stateId, gdp] of stateGdpMap) {
      if (gdp <= 0) continue;
      const units = ((gdp * NETWORK_SERVICES_GDP_DEMAND_FRACTION) / nsBasePrice) * luScale;
      if (units <= 0) continue;
      global.get("network_services")!.demand += units;
      addUnscaledDemand("network_services", units / luScale);
      if (!byState.has(stateId)) {
        const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) stateMap.set(c, { supply: 0, demand: 0 });
        byState.set(stateId, stateMap);
      }
      byState.get(stateId)!.get("network_services")!.demand += units;
    }
  }

  // ── Entertainment Services: macro demand from GDP (leisure spending) ─────────
  if (stateGdpMap) {
    const esBasePrice = COMMODITY_BASE_PRICES["entertainment_services"];
    for (const [stateId, gdp] of stateGdpMap) {
      if (gdp <= 0) continue;
      const units = ((gdp * ENTERTAINMENT_SERVICES_GDP_DEMAND_FRACTION) / esBasePrice) * luScale;
      if (units <= 0) continue;
      global.get("entertainment_services")!.demand += units;
      addUnscaledDemand("entertainment_services", units / luScale);
      if (!byState.has(stateId)) {
        const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) stateMap.set(c, { supply: 0, demand: 0 });
        byState.set(stateId, stateMap);
      }
      byState.get(stateId)!.get("entertainment_services")!.demand += units;
    }
  }

  // ── Construction Services: macro demand from GDP (infrastructure investment) ─
  if (stateGdpMap) {
    const csBasePrice = COMMODITY_BASE_PRICES["construction_services"];
    for (const [stateId, gdp] of stateGdpMap) {
      if (gdp <= 0) continue;
      const units = ((gdp * CONSTRUCTION_SERVICES_GDP_DEMAND_FRACTION) / csBasePrice) * luScale;
      if (units <= 0) continue;
      global.get("construction_services")!.demand += units;
      addUnscaledDemand("construction_services", units / luScale);
      if (!byState.has(stateId)) {
        const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) stateMap.set(c, { supply: 0, demand: 0 });
        byState.set(stateId, stateMap);
      }
      byState.get(stateId)!.get("construction_services")!.demand += units;
    }
  }

  // ── Era-rescale demand cap (see PLANTS_LEDGER_DEMAND_SUPPLY_CAP) ──────────
  // Applied on the world total AFTER every demand leg has accumulated, and each
  // state's demand is scaled by the same factor so state shares are preserved -
  // the exact shape of the household supply clamp in householdConsumption.ts.
  // The floor is the unscaled (legacy-basis) demand plus the stabilizer both
  // tallies carry, so the cap can only ever bound the SCALE-UP, never cut a
  // commodity below the pressure it already had before this change.
  if (demandUnscaled) {
    for (const [commodity, bal] of global) {
      const cap = bal.supply * PLANTS_LEDGER_DEMAND_SUPPLY_CAP;
      if (bal.demand <= cap) continue;
      const unscaled = getCommodityStabilizer(commodity) + (demandUnscaled.get(commodity) ?? 0);
      const target = Math.max(unscaled, cap);
      if (target >= bal.demand) continue;
      const factor = target / bal.demand;
      bal.demand = target;
      for (const stateMap of byState.values()) {
        const s = stateMap.get(commodity);
        if (s && s.demand > 0) s.demand *= factor;
      }
    }
  }

  applyUnownedCommodityDrift(global, currentTurn);

  return { global, byState };
}
