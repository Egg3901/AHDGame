import type { Db } from "mongodb";
import type { UnownedSector } from "@/lib/db/types";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import { boostUnownedDocIntoNatCorp } from "@/lib/nationalization/seedToNatCorp";

/** Boost unowned docs in nat-corp-captured buckets by routing revenue to the National Corporation. */
export async function boostProtectedUnownedToNatCorp(
  db: Db,
  docs: Pick<UnownedSector, "_id" | "stateId" | "sectorType" | "countryId" | "revenue">[],
  protectedBuckets: ReadonlySet<string>,
  multiplier: number
): Promise<number> {
  let redirected = 0;
  for (const doc of docs) {
    if (!protectedBuckets.has(bucketKey(doc.stateId, doc.sectorType))) continue;
    await boostUnownedDocIntoNatCorp(db, doc, multiplier);
    redirected++;
  }
  return redirected;
}
