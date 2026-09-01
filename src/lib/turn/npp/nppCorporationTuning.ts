/**
 * Tuning constants for NPP corporation behaviour.
 *
 * Extracted verbatim from nppCorporationBehavior.ts so that file stays under
 * the 2000 LOC architecture cap. Values and comments are unchanged; every
 * constant is re-exported from the behaviour module for existing importers.
 */
import type { CeoArchetype } from "@/lib/turn/ceoArchetype";

/**
 * Largest share of a sector's gross margin that may be spent on growth before an
 * NPP stops expanding it. Half leaves the other half to cover corporate
 * overhead and still return a profit.
 */
export const GROWTH_COST_MARGIN_SHARE = 0.5;

// Plants reinvestment converts the existing growth judgement into purchased
// replacement and growth capacity, bounded by fill, headroom, cash, and queue
// rails. Aggression is the calibration knob; the other values are safety caps.
export const NPP_REINVEST_AGGRESSION = 1.0;
/** Minimum evidence of demand before buying more capacity. */
export const NPP_REINVEST_MIN_FILL = 0.85;
/** Queue depth is a storage bound; replacement size carries the cadence. */
export const NPP_REINVEST_MAX_QUEUE_DEPTH = 20;
/** Stop discretionary growth sooner than necessary replacement. */
export const NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH = 2;
/**
 * Growth builds from nothing, like a player's `buildCapacity` — it is NOT gated
 * or sized by the unowned-headroom pool. A plant that is profitable, selling
 * through its output (fill >= MIN_FILL) and in a market that is not glutted
 * grows by deploying this share of its post-floor surplus into capacity each
 * turn it can. The per-sector affordability rail and the cash floor bound the
 * spend; a selling-out plant that overbuilds sees fill fall and stops.
 */
export const NPP_GROWTH_DEPLOY_FRACTION = 0.5;
/**
 * Minimum state shortage score for a growth build — do not add capacity to a
 * glutted market. Mirrors the stranded-decay glut threshold: at or below this
 * the plant is shrinking, not growing.
 */
export const NPP_GROWTH_MIN_SHORTAGE = 0.85;
/**
 * Minimum nameplate utilization (runUnits / capitalStock) for a growth build.
 * Sell-through (fill) alone is not enough: a plant that runs 1,000 of a
 * 100,000,000 nameplate and sells all 1,000 has fill 1 but is 99.999% idle, and
 * adding capacity there is pure waste. Growth requires the plant to be actually
 * near capacity AND selling out before it buys more.
 */
export const NPP_GROWTH_MIN_UTILIZATION = 0.85;
/**
 * Per-turn growth ceiling as a fraction of the capacity the plant actually RUNS.
 * The demand anchor that replaces the phantom unowned pool: a plant's proven
 * throughput is the honest read on how much more it can sell, so it grows by up
 * to this share of run capacity a turn and reassesses next turn (a player adds a
 * chunk to a selling-out plant, not 10,000x it because they hold cash). Growth
 * compounds over turns and self-limits — a plant that outruns its demand sees
 * fill/utilization fall and stops. Floored at one facility so a small plant can
 * still take a first step.
 */
export const NPP_GROWTH_MAX_STEP_OF_RUN = 0.5;
/** A cash-rich conglomerate expands several owned plants a turn, as a player would. */
export const NPP_REINVEST_MAX_SECTORS_PER_TURN = 4;
/** Maintenance may use a cash share even below the discretionary entry floor. */
export const NPP_REINVEST_MAINTENANCE_CASH_SHARE = 0.25;

// Anchor-denominated rails gate expansion, dividends, and growth capex. Their
// ratios preserve a cash buffer while fitting the 1953 economy scale.
export const CASH_FLOOR = 250_000; // Never spend below this
export const EXPANSION_COST = 500_000;
export const EXPANSION_MIN_CASH = 625_000; // Need this much above floor to expand
export const EXPANSION_MIN_MARGIN = 15; // Corp-level avg margin must be healthy

/**
 * Every market entry path shares one corporation cohort slot per eight turns.
 * A shortage changes target priority and financing, never expansion frequency.
 * Each eligible corporation can add at most one site in its slot, and capacity
 * still waits half the normal build lead time.
 */
/** One decision can found only one sector, even with several shortages. */
export const NPP_SHORTAGE_ENTRIES_PER_TURN = 1;

/**
 * Founding build size as a fraction of surplus, not a single facility. A player
 * entering a market does not stop at one plant — they follow the entry with a
 * `buildCapacity` order scaled to their cash and the shortage. An NPP founds at
 * the same scale, committing this share of its post-floor, post-fee surplus to
 * the first build (still capped by the market's unowned headroom, still floored
 * at one facility). Kept below 1 so a single founding bet never zeroes the
 * treasury or starves reinvestment. Fixes the "$2M treasury funds one plant"
 * under-deployment.
 */
export const NPP_FOUNDING_DEPLOY_FRACTION = 0.6;

/**
 * A single founding may claim at most this share of a genuinely UNOWNED
 * market's headroom (unmet demand nobody has built into yet — real for a fresh
 * bucket, unlike the ~0 headroom of an already-owned one, which is why growth
 * no longer reads the pool at all). Cash is the primary bind; the cap only
 * keeps a cash-rich corp from vacuuming a fresh market on entry. Floored at one
 * facility below.
 */
export const NPP_FOUNDING_HEADROOM_SHARE = 0.5;

/**
 * Extraction founds against DEPOSITS, not local demand, so it has no
 * demand-headroom cap. This bounds how big a single new-mine founding may be, in
 * facility quanta, so a cash-rich miner seeds a real mine without dumping its
 * whole treasury into one unproven deposit. The state deposit haircut caps
 * actual output, and the reinvestment growth leg deepens the mine over turns if
 * it sells. See the extraction branch of the founding sizing.
 */
export const NPP_EXTRACTION_FOUNDING_MAX_FACILITIES = 8;

// Archetypes may scale the rails but never remove the minimum buffer.
export const SAFE_CASH_FLOOR_MIN = 125_000; // an aggressive floor still leaves a buffer
export const MAX_DIVIDEND_RATE = 12; // cap any archetype-boosted payout

/** Default archetype for corps whose CEO NPP can't be resolved (legacy / mid-migration). */
export const DEFAULT_ARCHETYPE: CeoArchetype = "cautious";

// Glut response uses fill as the linear signal and a wide restart band.
export const GLUT_MOTHBALL_FILL_THRESHOLD = 0.25;
export const GLUT_MOTHBALL_PRICE_RATIO = 0.65;
export const GLUT_RESTART_PRICE_RATIO = 0.9;

/** Per-turn wage step toward the target. 0.02 × ~4 turns reaches the shortage premium. */
export const NPP_WAGE_STEP = 0.02;
export const NPP_WAGE_BASELINE = 1;
export const NPP_WAGE_SHORTAGE_TARGET = 1.08;
export const NPP_WAGE_GLUT_TARGET = 0.95;
