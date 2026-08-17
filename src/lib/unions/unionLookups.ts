import type { Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import { unionApproval } from "./unionDues";
import { normalizeServiceIds, type UnionServiceId } from "./unionServices";

/**
 * Per-union approval + active service slate, everything `unionizationDriftTarget`
 * and the strike trigger need from the union that represents a sector.
 *
 * Union dues v1 resolves representation from `CorporateSector.representingUnionId`,
 * a direct pointer to ONE union, not a (countryId, sectorType) match: players can
 * found rivals in an industry that already has a union, so the industry pair no
 * longer identifies a single union, and an unheld sector must not inherit some
 * other union's approval. Callers look up this map by `representingUnionId`.
 */
export interface RepresentingUnionEffects {
  approval: number;
  activeServices: UnionServiceId[];
}

/**
 * Fetch every union's approval + active services, keyed by union `_id` (string).
 * Every union is included regardless of ownership or suspension, an unowned or
 * suspended union still represents whatever sectors point at it, and its last
 * computed approval keeps anchoring their drift target even while its own turn
 * processing (`processUnionsTurn`) is frozen.
 */
export async function buildUnionEffectsById(
  db: Db
): Promise<Map<string, RepresentingUnionEffects>> {
  const unions = await db
    .collection<Union>("unions")
    .find({}, { projection: { _id: 1, approval: 1, activeServices: 1 } })
    .toArray();
  const out = new Map<string, RepresentingUnionEffects>();
  for (const u of unions) {
    out.set(u._id.toString(), {
      approval: unionApproval(u),
      activeServices: normalizeServiceIds(u.activeServices),
    });
  }
  return out;
}
