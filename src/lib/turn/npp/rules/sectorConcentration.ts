/**
 * Challenger pull for concentrated sectors.
 *
 * A sector where one firm holds most of the capacity has no real race: the
 * rivals are too small to matter and nothing in the NPP brain notices. This
 * module measures that per sector and turns it into a multiplier that the
 * founding draw and the growth leg of reinvestment apply to NON-leaders. The
 * leader is never slowed; the pull only speeds up the firms behind it.
 *
 * Pure: plain rows in, plain numbers out. Weight is capacity (capital stock),
 * which needs no currency conversion across countries.
 */

/** Leader share at or below this draws no pull. */
export const CONCENTRATION_PULL_START_SHARE = 0.3;
/** Leader share at or above this draws the full pull. */
export const CONCENTRATION_PULL_FULL_SHARE = 0.6;
/** A rival counts as meaningful at this fraction of the leader's weight. */
export const MEANINGFUL_RIVAL_FRACTION = 0.2;
/** A sector with fewer meaningful firms than this is thin whatever the leader share. */
export const MIN_MEANINGFUL_FIRMS = 3;
/** Pull floor for a thin sector whose leader is not yet dominant. */
export const THIN_SECTOR_PULL = 0.5;
/** Multiplier at full pull. */
export const MAX_CHALLENGER_BOOST = 2.5;

export interface SectorConcentration {
  leaderCorporationId: string;
  leaderShare: number;
  meaningfulFirms: number;
}

/** Per-sector leader and rival count from per-corporation capacity rows. */
export function computeSectorConcentration(
  rows: readonly { sectorType: string; corporationId: string; weight: number }[]
): Map<string, SectorConcentration> {
  const bySector = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!(row.weight > 0) || !Number.isFinite(row.weight)) continue;
    const corps = bySector.get(row.sectorType) ?? new Map<string, number>();
    corps.set(row.corporationId, (corps.get(row.corporationId) ?? 0) + row.weight);
    bySector.set(row.sectorType, corps);
  }
  const out = new Map<string, SectorConcentration>();
  for (const [sectorType, corps] of bySector) {
    let total = 0;
    let leaderId = "";
    let leaderWeight = 0;
    for (const [id, w] of corps) {
      total += w;
      if (w > leaderWeight || (w === leaderWeight && id < leaderId)) {
        leaderId = id;
        leaderWeight = w;
      }
    }
    let meaningful = 0;
    for (const w of corps.values()) if (w >= MEANINGFUL_RIVAL_FRACTION * leaderWeight) meaningful++;
    out.set(sectorType, {
      leaderCorporationId: leaderId,
      leaderShare: leaderWeight / total,
      meaningfulFirms: meaningful,
    });
  }
  return out;
}

/**
 * Multiplier in [1, MAX_CHALLENGER_BOOST] for a firm that is not the sector
 * leader. 1 for the leader, for an unmeasured sector, and for a healthy one.
 */
export function challengerBoost(
  concentration: SectorConcentration | undefined,
  corporationId?: string
): number {
  if (!concentration) return 1;
  if (corporationId !== undefined && corporationId === concentration.leaderCorporationId) return 1;
  const span = CONCENTRATION_PULL_FULL_SHARE - CONCENTRATION_PULL_START_SHARE;
  let pull = Math.min(
    1,
    Math.max(0, (concentration.leaderShare - CONCENTRATION_PULL_START_SHARE) / span)
  );
  if (concentration.meaningfulFirms < MIN_MEANINGFUL_FIRMS && concentration.leaderShare > 0) {
    pull = Math.max(pull, THIN_SECTOR_PULL);
  }
  return 1 + (MAX_CHALLENGER_BOOST - 1) * pull;
}
