import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  IndexFund,
  IndexFundPosition,
  IndexFundTransaction,
  IndexFundRedemptionQueueEntry,
  IndexFundSnapshot,
  IndexFundHolding,
} from "@/lib/db/types";
import { isDuplicateKeyError } from "@/lib/api/errors";

// ── Collection names ──────────────────────────────────────────────────

export const FUND_COLLECTION = "indexFunds";
export const FUND_POSITION_COLLECTION = "indexFundPositions";
export const FUND_TRANSACTION_COLLECTION = "indexFundTransactions";
export const FUND_REDEMPTION_QUEUE_COLLECTION = "indexFundRedemptionQueue";
export const FUND_SNAPSHOT_COLLECTION = "indexFundSnapshots";

type FundQueryOptions = { session?: ClientSession };

function mongoOptions(options?: FundQueryOptions): { session: ClientSession } | undefined {
  return options?.session ? { session: options.session } : undefined;
}

// ── Fund definition queries ───────────────────────────────────────────

/** Load a single fund by _id. Returns null if not found. */
export async function getFundById(
  db: Db,
  fundId: ObjectId,
  options?: FundQueryOptions
): Promise<IndexFund | null> {
  return db.collection<IndexFund>(FUND_COLLECTION).findOne({ _id: fundId }, mongoOptions(options));
}

/** Batch-load funds by _id. Preferred over per-element `getFundById` in loops. */
export async function listFundsByIds(
  db: Db,
  fundIds: ObjectId[],
  options?: FundQueryOptions
): Promise<IndexFund[]> {
  if (fundIds.length === 0) return [];
  return db
    .collection<IndexFund>(FUND_COLLECTION)
    .find({ _id: { $in: fundIds } }, mongoOptions(options))
    .toArray();
}

/** Load a single fund by slug. Returns null if not found. */
export async function getFundBySlug(
  db: Db,
  slug: string,
  options?: FundQueryOptions
): Promise<IndexFund | null> {
  return db.collection<IndexFund>(FUND_COLLECTION).findOne({ slug }, mongoOptions(options));
}

/** Resolve a fund from a URL segment (slug, or legacy Mongo _id). */
export async function resolveFundBySlugOrId(
  db: Db,
  slugOrId: string,
  options?: FundQueryOptions
): Promise<IndexFund | null> {
  const bySlug = await getFundBySlug(db, slugOrId, options);
  if (bySlug) return bySlug;
  if (ObjectId.isValid(slugOrId) && slugOrId.length === 24) {
    return getFundById(db, new ObjectId(slugOrId), options);
  }
  return null;
}

/** Load all active funds, optionally filtered by scope/kind/country. */
export async function listFunds(
  db: Db,
  filter?: {
    status?: IndexFund["status"];
    scope?: IndexFund["scope"];
    kind?: IndexFund["kind"];
    countryId?: IndexFund["countryId"];
    sectorType?: IndexFund["sectorType"];
  }
): Promise<IndexFund[]> {
  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.scope) query.scope = filter.scope;
  if (filter?.kind) query.kind = filter.kind;
  if (filter?.countryId) query.countryId = filter.countryId;
  if (filter?.sectorType) query.sectorType = filter.sectorType;
  return db
    .collection<IndexFund>(FUND_COLLECTION)
    .find(query)
    .sort({ scope: 1, kind: 1, countryId: 1, sectorType: 1 })
    .toArray();
}

/** Load all active (non-paused/delisted) funds for listing on the player UI. */
export async function listActiveFunds(db: Db): Promise<IndexFund[]> {
  return listFunds(db, { status: "active" });
}

/**
 * Funds a corporation sponsors, newest first, excluding delisted. Powers the
 * owner-facing "funds this corp sponsors" surface — there was previously no way
 * to list a corp's own funds after the session that chartered them (ticket 1088).
 */
export async function listFundsBySponsor(
  db: Db,
  sponsorCorporationId: ObjectId
): Promise<IndexFund[]> {
  return db
    .collection<IndexFund>(FUND_COLLECTION)
    .find({ sponsorCorporationId, status: { $ne: "delisted" } })
    .sort({ createdAt: -1 })
    .toArray();
}

// ── Fund upsert / update ──────────────────────────────────────────────

/** Insert a new fund definition. Returns the inserted _id. */
export async function insertFund(db: Db, fund: Omit<IndexFund, "_id">): Promise<ObjectId> {
  const result = await db.collection<IndexFund>(FUND_COLLECTION).insertOne(fund as IndexFund);
  return result.insertedId;
}

/**
 * Update target constituents and rebalance metadata for a fund.
 * Called on the financial-day cadence when recomputing weights (Pass 2).
 */
export async function updateFundConstituents(
  db: Db,
  fundId: ObjectId,
  targetConstituents: IndexFund["targetConstituents"],
  lastRebalancedAt: Date,
  /**
   * A7 listing-failure streaks. Written on every rebalance, including as an
   * empty array: the list is the whole current picture, so anything not in it
   * has stopped failing and must not keep an old count.
   */
  listingFailureStreaks?: IndexFund["listingFailureStreaks"]
): Promise<void> {
  await db.collection<IndexFund>(FUND_COLLECTION).updateOne(
    { _id: fundId },
    {
      $set: {
        targetConstituents,
        lastRebalancedAt,
        ...(listingFailureStreaks ? { listingFailureStreaks } : {}),
        updatedAt: new Date(),
      },
    }
  );
}

/** Update fund NAV and backing ratio. */
export async function updateFundNav(
  db: Db,
  fundId: ObjectId,
  update: {
    quotedNav: number;
    backingRatio?: number;
    unitSupply?: number;
    cashAnchor?: number;
  }
): Promise<void> {
  const $set: Record<string, unknown> = {
    quotedNav: update.quotedNav,
    updatedAt: new Date(),
  };
  if (update.backingRatio !== undefined) $set.backingRatio = update.backingRatio;
  if (update.unitSupply !== undefined) $set.unitSupply = update.unitSupply;
  if (update.cashAnchor !== undefined) $set.cashAnchor = update.cashAnchor;

  await db.collection<IndexFund>(FUND_COLLECTION).updateOne({ _id: fundId }, { $set });
}

/**
 * Update a fund's holdings array (actual share positions).
 * Typically called after public-float absorption buys or redemption sells.
 *
 * Deliberately does NOT write `cashAnchor`: cash must only move via atomic
 * `$inc` deltas. A `$set` from a value read earlier in the cycle erases any
 * concurrent subscription credit while its minted units survive, permanently
 * diluting NAV.
 */
export async function updateFundHoldings(
  db: Db,
  fundId: ObjectId,
  holdings: IndexFundHolding[],
  options?: FundQueryOptions
): Promise<void> {
  await db.collection<IndexFund>(FUND_COLLECTION).updateOne(
    { _id: fundId },
    {
      $set: {
        holdings,
        updatedAt: new Date(),
      },
    },
    mongoOptions(options)
  );
}

/** Pause or unpause a fund, with optional reason. */
export async function setFundStatus(
  db: Db,
  fundId: ObjectId,
  status: IndexFund["status"],
  reason?: IndexFund["pauseReason"],
  pausedByUserId?: ObjectId
): Promise<void> {
  const $set: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "paused") {
    $set.pauseReason = reason ?? "manual";
    $set.pausedAt = new Date();
    if (pausedByUserId) $set.pausedByUserId = pausedByUserId;
    await db.collection<IndexFund>(FUND_COLLECTION).updateOne({ _id: fundId }, { $set });
    return;
  }

  // Reactivating must REMOVE the pause fields. `$set: undefined` leaves them in
  // place on the stored document, which is why the paused-fund heal script had
  // to `$unset` them by hand after an unpause that looked like it worked.
  await db
    .collection<IndexFund>(FUND_COLLECTION)
    .updateOne(
      { _id: fundId },
      { $set, $unset: { pauseReason: "", pausedAt: "", pausedByUserId: "" } }
    );
}

// ── Position (investor holding) queries ────────────────────────────────

/** Load a single position by fund + holder identity. Returns null if not found. */
export async function getPosition(
  db: Db,
  fundId: ObjectId,
  holderKind: IndexFundPosition["holderKind"],
  filter: { characterId?: ObjectId; imperialCharacterId?: ObjectId; nppId?: ObjectId },
  options?: FundQueryOptions
): Promise<IndexFundPosition | null> {
  const query: Record<string, unknown> = { fundId, holderKind };
  if (holderKind === "character" && filter.characterId) {
    query.characterId = filter.characterId;
  } else if (holderKind === "imperial_character" && filter.imperialCharacterId) {
    query.imperialCharacterId = filter.imperialCharacterId;
  } else if (holderKind === "npp" && filter.nppId) {
    query.nppId = filter.nppId;
  } else if (holderKind === "fund_reserve") {
    // fund_reserve positions match on fundId only (no holder-specific id)
  }
  return db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .findOne(query, mongoOptions(options));
}

/** Load all positions for a given fund. */
export async function listFundPositions(
  db: Db,
  fundId: ObjectId,
  options?: FundQueryOptions
): Promise<IndexFundPosition[]> {
  return db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .find({ fundId }, mongoOptions(options))
    .toArray();
}

/** Load all positions for a given character across all funds. */
export async function listCharacterPositions(
  db: Db,
  characterId: ObjectId
): Promise<IndexFundPosition[]> {
  return db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .find({ holderKind: "character", characterId })
    .toArray();
}

/** Load all positions for an imperial character across all funds. */
export async function listImperialCharacterPositions(
  db: Db,
  imperialCharacterId: ObjectId
): Promise<IndexFundPosition[]> {
  return db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .find({ holderKind: "imperial_character", imperialCharacterId })
    .toArray();
}

/**
 * Atomically credit fund units to a holder position.
 * Creates the position via $push if it doesn't exist.
 * Returns the updated position.
 */
export async function creditFundPosition(
  db: Db,
  fundId: ObjectId,
  holderKind: IndexFundPosition["holderKind"],
  holderFilter: {
    characterId?: ObjectId;
    imperialCharacterId?: ObjectId;
    nppId?: ObjectId;
    pensionSchemeId?: ObjectId;
  },
  units: number,
  nav: number,
  options?: FundQueryOptions
): Promise<IndexFundPosition> {
  const now = new Date();
  const identityFields: Record<string, unknown> = { holderKind };
  if (holderFilter.characterId) identityFields.characterId = holderFilter.characterId;
  if (holderFilter.imperialCharacterId)
    identityFields.imperialCharacterId = holderFilter.imperialCharacterId;
  if (holderFilter.nppId) identityFields.nppId = holderFilter.nppId;
  if (holderFilter.pensionSchemeId) identityFields.pensionSchemeId = holderFilter.pensionSchemeId;

  // Try to increment an existing position.
  const incResult = await db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .findOneAndUpdate(
      { fundId, ...identityFields },
      [
        {
          $set: {
            avgNavAnchor: {
              $cond: [
                { $gt: [{ $add: ["$units", units] }, 0] },
                {
                  $divide: [
                    {
                      $add: [
                        { $multiply: ["$units", { $ifNull: ["$avgNavAnchor", nav] }] },
                        units * nav,
                      ],
                    },
                    { $add: ["$units", units] },
                  ],
                },
                nav,
              ],
            },
            units: { $add: ["$units", units] },
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after", ...mongoOptions(options) }
    );

  if (incResult) return incResult;

  // Position doesn't exist — create it. New positions are post-#857-fix, so
  // none of their units are legacy (they were charged the correct × rate cost).
  const newPosition: Omit<IndexFundPosition, "_id"> = {
    fundId,
    holderKind,
    ...identityFields,
    units,
    avgNavAnchor: nav,
    legacyUnits: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const insertResult = await db
      .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
      .insertOne(newPosition as IndexFundPosition, mongoOptions(options));

    return { ...newPosition, _id: insertResult.insertedId } as IndexFundPosition;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Another request won the race — retry the increment.
      const retry = await db
        .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
        .findOneAndUpdate(
          { fundId, ...identityFields },
          [
            {
              $set: {
                avgNavAnchor: {
                  $cond: [
                    { $gt: [{ $add: ["$units", units] }, 0] },
                    {
                      $divide: [
                        {
                          $add: [
                            { $multiply: ["$units", { $ifNull: ["$avgNavAnchor", nav] }] },
                            units * nav,
                          ],
                        },
                        { $add: ["$units", units] },
                      ],
                    },
                    nav,
                  ],
                },
                units: { $add: ["$units", units] },
                updatedAt: now,
              },
            },
          ],
          { returnDocument: "after", ...mongoOptions(options) }
        );
      if (retry) return retry;
    }
    throw err;
  }
}

/**
 * Merge shares into a fund's `holdings` ledger (weighted-average cost), used
 * when a fund receives shares outside the normal absorption path (e.g. an
 * in-kind distribution from a dissolving corporation). Non-constituent
 * holdings acquired this way are liquidated by the next rebalance sweep.
 */
export async function upsertFundHoldingShares(
  db: Db,
  fundId: ObjectId,
  corporationId: ObjectId,
  shares: number,
  pricePerShareAnchor: number,
  options?: FundQueryOptions
): Promise<void> {
  if (!Number.isFinite(shares) || shares <= 0) return;
  const safePrice = Number.isFinite(pricePerShareAnchor) ? Math.max(0, pricePerShareAnchor) : 0;

  const fund = await db
    .collection<IndexFund>(FUND_COLLECTION)
    .findOne({ _id: fundId }, { projection: { holdings: 1 }, ...mongoOptions(options) });
  const existing = fund?.holdings?.find(
    (h) => h.corporationId.toString() === corporationId.toString()
  );

  if (existing) {
    const newShares = existing.shares + shares;
    const newAvg =
      existing.avgCostPerShareAnchor !== undefined
        ? (existing.shares * existing.avgCostPerShareAnchor + shares * safePrice) / newShares
        : safePrice;
    await db.collection<IndexFund>(FUND_COLLECTION).updateOne(
      { _id: fundId, "holdings.corporationId": corporationId },
      {
        $inc: { "holdings.$.shares": shares },
        $set: {
          "holdings.$.avgCostPerShareAnchor": newAvg,
          "holdings.$.lastValueAnchor": newShares * safePrice,
          updatedAt: new Date(),
        },
      },
      mongoOptions(options)
    );
    return;
  }

  await db.collection<IndexFund>(FUND_COLLECTION).updateOne(
    { _id: fundId },
    {
      $push: {
        holdings: {
          corporationId,
          shares,
          avgCostPerShareAnchor: safePrice,
          lastValueAnchor: shares * safePrice,
        } satisfies IndexFundHolding,
      },
      $set: { updatedAt: new Date() },
    },
    mongoOptions(options)
  );
}

/**
 * Atomically remove shares from a fund's holdings ledger. Returns false when
 * the live holding cannot cover the requested fill, leaving the document
 * unchanged. The corporation cap-table debit is handled separately by the
 * settlement caller and must be rolled back if either guarded leg fails.
 */
export async function debitFundHoldingShares(
  db: Db,
  fundId: ObjectId,
  corporationId: ObjectId,
  shares: number,
  pricePerShareAnchor: number,
  options?: FundQueryOptions
): Promise<boolean> {
  if (!Number.isFinite(shares) || shares <= 0) return false;
  const safePrice = Number.isFinite(pricePerShareAnchor) ? Math.max(0, pricePerShareAnchor) : 0;
  const result = await db.collection<IndexFund>(FUND_COLLECTION).updateOne(
    {
      _id: fundId,
      holdings: { $elemMatch: { corporationId, shares: { $gte: shares } } },
    },
    {
      $inc: { "holdings.$.shares": -shares },
      $set: {
        "holdings.$.lastValueAnchor": 0,
        updatedAt: new Date(),
      },
    },
    mongoOptions(options)
  );
  if (result.matchedCount === 0) return false;

  const holding = await db
    .collection<IndexFund>(FUND_COLLECTION)
    .findOne(
      { _id: fundId, "holdings.corporationId": corporationId },
      { projection: { holdings: 1 }, ...mongoOptions(options) }
    );
  const remaining = holding?.holdings.find(
    (row) => row.corporationId.toString() === corporationId.toString()
  );
  if (!remaining || remaining.shares <= 0) {
    await db.collection<IndexFund>(FUND_COLLECTION).updateOne(
      { _id: fundId },
      {
        $pull: {
          holdings: { corporationId: { $eq: corporationId }, shares: { $lte: 0 } },
        },
      },
      mongoOptions(options)
    );
  } else {
    await db
      .collection<IndexFund>(FUND_COLLECTION)
      .updateOne(
        { _id: fundId, "holdings.corporationId": corporationId },
        { $set: { "holdings.$.lastValueAnchor": remaining.shares * safePrice } },
        mongoOptions(options)
      );
  }
  return true;
}

export type DebitFundPositionResult =
  { ok: true; position: IndexFundPosition | null; legacyUnitsRedeemed: number } | { ok: false };

/**
 * Atomically debit fund units from a holder position.
 * Removes the position document if units drop to zero.
 * Returns `{ ok: false }` when the holder has no position with at least
 * `units` units (guard failed — e.g. a concurrent debit drained it).
 * Callers MUST check `ok` before paying out against the debit.
 * On success, `position` is the updated position (null if removed at zero).
 */
export async function debitFundPosition(
  db: Db,
  fundId: ObjectId,
  holderKind: IndexFundPosition["holderKind"],
  holderFilter: { characterId?: ObjectId; imperialCharacterId?: ObjectId; nppId?: ObjectId },
  units: number,
  options?: FundQueryOptions
): Promise<DebitFundPositionResult> {
  const identityFields: Record<string, unknown> = { fundId, holderKind };
  if (holderFilter.characterId) identityFields.characterId = holderFilter.characterId;
  if (holderFilter.imperialCharacterId)
    identityFields.imperialCharacterId = holderFilter.imperialCharacterId;
  if (holderFilter.nppId) identityFields.nppId = holderFilter.nppId;

  // Single atomic debit. We request the PRE-image so `legacyUnitsRedeemed` is
  // derived from the exact document the update acted on — no separate read that
  // could race the update on a non-transactional (standalone-Mongo) path. The
  // pipeline drains legacy units first; absent legacyUnits defaults to the full
  // position (conservative: all legacy, never over-pays) — see the type.
  const now = new Date();
  const before = await db.collection<IndexFundPosition>(FUND_POSITION_COLLECTION).findOneAndUpdate(
    { ...identityFields, units: { $gte: units } },
    [
      {
        $set: {
          units: { $subtract: ["$units", units] },
          legacyUnits: {
            $max: [0, { $subtract: [{ $ifNull: ["$legacyUnits", "$units"] }, units] }],
          },
          updatedAt: now,
        },
      },
    ],
    { returnDocument: "before", ...mongoOptions(options) }
  );

  if (!before) return { ok: false };

  const legacyBefore = before.legacyUnits ?? before.units;
  const legacyUnitsRedeemed = Math.min(units, Math.max(0, legacyBefore));
  const unitsAfter = before.units - units;

  // If position reached zero, remove the document.
  if (unitsAfter <= 0) {
    await db
      .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
      .deleteOne({ _id: before._id }, mongoOptions(options));
    return { ok: true, position: null, legacyUnitsRedeemed };
  }

  // Reconstruct the post-debit document (the update already committed it).
  const position: IndexFundPosition = {
    ...before,
    units: unitsAfter,
    legacyUnits: Math.max(0, legacyBefore - units),
    updatedAt: now,
  };
  return { ok: true, position, legacyUnitsRedeemed };
}

// ── Transaction logging ───────────────────────────────────────────────

/** Insert a fund transaction record (immutable audit log). */
export async function insertFundTransaction(
  db: Db,
  tx: Omit<IndexFundTransaction, "_id">,
  options?: FundQueryOptions
): Promise<ObjectId> {
  const result = await db
    .collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION)
    .insertOne(tx as IndexFundTransaction, mongoOptions(options));
  return result.insertedId;
}

/**
 * Bulk-insert fund transactions in one round-trip. Same doc shape as
 * insertFundTransaction; used by the batched dividend pass-through to collapse
 * ~2 inserts × N accruals into a single insertMany.
 */
export async function insertFundTransactionsBulk(
  db: Db,
  txs: Omit<IndexFundTransaction, "_id">[],
  options?: FundQueryOptions
): Promise<void> {
  if (txs.length === 0) return;
  await db
    .collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION)
    .insertMany(txs as IndexFundTransaction[], mongoOptions(options));
}

/** Load recent transactions for a fund, ordered by creation time descending. */
export async function listFundTransactions(
  db: Db,
  fundId: ObjectId,
  limit = 50
): Promise<IndexFundTransaction[]> {
  return db
    .collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION)
    .find({ fundId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** Load transactions for a specific character across all funds. */
export async function listCharacterFundTransactions(
  db: Db,
  characterId: ObjectId,
  limit = 50
): Promise<IndexFundTransaction[]> {
  return db
    .collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION)
    .find({ characterId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

// ── Redemption queue ──────────────────────────────────────────────────

/** Add a redemption to the queue. */
export async function enqueueRedemption(
  db: Db,
  entry: Omit<IndexFundRedemptionQueueEntry, "_id">,
  options?: FundQueryOptions
): Promise<ObjectId> {
  const result = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .insertOne(entry as IndexFundRedemptionQueueEntry, mongoOptions(options));
  return result.insertedId;
}

/** Load pending queued redemptions for a fund, oldest first. */
export async function listPendingRedemptions(
  db: Db,
  fundId: ObjectId
): Promise<IndexFundRedemptionQueueEntry[]> {
  return db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .find({ fundId, status: { $in: ["queued", "partial"] } })
    .sort({ createdAt: 1 })
    .toArray();
}

/** Update a queue entry after a payout attempt. */
export async function updateRedemptionEntry(
  db: Db,
  entryId: ObjectId,
  update: Partial<
    Pick<
      IndexFundRedemptionQueueEntry,
      "status" | "paidAmountAnchor" | "units" | "requestedAmountAnchor"
    >
  >,
  options?: FundQueryOptions
): Promise<void> {
  await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .updateOne(
      { _id: entryId },
      { $set: { ...update, updatedAt: new Date() } },
      mongoOptions(options)
    );
}

// ── NAV snapshots ─────────────────────────────────────────────────────

/** Record a per-turn NAV snapshot (idempotent on fundId + turn). */
export async function insertFundSnapshot(
  db: Db,
  snapshot: Omit<IndexFundSnapshot, "_id">
): Promise<void> {
  await db.collection<IndexFundSnapshot>(FUND_SNAPSHOT_COLLECTION).updateOne(
    { fundId: snapshot.fundId, turn: snapshot.turn },
    {
      $set: {
        ...snapshot,
        createdAt: snapshot.createdAt,
      },
    },
    { upsert: true }
  );
}

/** Load snapshots for a fund, newest first. */
export async function listFundSnapshots(
  db: Db,
  fundId: ObjectId,
  limit = 30
): Promise<IndexFundSnapshot[]> {
  return db
    .collection<IndexFundSnapshot>(FUND_SNAPSHOT_COLLECTION)
    .find({ fundId })
    .sort({ turn: -1 })
    .limit(limit)
    .toArray();
}

/** Load the most recent snapshot for a fund. Returns null if none. */
export async function getLatestFundSnapshot(
  db: Db,
  fundId: ObjectId
): Promise<IndexFundSnapshot | null> {
  return db
    .collection<IndexFundSnapshot>(FUND_SNAPSHOT_COLLECTION)
    .findOne({ fundId }, { sort: { turn: -1 } });
}

/** Recent snapshots for many funds (newest-first per fund). */
export async function listSnapshotsForFunds(
  db: Db,
  fundIds: ObjectId[],
  limitPerFund = 50
): Promise<Map<string, IndexFundSnapshot[]>> {
  const result = new Map<string, IndexFundSnapshot[]>();
  if (fundIds.length === 0) return result;

  const rows = await db
    .collection<IndexFundSnapshot>(FUND_SNAPSHOT_COLLECTION)
    .aggregate<{ _id: ObjectId; snapshots: IndexFundSnapshot[] }>([
      { $match: { fundId: { $in: fundIds } } },
      { $sort: { turn: -1 } },
      {
        $group: {
          _id: "$fundId",
          snapshots: { $push: "$$ROOT" },
        },
      },
      {
        $project: {
          snapshots: { $slice: ["$snapshots", limitPerFund] },
        },
      },
    ])
    .toArray();

  for (const row of rows) {
    result.set(row._id.toString(), row.snapshots);
  }
  return result;
}
