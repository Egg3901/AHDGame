/**
 * Tunable constants for the inter-country trade clearing engine.
 *
 * Affinity multipliers and the base geographic matrix shape who trades with
 * whom; the IPF iteration count controls allocation accuracy. All values are
 * intended to be revisited in the Phase 4 balance pass.
 */

/** Multiplier applied to affinity when a pair is covered by an active FTA. */
export const TRADE_FTA_AFFINITY_BONUS = 1.6;

/** Multiplier applied to affinity when both countries share an org bloc. */
export const TRADE_BLOC_AFFINITY_BONUS = 1.25;

/**
 * How strongly an importer's tariff drags affinity down.
 * drag = 1 / (1 + TRADE_TARIFF_DRAG_SCALE × tariffRate).
 * At scale 3, a 20% tariff yields drag ≈ 0.625 (−37.5% affinity).
 */
export const TRADE_TARIFF_DRAG_SCALE = 3;

/** Default affinity for any pair with no explicit override. */
export const TRADE_BASE_AFFINITY_DEFAULT = 1;

/** Number of IPF iterations for clearing. 40 converges margins well below 0.5%. */
export const TRADE_IPF_ITERATIONS = 40;

/**
 * Cabinet (minister-driven) embargo limits. The cabinet path is a fast but
 * deliberately rate-limited lever; durable / repeatable restrictions are meant
 * to go through legislation instead.
 */
// Each ministerial embargo costs one cabinet action.
export const TRADE_EMBARGO_CABINET_ACTION_COST = 1;
// Longest a ministerial embargo can run before it must be renewed (2 game years).
export const TRADE_EMBARGO_MAX_DURATION_TURNS = 96;
// How many ministerial embargoes one cabinet member may keep active at once.
export const TRADE_EMBARGO_MAX_ACTIVE_PER_MEMBER = 2;
// After enacting a ministerial embargo on a target, that source→target pair is
// locked from a NEW ministerial embargo for this many turns (3.5 game years),
// measured from enactment — so a minister can't endlessly re-impose it; durable
// restriction is the legislative path. Lifting early does not reset the lock.
export const TRADE_EMBARGO_TARGET_COOLDOWN_TURNS = 168;

/**
 * Dampened price-convergence factor. Whole-market relief: each country's
 * effective S/D eases by k× the trade it did, before pricing. Validated against
 * live data (turn 414): k=0.5 → ≤19% national price shift, nothing past the
 * commodity soft-knee.
 */
export const TRADE_PRICE_CONVERGENCE_K = 0.5;

/**
 * Export reward. A sector earns a margin premium for producing a commodity its
 * country actually exports into foreign deficits:
 *   premium = Σ_commodity (supplyRate × exportIntensity) × TRADE_EXPORT_PREMIUM_RATE
 * where exportIntensity ∈ [0,1] is the fraction of the country's surplus of that
 * commodity that cleared abroad. Clamped to TRADE_EXPORT_PREMIUM_CAP percentage
 * points so it nudges firms toward export markets without dominating margin.
 */
// RATE=6 keeps the premium a real 0→cap gradient: a single ~0.5-rate commodity
// fully exported earns ~3pp, diversified high-intensity exporters approach the
// cap. (At RATE=12 the live data showed ~half of exporters pinned at the cap,
// flattening the signal — see trade-export-premium-investigation.ts, turn 414.)
export const TRADE_EXPORT_PREMIUM_RATE = 6;
export const TRADE_EXPORT_PREMIUM_CAP = 6;

/**
 * Trade-exposure embargo model (feature-gated on `embargoTradeExposureEnabled`).
 *
 * Legacy behaviour: a TOTAL embargo (commodity "all", mode "block") mothballs
 * every sector a target-nation corporation runs in the source country — revenue
 * AND cost zeroed, the whole operation goes dark including its domestic host
 * sales. That is both economically wrong (an embargo restricts cross-border
 * flows, not a locally-operating subsidiary's domestic commerce) and invisible
 * in the corp Financials (ticket #935).
 *
 * New behaviour: the embargo strips only the sector's cross-border leg. The
 * sector keeps operating on domestic host demand; revenue is scaled by
 * (1 − exportExposure × TRADE_EMBARGO_EXPORT_LOSS_SHARE), where exportExposure is
 * the supply-weighted fraction of the sector's output that cleared abroad last
 * turn. A pure export play collapses toward zero (its market is gone); a
 * domestic-facing sector is barely touched. Maintenance auto-scales with the
 * reduced revenue (grossMaintenance = hourlyRevenue × (1 − margin)), so the
 * domestic remainder operates at its normal margin — no stranded costs. The
 * sector's export-premium margin bonus is also dropped (the remaining sales are
 * domestic). Fixed corp-level overhead (marketing/logistics/R&D/CEO) then does
 * the rest, which is the realistic drag an export shock imposes.
 */
// Fraction of the export-exposed revenue share that a total embargo destroys.
// 1 = lose all exports (worst case, no bilateral pool granularity to spare
// exports to non-embargoing partners); tune down in the balance pass if the
// hit proves too sharp against live/worldsim data.
export const TRADE_EMBARGO_EXPORT_LOSS_SHARE = 1;

/**
 * Symmetric base geographic affinity overrides for "naturally" closer markets.
 * Keyed "A-B" with A,B in alphabetical order. Pairs absent here use
 * TRADE_BASE_AFFINITY_DEFAULT. Tunable in the Phase 4 balance pass.
 */
export const TRADE_BASE_AFFINITY_OVERRIDES: Record<string, number> = {
  // North America ↔ partners
  "BR-US": 1.4,
  "CN-US": 1.5,
  "JP-US": 1.3,
  "UK-US": 1.4,
  // European proximity
  "DE-IE": 1.5,
  "DE-UK": 1.4,
  "IE-UK": 1.6,
  // Asia proximity
  "CN-JP": 1.4,
  // Africa ↔ partners
  "CN-NG": 1.3,
  "NG-UK": 1.3,
  // Yugoslavia non-aligned path (YU only exists in Cold-War presets): US military
  // + economic aid after the 1948 Tito–Stalin split; UK trade via Trieste /
  // Adriatic channels. Mild Western lean vs Soviet-bloc default affinity.
  "US-YU": 1.35,
  "UK-YU": 1.25,
};
