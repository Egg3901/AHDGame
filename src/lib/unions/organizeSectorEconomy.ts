/**
 * Client-safe prices and gain for a targeted sector organize drive.
 * The command (`commands/organizeSector.ts`) charges these and applies the gain.
 */

function clamp0to100(value: number | undefined): number {
  return Math.max(
    0,
    Math.min(100, typeof value === "number" && Number.isFinite(value) ? value : 0)
  );
}

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Action points a union head spends to run one targeted drive. */
export const ORGANIZE_SECTOR_ACTION_COST = 1;

/**
 * Treasury per worker to organize a shop this union does not yet hold.
 * A default-sized shop ({@link DEFAULT_ORGANIZE_SHOP_WORKERS}) therefore
 * still costs {@link ORGANIZE_SECTOR_TREASURY_COST}.
 */
export const ORGANIZE_TREASURY_COST_PER_WORKER = 2;

/** Floor so a tiny or empty shop is never a free click. */
export const ORGANIZE_TREASURY_COST_MIN = 50;

/** Cap so a national champion shop cannot empty the treasury in one drive. */
export const ORGANIZE_TREASURY_COST_MAX = 8_000;

/** Worker count the flat fallback quote is calibrated against (new-sector default). */
export const DEFAULT_ORGANIZE_SHOP_WORKERS = 500;

/**
 * Fallback treasury quote when the caller has no shop size yet.
 * Equals a 500-worker unorganized drive.
 */
export const ORGANIZE_SECTOR_TREASURY_COST =
  ORGANIZE_TREASURY_COST_PER_WORKER * DEFAULT_ORGANIZE_SHOP_WORKERS;

/**
 * Unionization points added at 100 approval. Actual gain is this times
 * approval/100, so a union the membership likes organizes faster.
 */
export const SECTOR_UNIONIZATION_GAIN_BASE = 5;

/** Approval-point edge the attacking union needs over the incumbent to win a raid. */
export const RAID_APPROVAL_EDGE_REQUIRED = 5;

export interface OrganizeSectorCostInput {
  /** Current sector workforce. Missing/non-finite treated as 0. */
  workers: number | undefined;
  /** Current unionization 0-100. Used only when reinforcing an already-held shop. */
  unionization: number | undefined;
  /** True when this union already represents the shop. */
  isOwnSector: boolean;
}

/**
 * Treasury cost of one targeted drive.
 *
 * - Shop this union does not hold (greenfield or raid): scales with workforce.
 * - Shop this union already holds (reinforcement): scales with workforce AND
 *   current unionization, so pushing 80% → 85% costs more than 10% → 15%.
 */
export function organizeSectorTreasuryCost(input: OrganizeSectorCostInput): number {
  const workers = finiteNonNegative(input.workers);
  const density = clamp0to100(input.unionization) / 100;
  const raw = input.isOwnSector
    ? ORGANIZE_TREASURY_COST_PER_WORKER * workers * density
    : ORGANIZE_TREASURY_COST_PER_WORKER * workers;
  return Math.round(
    Math.max(ORGANIZE_TREASURY_COST_MIN, Math.min(ORGANIZE_TREASURY_COST_MAX, raw))
  );
}

/** Unionization points one drive adds: 5% times the union's approval (0-100). */
export function sectorUnionizationGain(approval: number): number {
  return SECTOR_UNIONIZATION_GAIN_BASE * (clamp0to100(approval) / 100);
}

export { clamp0to100 };
