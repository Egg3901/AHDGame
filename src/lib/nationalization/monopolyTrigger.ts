/**
 * Monopoly nationalization trigger (spec §8): a corp's highest (state, sectorType)
 * market share. Compared against MONOPOLY_SHARE_THRESHOLD by evaluateEligibility.
 * Reuses the canonical per-sector share computation so the number matches the
 * dominance penalties elsewhere.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { fetchSectorMarketSharePercent } from "@/lib/corporations/marketShare";

export async function getTopMarketSharePercent(
  db: Db,
  corp: Corporation,
  sectors: CorporateSector[]
): Promise<number> {
  if (sectors.length === 0) return 0;
  let top = 0;
  for (const sector of sectors) {
    const pct = await fetchSectorMarketSharePercent(db, sector, corp);
    if (pct > top) top = pct;
  }
  return top;
}
