import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import { resolveRelatedParty } from "@/lib/corporations/supplyExchange/relatedParty";

/**
 * Live supply agreements whose two corporations are related parties (same
 * owner, same CEO, or a material shareholding). The anomaly scan treats
 * supply settlement as routine, so it asks this narrow question to know which
 * agreements to hold to the circular-wire standard instead.
 *
 * Best effort: a failed lookup yields an empty set, which keeps today's
 * behaviour rather than blocking the scan.
 */
export async function loadRelatedSupplyAgreementIds(db: Db): Promise<Set<string>> {
  try {
    const agreements = await db
      .collection<SupplyAgreement>("supplyAgreements")
      .find(
        { status: { $in: ["active", "cancelling"] } },
        { projection: { supplierCorpId: 1, buyerCorpId: 1 } }
      )
      .toArray();
    if (agreements.length === 0) return new Set();
    const corpIds = [...new Set(agreements.flatMap((a) => [a.supplierCorpId, a.buyerCorpId]))];
    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: corpIds } },
        { projection: { userId: 1, ceoId: 1, ceoType: 1, shareholders: 1, totalShares: 1 } }
      )
      .toArray();
    const byId = new Map(corps.map((c) => [c._id.toString(), c]));
    const related = new Set<string>();
    for (const a of agreements) {
      const supplier = byId.get(a.supplierCorpId.toString());
      const buyer = byId.get(a.buyerCorpId.toString());
      if (supplier && buyer && resolveRelatedParty(supplier, buyer)) {
        related.add(a._id!.toString());
      }
    }
    return related;
  } catch {
    return new Set();
  }
}

/** Audit `meta.agreementId` has been written as both a string and an ObjectId. */
export function agreementIdMatchValues(ids: ReadonlySet<string>): (string | ObjectId)[] {
  return [...ids].flatMap((id) => (ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id]));
}
