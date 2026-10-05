import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { hasProtectedConstructionClaim } from "@/lib/banking/rules/constructionProperty";

type RelocationBondLease = NonNullable<Corporation["headquartersRelocationBondFunding"]>;

/**
 * A crashed bond relocation may leave its own HQ transition markers behind.
 * Permit only those exact markers on a retry of the frozen destination, while
 * continuing to reject every active construction claim and unrelated hold.
 */
export function hasProtectedRelocationProperty(
  sectors: Array<
    Pick<CorporateSector, "_id" | "constructionFinancing" | "constructionPropertyTransition">
  >,
  corporationId: Corporation["_id"],
  lease: RelocationBondLease | undefined
): boolean {
  return sectors.some((sector) => {
    if (hasProtectedConstructionClaim(sector)) return true;
    const marker = sector.constructionPropertyTransition;
    if (!marker) return false;
    if (!lease || marker.kind !== "headquarters_relocation") return true;
    const suffix = `:${sector._id.toHexString()}`;
    const commandKey = `headquarters:${corporationId.toHexString()}:${lease.targetStateId}${suffix}`;
    const characterKey = `headquarters:${corporationId.toHexString()}:${lease.targetCountryId}:${lease.targetStateId}${suffix}`;
    return marker.key !== commandKey && marker.key !== characterKey;
  });
}

function exactOptionalField<T extends string>(value: T | undefined) {
  return value === undefined ? { $exists: false } : { $exists: true, $eq: value };
}

function sameOperation(lease: RelocationBondLease, proposed: RelocationBondLease): boolean {
  return (
    lease.operationKey === proposed.operationKey &&
    lease.targetStateId === proposed.targetStateId &&
    lease.targetCountryId === proposed.targetCountryId &&
    lease.currencyCode === proposed.currencyCode
  );
}

/** Freeze a relocation bond quote before its first bond or cash write. */
export async function acquireRelocationBondFundingLease(
  db: Db,
  corporation: Pick<Corporation, "_id" | "countryId" | "liquidCurrencyCode">,
  proposed: RelocationBondLease
): Promise<RelocationBondLease | null> {
  if (!Number.isFinite(proposed.nativeFxRate) || proposed.nativeFxRate <= 0) return null;
  const corporations = db.collection<Corporation>("corporations");
  const current = await corporations.findOne(
    { _id: corporation._id },
    { projection: { headquartersRelocationBondFunding: 1 } }
  );
  if (current?.headquartersRelocationBondFunding) {
    return sameOperation(current.headquartersRelocationBondFunding, proposed)
      ? current.headquartersRelocationBondFunding
      : null;
  }

  const acquired = await corporations.updateOne(
    {
      _id: corporation._id,
      headquartersRelocationBondFunding: { $exists: false },
      primaryUnderwritingIncomingFunding: { $exists: false },
      bankUnderwritingFunding: { $exists: false },
      bankPrimaryFunding: { $exists: false },
      bankConstructionFunding: { $exists: false },
      countryId: exactOptionalField(corporation.countryId),
      liquidCurrencyCode: exactOptionalField(corporation.liquidCurrencyCode),
      ...(proposed.ceoId
        ? { ceoId: proposed.ceoId, ceoType: proposed.ceoType }
        : { ceoId: { $exists: false }, ceoType: { $exists: false } }),
    },
    { $set: { headquartersRelocationBondFunding: proposed, updatedAt: new Date() } }
  );
  if (acquired.matchedCount === 1) return proposed;

  const winner = await corporations.findOne(
    { _id: corporation._id },
    { projection: { headquartersRelocationBondFunding: 1 } }
  );
  const lease = winner?.headquartersRelocationBondFunding;
  return lease && sameOperation(lease, proposed) ? lease : null;
}

export function relocationBondLeaseFilter(key: string) {
  return { "headquartersRelocationBondFunding.operationKey": key };
}

export function relocationBondSourceSnapshotFilter(lease: RelocationBondLease) {
  const exact = <T extends string>(present: boolean, value: T | undefined) =>
    present ? { $exists: true, $eq: value } : { $exists: false };
  return {
    countryId: exact(lease.sourceCountryIdPresent, lease.sourceCountryId),
    liquidCurrencyCode: exact(
      lease.sourceLiquidCurrencyCodePresent,
      lease.sourceLiquidCurrencyCode
    ),
  };
}

export async function releaseRelocationBondFundingLease(
  db: Db,
  corporationId: Corporation["_id"],
  key: string
): Promise<void> {
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: corporationId, ...relocationBondLeaseFilter(key) },
      { $unset: { headquartersRelocationBondFunding: "" }, $set: { updatedAt: new Date() } }
    );
}
