/** Batch read-only parent-CEO access for a page of private corporations. */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "./corporateOwnership";
import {
  corporationWithReservedHoldings,
  loadReservedCorporatePositionsByTarget,
} from "./reservedCorporateHoldings";

/** The caller supplies only rows whose ordinary private redaction would apply. */
export async function parentCeoVisibleCorporationIds(
  db: Db,
  corporations: readonly Corporation[],
  viewerUserId: string | null | undefined
): Promise<Set<string>> {
  if (!viewerUserId || !corporations.length) return new Set();
  const reservations = await loadReservedCorporatePositionsByTarget(
    db,
    corporations.map((corp) => corp._id)
  );
  const parents = corporations.flatMap((corp) => {
    const parent = getControllingCorporateParent(
      corporationWithReservedHoldings(corp, reservations.get(corp._id.toString()) ?? [])
    );
    return parent ? [{ corporationId: corp._id.toString(), parentId: parent.corporationId }] : [];
  });
  if (!parents.length) return new Set();
  const ids = [...new Map(parents.map((row) => [row.parentId.toString(), row.parentId])).values()];
  const parentRows = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: ids } })
    .project({ userId: 1, ceoVacant: 1 })
    .toArray();
  const controlled = new Set(
    parentRows
      .filter((row) => row.ceoVacant !== true && row.userId?.toString() === viewerUserId)
      .map((row) => row._id.toString())
  );
  return new Set(
    parents.filter((row) => controlled.has(row.parentId.toString())).map((row) => row.corporationId)
  );
}
