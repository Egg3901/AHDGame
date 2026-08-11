import type { Db } from "mongodb";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { absorbOwnedSectorIntoNatCorp, absorbUnownedDocIntoNatCorp } from "./seedToNatCorp";
import {
  enactedLawAllowsCorpMerge,
  loadSectorWideTakingAuthority,
  sectorTakingKey,
  type EnactedSectorTaking,
} from "./enactedSectorTaking";

/**
 * `(stateId:sectorType)` key for a market bucket. Shared format across the
 * unowned-growth and NPP-expansion guards so they agree on what "this bucket" is.
 */
export function bucketKey(stateId: string, sectorType: string): string {
  return `${stateId}:${sectorType}`;
}

/** The `_id` strings of every National Corporation (countryOwnerId set). Few rows. */
export async function loadNationalCorpIds(db: Db): Promise<Set<string>> {
  const natCorps = await db
    .collection<Corporation>("corporations")
    .find({ countryOwnerId: { $exists: true } }, { projection: { _id: 1, countryOwnerId: 1 } })
    .toArray();
  return new Set(natCorps.filter((c) => c.countryOwnerId != null).map((c) => c._id.toString()));
}

/**
 * Buckets a National Corporation controls **via nationalization**, by revenue
 * majority. Protecting these keeps NPP auto-expansion and unowned regrowth from
 * slowly re-fragmenting a sector the state nationalized. Scoped to buckets where
 * the national corp holds at least one BILL-nationalized sector (`nationalizedAtTurn`
 * stamped), so seeded state monopolies (e.g. the NHS, which intentionally keeps a
 * private market) are NOT frozen. Revenue is compared raw (a nationalized bucket's
 * holders are overwhelmingly same-country, so currency is uniform); the check is a
 * coarse majority, not a precise market share.
 */
export function computeStateControlledBuckets(
  corpSectors: Pick<
    CorporateSector,
    "stateId" | "sectorType" | "revenue" | "corporationId" | "nationalizedAtTurn"
  >[],
  nationalCorpIds: ReadonlySet<string>
): Set<string> {
  const stateRev = new Map<string, number>();
  const otherRev = new Map<string, number>();
  const hasNationalized = new Set<string>();
  for (const s of corpSectors) {
    const key = bucketKey(s.stateId, s.sectorType);
    const rev = Number.isFinite(s.revenue) ? (s.revenue as number) : 0;
    if (nationalCorpIds.has(s.corporationId.toString())) {
      stateRev.set(key, (stateRev.get(key) ?? 0) + rev);
      if (s.nationalizedAtTurn != null) hasNationalized.add(key);
    } else {
      otherRev.set(key, (otherRev.get(key) ?? 0) + rev);
    }
  }
  const controlled = new Set<string>();
  for (const [key, sr] of stateRev) {
    if (sr > 0 && hasNationalized.has(key) && sr >= (otherRev.get(key) ?? 0)) controlled.add(key);
  }
  return controlled;
}

/**
 * Buckets where the National Corporation is the **only** corporate holder — no
 * private or NPC corp shares the (state, sectorType) cell. When nationalization
 * consumes the unowned pool the doc is deleted; admin unowned seeding must not
 * recreate it or market share and GDP growth get diluted.
 */
export function computeNatCorpSoleOwnerBuckets(
  corpSectors: Pick<CorporateSector, "stateId" | "sectorType" | "corporationId">[],
  nationalCorpIds: ReadonlySet<string>
): Set<string> {
  const holdersByBucket = new Map<string, Set<string>>();
  for (const s of corpSectors) {
    const key = bucketKey(s.stateId, s.sectorType);
    const holders = holdersByBucket.get(key) ?? new Set<string>();
    holders.add(s.corporationId.toString());
    holdersByBucket.set(key, holders);
  }
  const sole = new Set<string>();
  for (const [key, holders] of holdersByBucket) {
    if (holders.size === 1) {
      const only = [...holders][0];
      if (nationalCorpIds.has(only)) sole.add(key);
    }
  }
  return sole;
}

/**
 * Captured markets where non–national-corp corporate holdings are erroneous
 * (e.g. players split into a bill-nationalized bucket). Honors enacted
 * `sectorScope`: unowned-only laws never merge private corps; partial carves
 * leave the carved remainder legitimate. When no sector-wide law is on record,
 * only revenue-majority state control triggers a merge (legacy / single-sector).
 */
export function computeCapturedMarketMergeBuckets(
  corpSectors: Pick<
    CorporateSector,
    "stateId" | "sectorType" | "countryId" | "revenue" | "corporationId" | "nationalizedAtTurn"
  >[],
  nationalCorpIds: ReadonlySet<string>,
  enactedTakings: ReadonlyMap<string, EnactedSectorTaking> = new Map()
): Set<string> {
  const stateControlled = computeStateControlledBuckets(corpSectors, nationalCorpIds);
  const merge = new Set<string>();

  const countryByBucket = new Map<string, string>();
  const sectorTypeByBucket = new Map<string, string>();
  for (const s of corpSectors) {
    const key = bucketKey(s.stateId, s.sectorType);
    if (s.countryId) countryByBucket.set(key, s.countryId);
    sectorTypeByBucket.set(key, s.sectorType);
  }

  const hasNatNationalized = new Set<string>();
  const hasPrivate = new Set<string>();
  for (const s of corpSectors) {
    const key = bucketKey(s.stateId, s.sectorType);
    if (nationalCorpIds.has(s.corporationId.toString())) {
      if (s.nationalizedAtTurn != null) hasNatNationalized.add(key);
    } else {
      hasPrivate.add(key);
    }
  }

  for (const key of new Set([...stateControlled, ...hasNatNationalized])) {
    if (!hasPrivate.has(key)) continue;

    const countryId = countryByBucket.get(key);
    const sectorType = sectorTypeByBucket.get(key);
    const taking =
      countryId && sectorType
        ? enactedTakings.get(sectorTakingKey(countryId, sectorType))
        : undefined;

    if (enactedLawAllowsCorpMerge(taking)) {
      if (stateControlled.has(key) || hasNatNationalized.has(key)) merge.add(key);
      continue;
    }

    // No sector-wide corp authority on record — only merge when state holds majority.
    if (!taking && stateControlled.has(key)) merge.add(key);
  }

  return merge;
}

/** Union of bill-nationalized buckets and nat-corp sole-owner captures. */
export function computeSeedProtectedBuckets(
  corpSectors: Pick<
    CorporateSector,
    "stateId" | "sectorType" | "revenue" | "corporationId" | "nationalizedAtTurn"
  >[],
  nationalCorpIds: ReadonlySet<string>
): Set<string> {
  const protectedBuckets = computeStateControlledBuckets(corpSectors, nationalCorpIds);
  for (const key of computeNatCorpSoleOwnerBuckets(corpSectors, nationalCorpIds)) {
    protectedBuckets.add(key);
  }
  return protectedBuckets;
}

type CorpSectorBucketFields = Pick<
  CorporateSector,
  "stateId" | "sectorType" | "countryId" | "revenue" | "corporationId" | "nationalizedAtTurn"
>;

async function loadCorpSectorBucketFields(db: Db): Promise<CorpSectorBucketFields[]> {
  return db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {},
      {
        projection: {
          stateId: 1,
          sectorType: 1,
          countryId: 1,
          revenue: 1,
          corporationId: 1,
          nationalizedAtTurn: 1,
        },
      }
    )
    .toArray();
}

/** Load bucket keys where unowned seeding routes to the National Corporation. */
export async function loadSeedProtectedBucketKeys(db: Db): Promise<Set<string>> {
  const [corpSectors, nationalCorpIds] = await Promise.all([
    loadCorpSectorBucketFields(db),
    loadNationalCorpIds(db),
  ]);
  return computeSeedProtectedBuckets(corpSectors, nationalCorpIds);
}

/**
 * `(stateId, sectorType)` pairs whose persisted unowned docs are erroneous —
 * the national corp fully controls the corporate market (sole owner or bill
 * nationalization). Used by the admin heal path after mistaken unowned seeding.
 */
export function computeErroneousUnownedBuckets(
  corpSectors: Pick<
    CorporateSector,
    "stateId" | "sectorType" | "revenue" | "corporationId" | "nationalizedAtTurn"
  >[],
  nationalCorpIds: ReadonlySet<string>
): Set<string> {
  return computeSeedProtectedBuckets(corpSectors, nationalCorpIds);
}

type OwnedSectorMergeFields = Pick<
  CorporateSector,
  | "_id"
  | "stateId"
  | "sectorType"
  | "countryId"
  | "revenue"
  | "workers"
  | "currentGrowthCost"
  | "corporationId"
>;

async function loadOwnedSectorMergeFields(db: Db): Promise<OwnedSectorMergeFields[]> {
  return db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {},
      {
        projection: {
          _id: 1,
          stateId: 1,
          sectorType: 1,
          countryId: 1,
          revenue: 1,
          workers: 1,
          currentGrowthCost: 1,
          corporationId: 1,
        },
      }
    )
    .toArray();
}

export interface HealCapturedMarketsResult {
  dryRun: boolean;
  unownedAbsorbedCount: number;
  unownedRevenueTransferred: number;
  ownedSectorsMergedCount: number;
  ownedRevenueMerged: number;
  sampleKeys: string[];
}

/** Fix captured markets: absorb erroneous unowned pools and merge intruder corp sectors. */
export async function healCapturedMarkets(
  db: Db,
  opts: { dryRun?: boolean } = {}
): Promise<HealCapturedMarketsResult> {
  const dryRun = opts.dryRun ?? false;
  const nationalCorpIds = await loadNationalCorpIds(db);
  const [corpSectors, enactedTakings, unownedSectors, ownedSectors] = await Promise.all([
    loadCorpSectorBucketFields(db),
    loadSectorWideTakingAuthority(db, nationalCorpIds),
    db
      .collection<UnownedSector>("unownedSectors")
      .find({}, { projection: { _id: 1, stateId: 1, sectorType: 1, countryId: 1, revenue: 1 } })
      .toArray(),
    loadOwnedSectorMergeFields(db),
  ]);

  const protectedBuckets = computeErroneousUnownedBuckets(corpSectors, nationalCorpIds);
  const mergeBuckets = computeCapturedMarketMergeBuckets(
    corpSectors,
    nationalCorpIds,
    enactedTakings
  );

  const toAbsorbUnowned = unownedSectors.filter((u) =>
    protectedBuckets.has(bucketKey(u.stateId, u.sectorType))
  );
  const toMergeOwned = ownedSectors.filter(
    (s) =>
      mergeBuckets.has(bucketKey(s.stateId, s.sectorType)) &&
      !nationalCorpIds.has(s.corporationId.toString())
  );

  let unownedRevenueTransferred = 0;
  let ownedRevenueMerged = 0;

  if (!dryRun) {
    for (const doc of toAbsorbUnowned) {
      unownedRevenueTransferred += await absorbUnownedDocIntoNatCorp(db, doc);
    }
    for (const sector of toMergeOwned) {
      ownedRevenueMerged += await absorbOwnedSectorIntoNatCorp(db, sector);
    }
  } else {
    unownedRevenueTransferred = toAbsorbUnowned.reduce(
      (sum, u) => sum + Math.max(0, Math.round(u.revenue ?? 0)),
      0
    );
    ownedRevenueMerged = toMergeOwned.reduce(
      (sum, s) => sum + Math.max(0, Math.round(s.revenue ?? 0)),
      0
    );
  }

  const sampleKeys = [
    ...toAbsorbUnowned.map((u) => bucketKey(u.stateId, u.sectorType)),
    ...toMergeOwned.map((s) => bucketKey(s.stateId, s.sectorType)),
  ].slice(0, 12);

  return {
    dryRun,
    unownedAbsorbedCount: toAbsorbUnowned.length,
    unownedRevenueTransferred,
    ownedSectorsMergedCount: toMergeOwned.length,
    ownedRevenueMerged,
    sampleKeys,
  };
}

/** @deprecated Use healCapturedMarkets */
export async function healErroneousUnownedSectors(db: Db, opts: { dryRun?: boolean } = {}) {
  const result = await healCapturedMarkets(db, opts);
  return {
    dryRun: result.dryRun,
    absorbedCount: result.unownedAbsorbedCount,
    revenueTransferred: result.unownedRevenueTransferred,
    sampleKeys: result.sampleKeys,
  };
}
