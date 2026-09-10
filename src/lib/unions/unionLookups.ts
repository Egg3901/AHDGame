/**
 * Represented workers respond to their union's approval and funded services.
 * buildUnionEffectsById preserves approval during a vacancy or suspension,
 * while services require a leader and a receipt paid for the requested turn.
 */
import type { Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import { unionApproval } from "./unionDues";
import type { UnionServiceId } from "./unionServices";
import { loadFundedUnionServices, UNION_SERVICE_FUNDING_PROJECTION } from "./unionServiceFunding";

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
 * processing (`processUnionsTurn`) is frozen. Service effects require a funded
 * programme at an owned, operating union, matching the union turn's charges.
 */
export async function buildUnionEffectsById(
  db: Db,
  currentTurn: number
): Promise<Map<string, RepresentingUnionEffects>> {
  const unions = await db
    .collection<Union>("unions")
    .find({}, { projection: { _id: 1, approval: 1, ...UNION_SERVICE_FUNDING_PROJECTION } })
    .toArray();
  const fundedServices = loadFundedUnionServices(unions, currentTurn);
  const out = new Map<string, RepresentingUnionEffects>();
  for (const u of unions) {
    out.set(u._id.toString(), {
      approval: unionApproval(u),
      activeServices: fundedServices.get(u._id.toString()) ?? [],
    });
  }
  return out;
}
