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

/** Action points a union head spends to run one targeted drive. */
export const ORGANIZE_SECTOR_ACTION_COST = 1;

/** Treasury cost of one targeted drive. Charged whether or not a raid lands. */
export const ORGANIZE_SECTOR_TREASURY_COST = 1000;

/**
 * Unionization points added at 100 approval. Actual gain is this times
 * approval/100, so a union the membership likes organizes faster.
 */
export const SECTOR_UNIONIZATION_GAIN_BASE = 5;

/** Unionization a previously-unrepresented sector must clear before a drive wins it recognition. */
export const SECTOR_RECOGNITION_THRESHOLD = 50;

/** Approval-point edge the attacking union needs over the incumbent to win a raid. */
export const RAID_APPROVAL_EDGE_REQUIRED = 5;

/** Unionization points one drive adds: 5% times the union's approval (0-100). */
export function sectorUnionizationGain(approval: number): number {
  return SECTOR_UNIONIZATION_GAIN_BASE * (clamp0to100(approval) / 100);
}

export { clamp0to100 };
