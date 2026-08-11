import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { applyFacilityLoss } from "@/lib/market/brandLoyalty";

/**
 * Brand facility-loss hook (the "Boeing rule", Package A). Losing a sector —
 * to a sale, a hostile takeover, closure, or nationalization — dents the
 * corp's brand proportional to how big that sector was for it. Losing your
 * flagship plant costs more reputation than shedding a rounding-error outpost.
 *
 * Pure math lives in {@link applyFacilityLoss}; this wrapper resolves the
 * sector's share of the corp's total revenue and persists the new loyalty.
 * A no-op when the corp has no loyalty yet (feature off / never accrued), so
 * it is safe to call unconditionally from any removal path.
 *
 * NOTE: call this BEFORE the sector doc is deleted/reassigned if you pass a
 * sectorId, or pass the lost revenue directly if you already have it.
 */
export async function applyBrandFacilityLoss(
  db: Db,
  corpId: ObjectId,
  lostSectorRevenue: number
): Promise<void> {
  if (!(lostSectorRevenue > 0)) return;
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corpId }, { projection: { brandLoyalty: 1 } });
  const loyalty = corp?.brandLoyalty ?? 0;
  if (loyalty <= 0) return; // nothing to lose

  // Total revenue across the corp's remaining + lost sectors (local currency is
  // fine here — it's a RATIO, so the currency cancels as long as both legs are
  // the same corp's local units, which they are).
  const agg = await db
    .collection<CorporateSector>("corporateSectors")
    .aggregate<{ total: number }>([
      { $match: { corporationId: corpId } },
      { $group: { _id: null, total: { $sum: "$revenue" } } },
    ])
    .toArray();
  const remainingRevenue = agg[0]?.total ?? 0;
  // Robust to call order: if the aggregate already includes the lost sector
  // (called BEFORE removal), remainingRevenue >= lostSectorRevenue and is the
  // pre-loss total; if the sector was already removed, add it back.
  const denom =
    remainingRevenue >= lostSectorRevenue ? remainingRevenue : remainingRevenue + lostSectorRevenue;
  if (!(denom > 0)) return;

  const share = Math.min(1, lostSectorRevenue / denom);
  const next = applyFacilityLoss(loyalty, share);
  if (next === loyalty) return;
  await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: corpId }, { $set: { brandLoyalty: Math.round(next * 100) / 100 } });
}
