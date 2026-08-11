import type { ClientSession, Db, UpdateFilter } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";

/**
 * Atomic shareholder operations.
 *
 * Every helper uses MongoDB's positional operator (`$`) or `$push` / `$pull`
 * so that concurrent share operations on different shareholders never
 * clobber each other (no more read-modify-write on the entire array).
 */

const CORP = "corporations";

function mongoOptions(opts?: { session?: ClientSession }): { session: ClientSession } | undefined {
  return opts?.session ? { session: opts.session } : undefined;
}

export type CreditSharesOpts = {
  /**
   * ₳ anchor price per share for this credit (purchase / trade fill).
   * When set, updates weighted-average `avgCostPerShare` so portfolio unrealized P&L works.
   */
  pricePerShare?: number;
  /**
   * Additional corporation-level filter that must still match when the credit
   * is applied, e.g. `publicFloat: { $gte: shares }` for purchases from the
   * public float.
   */
  guardFilter?: Record<string, unknown>;
  session?: ClientSession;
};

function isGuardedCredit(opts?: CreditSharesOpts | Pick<CreditSharesOpts, "guardFilter">): boolean {
  return Object.keys(opts?.guardFilter ?? {}).length > 0;
}

export type DebitSharesOpts = {
  /**
   * When true, the debit only matches holders that still have at least
   * `shares` available. Returns `-1` instead of mutating the position when a
   * concurrent sell/fill already consumed the inventory.
   */
  requireSufficient?: boolean;
  session?: ClientSession;
};

type ShareholderExtraUpdate = {
  $inc?: Record<string, number>;
  $set?: Record<string, unknown>;
  $unset?: Record<string, "" | 1 | true>;
};

// ── Add / credit shares ────────────────────────────────────────────

/**
 * Atomically credit `shares` to a character's shareholder entry.
 * Creates the entry via `$push` if one does not already exist.
 *
 * `extraUpdate` is merged into the `updateOne` operation so callers can
 * piggy-back `$inc` / `$set` changes (e.g. publicFloat)
 * in a single round-trip.
 *
 * When `opts.pricePerShare` is set, blends into `avgCostPerShare` (same rules as
 * `creditSharesToCorp`). Omit for legacy callers that do not track basis here.
 */
export async function creditShares(
  db: Db,
  corporationId: ObjectId,
  characterId: ObjectId,
  shares: number,
  extraUpdate?: { $inc?: Record<string, number>; $set?: Record<string, unknown> },
  opts?: CreditSharesOpts
): Promise<boolean> {
  const price = opts?.pricePerShare;
  const guardFilter = opts?.guardFilter ?? {};
  let newAvg: number | undefined;
  if (price !== undefined) {
    const targetCorp = await db
      .collection<Corporation>(CORP)
      .findOne({ _id: corporationId }, { projection: { shareholders: 1 } });
    const existing = targetCorp?.shareholders?.find(
      (sh) => sh.characterId?.toString() === characterId.toString()
    );
    const existingShares = existing?.shares ?? 0;
    const oldAvg = existing?.avgCostPerShare ?? price;
    newAvg =
      existingShares > 0
        ? (existingShares * oldAvg + shares * price) / (existingShares + shares)
        : price;
  }

  const setPayload =
    newAvg !== undefined
      ? {
          ...(extraUpdate?.$set ?? {}),
          "shareholders.$.avgCostPerShare": newAvg,
        }
      : extraUpdate?.$set;

  // Try to increment an existing entry first (atomic positional update).
  const incResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: corporationId, ...guardFilter, "shareholders.characterId": characterId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      ...(setPayload ? { $set: setPayload } : {}),
    }
  );

  if (incResult.matchedCount > 0) return true;

  const pushed: { characterId: ObjectId; shares: number; avgCostPerShare?: number } = {
    characterId,
    shares,
  };
  if (price !== undefined) {
    pushed.avgCostPerShare = price;
  }

  const pushResult = await db.collection<Corporation>(CORP).updateOne(
    {
      _id: corporationId,
      ...guardFilter,
      shareholders: {
        $not: { $elemMatch: { characterId } },
      },
    },
    {
      $push: { shareholders: pushed } as unknown as UpdateFilter<Corporation>,
      ...(extraUpdate?.$inc ? { $inc: extraUpdate.$inc } : {}),
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
    }
  );

  if (pushResult.matchedCount > 0) return true;

  const retryCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: corporationId }, { projection: { shareholders: 1 } });
  const retryExisting = retryCorp?.shareholders?.find(
    (sh) => sh.characterId?.toString() === characterId.toString()
  );
  if (!retryExisting) return false;
  const retryAvg =
    price !== undefined
      ? (retryExisting.shares * (retryExisting.avgCostPerShare ?? price) + shares * price) /
        (retryExisting.shares + shares)
      : undefined;
  const retrySetPayload =
    retryAvg !== undefined
      ? {
          ...(extraUpdate?.$set ?? {}),
          "shareholders.$.avgCostPerShare": retryAvg,
        }
      : extraUpdate?.$set;
  const retryResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: corporationId, ...guardFilter, "shareholders.characterId": characterId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      ...(retrySetPayload ? { $set: retrySetPayload } : {}),
    }
  );

  if (retryResult.matchedCount > 0) return true;
  if (isGuardedCredit(opts)) return false;
  throw new Error("Failed to credit character shares after retry");
}

// ── Add / credit shares (imperial character) ─────────────────────

/**
 * Atomically credit `shares` to an imperial character's shareholder entry.
 * Same as creditShares but uses imperialCharacterId field.
 */
export async function creditSharesToImperial(
  db: Db,
  corporationId: ObjectId,
  imperialCharacterId: ObjectId,
  shares: number,
  extraUpdate?: { $inc?: Record<string, number>; $set?: Record<string, unknown> },
  opts?: CreditSharesOpts
): Promise<boolean> {
  const price = opts?.pricePerShare;
  const guardFilter = opts?.guardFilter ?? {};
  let newAvg: number | undefined;
  if (price !== undefined) {
    const targetCorp = await db
      .collection<Corporation>(CORP)
      .findOne({ _id: corporationId }, { projection: { shareholders: 1 } });
    const existing = targetCorp?.shareholders?.find(
      (sh) => sh.imperialCharacterId?.toString() === imperialCharacterId.toString()
    );
    const existingShares = existing?.shares ?? 0;
    const oldAvg = existing?.avgCostPerShare ?? price;
    newAvg =
      existingShares > 0
        ? (existingShares * oldAvg + shares * price) / (existingShares + shares)
        : price;
  }

  const setPayload =
    newAvg !== undefined
      ? {
          ...(extraUpdate?.$set ?? {}),
          "shareholders.$.avgCostPerShare": newAvg,
        }
      : extraUpdate?.$set;

  const incResult = await db.collection<Corporation>(CORP).updateOne(
    {
      _id: corporationId,
      ...guardFilter,
      "shareholders.imperialCharacterId": imperialCharacterId,
    },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      ...(setPayload ? { $set: setPayload } : {}),
    }
  );

  if (incResult.matchedCount > 0) return true;

  const pushed: {
    imperialCharacterId: ObjectId;
    shares: number;
    avgCostPerShare?: number;
  } = { imperialCharacterId, shares };
  if (price !== undefined) {
    pushed.avgCostPerShare = price;
  }

  const pushResult = await db.collection<Corporation>(CORP).updateOne(
    {
      _id: corporationId,
      ...guardFilter,
      shareholders: {
        $not: { $elemMatch: { imperialCharacterId } },
      },
    },
    {
      $push: { shareholders: pushed } as unknown as UpdateFilter<Corporation>,
      ...(extraUpdate?.$inc ? { $inc: extraUpdate.$inc } : {}),
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
    }
  );

  if (pushResult.matchedCount > 0) return true;

  const retryCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: corporationId }, { projection: { shareholders: 1 } });
  const retryExisting = retryCorp?.shareholders?.find(
    (sh) => sh.imperialCharacterId?.toString() === imperialCharacterId.toString()
  );
  if (!retryExisting) return false;
  const retryAvg =
    price !== undefined
      ? (retryExisting.shares * (retryExisting.avgCostPerShare ?? price) + shares * price) /
        (retryExisting.shares + shares)
      : undefined;
  const retrySetPayload =
    retryAvg !== undefined
      ? {
          ...(extraUpdate?.$set ?? {}),
          "shareholders.$.avgCostPerShare": retryAvg,
        }
      : extraUpdate?.$set;
  const retryResult = await db.collection<Corporation>(CORP).updateOne(
    {
      _id: corporationId,
      ...guardFilter,
      "shareholders.imperialCharacterId": imperialCharacterId,
    },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      ...(retrySetPayload ? { $set: retrySetPayload } : {}),
    }
  );

  if (retryResult.matchedCount > 0) return true;
  if (isGuardedCredit(opts)) return false;
  throw new Error("Failed to credit imperial shares after retry");
}

// ── Debit / remove shares ──────────────────────────────────────────

/**
 * Atomically debit `shares` from a character's shareholder entry.
 * If the resulting balance is ≤ 0 the entry is removed via `$pull`.
 *
 * Returns the new share count (0 means entry was removed).
 */
export async function debitShares(
  db: Db,
  corporationId: ObjectId,
  characterId: ObjectId,
  shares: number,
  extraUpdate?: ShareholderExtraUpdate,
  opts?: DebitSharesOpts
): Promise<number> {
  // Decrement atomically.
  const filter = opts?.requireSufficient
    ? {
        _id: corporationId,
        shareholders: { $elemMatch: { characterId, shares: { $gte: shares } } },
      }
    : { _id: corporationId, "shareholders.characterId": characterId };
  const result = await db.collection<Corporation>(CORP).findOneAndUpdate(
    filter,
    {
      $inc: { "shareholders.$.shares": -shares, ...extraUpdate?.$inc },
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
      ...(extraUpdate?.$unset ? { $unset: extraUpdate.$unset } : {}),
    },
    { returnDocument: "after", ...mongoOptions(opts) }
  );

  if (!result) return opts?.requireSufficient ? -1 : 0;

  const entry = result.shareholders?.find(
    (sh) => sh.characterId?.toString() === characterId.toString()
  );
  const remaining = entry?.shares ?? 0;

  // Clean up zero/negative entries.
  if (remaining <= 0) {
    const pullUpdate = {
      $pull: { shareholders: { characterId } } as unknown as UpdateFilter<Corporation>,
    };
    const options = mongoOptions(opts);
    if (options) {
      await db.collection<Corporation>(CORP).updateOne({ _id: corporationId }, pullUpdate, options);
    } else {
      await db.collection<Corporation>(CORP).updateOne({ _id: corporationId }, pullUpdate);
    }
    return 0;
  }

  return remaining;
}

// ── Debit / remove shares (imperial character) ───────────────────

/**
 * Atomically debit `shares` from an imperial character's shareholder entry.
 * Same as debitShares but uses imperialCharacterId field.
 * Returns the new share count (0 means entry was removed).
 */
export async function debitSharesFromImperial(
  db: Db,
  corporationId: ObjectId,
  imperialCharacterId: ObjectId,
  shares: number,
  extraUpdate?: ShareholderExtraUpdate,
  opts?: DebitSharesOpts
): Promise<number> {
  const filter = opts?.requireSufficient
    ? {
        _id: corporationId,
        shareholders: { $elemMatch: { imperialCharacterId, shares: { $gte: shares } } },
      }
    : { _id: corporationId, "shareholders.imperialCharacterId": imperialCharacterId };
  const result = await db.collection<Corporation>(CORP).findOneAndUpdate(
    filter,
    {
      $inc: { "shareholders.$.shares": -shares, ...extraUpdate?.$inc },
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
      ...(extraUpdate?.$unset ? { $unset: extraUpdate.$unset } : {}),
    },
    { returnDocument: "after", ...mongoOptions(opts) }
  );

  if (!result) return opts?.requireSufficient ? -1 : 0;

  const entry = result.shareholders?.find(
    (sh) => sh.imperialCharacterId?.toString() === imperialCharacterId.toString()
  );
  const remaining = entry?.shares ?? 0;

  if (remaining <= 0) {
    const pullUpdate = {
      $pull: { shareholders: { imperialCharacterId } } as unknown as UpdateFilter<Corporation>,
    };
    const options = mongoOptions(opts);
    if (options) {
      await db.collection<Corporation>(CORP).updateOne({ _id: corporationId }, pullUpdate, options);
    } else {
      await db.collection<Corporation>(CORP).updateOne({ _id: corporationId }, pullUpdate);
    }
    return 0;
  }

  return remaining;
}

// ── Add / credit shares (corporation buyer) ───────────────────────

/**
 * Atomically credit `shares` to a corporation's shareholder entry in the target corp.
 * Reads existing position first to compute weighted average cost basis.
 * Creates the entry via `$push` if one does not already exist.
 *
 * `extraUpdate` is merged into the `updateOne` operation so callers can
 * piggy-back `$inc` / `$set` changes in a single round-trip.
 */
export async function creditSharesToCorp(
  db: Db,
  targetCorpId: ObjectId,
  buyerCorpId: ObjectId,
  shares: number,
  pricePerShare: number,
  extraUpdate?: { $inc?: Record<string, number>; $set?: Record<string, unknown> },
  opts?: Pick<CreditSharesOpts, "guardFilter" | "session">
): Promise<boolean> {
  const guardFilter = opts?.guardFilter ?? {};
  // Read current position to compute weighted average cost basis.
  const targetCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: targetCorpId }, { projection: { shareholders: 1 } });

  const existing = targetCorp?.shareholders?.find(
    (sh) => sh.corporationId?.toString() === buyerCorpId.toString()
  );
  const existingShares = existing?.shares ?? 0;
  const oldAvg = existing?.avgCostPerShare ?? pricePerShare;
  // Weighted average: blend old cost basis with new purchase price.
  const newAvg =
    existingShares > 0
      ? (existingShares * oldAvg + shares * pricePerShare) / (existingShares + shares)
      : pricePerShare;

  // Try to increment existing entry (atomic positional update).
  const incResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: targetCorpId, ...(guardFilter ?? {}), "shareholders.corporationId": buyerCorpId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      $set: {
        "shareholders.$.avgCostPerShare": newAvg,
        ...extraUpdate?.$set,
      },
    }
  );

  if (incResult.matchedCount > 0) return true;

  // Entry doesn't exist yet — push a new one.
  const pushResult = await db.collection<Corporation>(CORP).updateOne(
    {
      _id: targetCorpId,
      ...(guardFilter ?? {}),
      shareholders: {
        $not: { $elemMatch: { corporationId: buyerCorpId } },
      },
    },
    {
      $push: {
        shareholders: { corporationId: buyerCorpId, shares, avgCostPerShare: pricePerShare },
      } as unknown as UpdateFilter<Corporation>,
      ...(extraUpdate?.$inc ? { $inc: extraUpdate.$inc } : {}),
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
    }
  );

  if (pushResult.matchedCount > 0) return true;

  const retryCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: targetCorpId }, { projection: { shareholders: 1 } });
  const retryExisting = retryCorp?.shareholders?.find(
    (sh) => sh.corporationId?.toString() === buyerCorpId.toString()
  );
  if (!retryExisting) return false;
  const retryAvg =
    (retryExisting.shares * (retryExisting.avgCostPerShare ?? pricePerShare) +
      shares * pricePerShare) /
    (retryExisting.shares + shares);
  const retryResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: targetCorpId, ...(guardFilter ?? {}), "shareholders.corporationId": buyerCorpId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      $set: {
        "shareholders.$.avgCostPerShare": retryAvg,
        ...extraUpdate?.$set,
      },
    }
  );

  if (retryResult.matchedCount > 0) return true;
  if (isGuardedCredit(opts)) return false;
  throw new Error("Failed to credit corporation shares after retry");
}

// ── Debit / remove shares (corporation holder) ────────────────────

/**
 * Atomically debit `shares` from a corporation's shareholder entry.
 * If the resulting balance is ≤ 0 the entry is removed via `$pull`.
 *
 * Returns the new share count (0 means entry was removed).
 */
export async function debitSharesFromCorp(
  db: Db,
  targetCorpId: ObjectId,
  holderCorpId: ObjectId,
  shares: number,
  extraUpdate?: ShareholderExtraUpdate,
  opts?: DebitSharesOpts
): Promise<number> {
  // Decrement atomically.
  const filter = opts?.requireSufficient
    ? {
        _id: targetCorpId,
        shareholders: { $elemMatch: { corporationId: holderCorpId, shares: { $gte: shares } } },
      }
    : { _id: targetCorpId, "shareholders.corporationId": holderCorpId };
  const result = await db.collection<Corporation>(CORP).findOneAndUpdate(
    filter,
    {
      $inc: { "shareholders.$.shares": -shares, ...extraUpdate?.$inc },
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
      ...(extraUpdate?.$unset ? { $unset: extraUpdate.$unset } : {}),
    },
    { returnDocument: "after", ...mongoOptions(opts) }
  );

  if (!result) return opts?.requireSufficient ? -1 : 0;

  const entry = result.shareholders?.find(
    (sh) => sh.corporationId?.toString() === holderCorpId.toString()
  );
  const remaining = entry?.shares ?? 0;

  // Clean up zero/negative entries.
  if (remaining <= 0) {
    const pullUpdate = {
      $pull: {
        shareholders: { corporationId: holderCorpId },
      } as unknown as UpdateFilter<Corporation>,
    };
    const options = mongoOptions(opts);
    if (options) {
      await db.collection<Corporation>(CORP).updateOne({ _id: targetCorpId }, pullUpdate, options);
    } else {
      await db.collection<Corporation>(CORP).updateOne({ _id: targetCorpId }, pullUpdate);
    }
    return 0;
  }

  return remaining;
}

// ── Transfer shares between two characters ─────────────────────────

/**
 * Atomically transfer `shares` from one character to another.
 *
 * If the recipient already has an entry it is incremented; otherwise a
 * new entry is pushed. The sender's entry is decremented and removed
 * if it reaches zero.
 */
export async function transferShares(
  db: Db,
  corporationId: ObjectId,
  fromCharacterId: ObjectId,
  toCharacterId: ObjectId,
  shares: number,
  extraSet?: Record<string, unknown>
): Promise<void> {
  // 1. Debit sender (atomic).
  await debitShares(db, corporationId, fromCharacterId, shares, {
    $set: extraSet as Record<string, unknown> | undefined,
  });

  // 2. Credit recipient (atomic).
  // We don't pass extraSet again to avoid double-setting updatedAt etc.
  await creditShares(db, corporationId, toCharacterId, shares);
}

// ── Add / credit shares (index fund buyer) ────────────────────────

/**
 * Atomically credit `shares` to an index fund's shareholder entry in the target corp.
 * Fund-held shares are represented directly on corporation cap tables via `fundId`
 * so passive ownership never needs a pseudo-corporation shell.
 */
export async function creditSharesToFund(
  db: Db,
  targetCorpId: ObjectId,
  fundId: ObjectId,
  shares: number,
  pricePerShare: number,
  extraUpdate?: { $inc?: Record<string, number>; $set?: Record<string, unknown> },
  opts?: Pick<CreditSharesOpts, "guardFilter" | "session">
): Promise<boolean> {
  const guardFilter = opts?.guardFilter ?? {};
  const targetCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: targetCorpId }, { projection: { shareholders: 1 }, ...mongoOptions(opts) });

  const existing = targetCorp?.shareholders?.find(
    (sh) => sh.fundId?.toString() === fundId.toString()
  );
  const existingShares = existing?.shares ?? 0;
  const oldAvg = existing?.avgCostPerShare ?? pricePerShare;
  const newAvg =
    existingShares > 0
      ? (existingShares * oldAvg + shares * pricePerShare) / (existingShares + shares)
      : pricePerShare;

  const incResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: targetCorpId, ...guardFilter, "shareholders.fundId": fundId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      $set: {
        "shareholders.$.avgCostPerShare": newAvg,
        ...extraUpdate?.$set,
      },
    },
    mongoOptions(opts)
  );

  if (incResult.matchedCount > 0) return true;

  const pushResult = await db.collection<Corporation>(CORP).updateOne(
    {
      _id: targetCorpId,
      ...guardFilter,
      shareholders: {
        $not: { $elemMatch: { fundId } },
      },
    },
    {
      $push: {
        shareholders: { fundId, shares, avgCostPerShare: pricePerShare },
      } as unknown as UpdateFilter<Corporation>,
      ...(extraUpdate?.$inc ? { $inc: extraUpdate.$inc } : {}),
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
    },
    mongoOptions(opts)
  );

  if (pushResult.matchedCount > 0) return true;

  const retryCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: targetCorpId }, { projection: { shareholders: 1 }, ...mongoOptions(opts) });
  const retryExisting = retryCorp?.shareholders?.find(
    (sh) => sh.fundId?.toString() === fundId.toString()
  );
  if (!retryExisting) return false;
  const retryAvg =
    (retryExisting.shares * (retryExisting.avgCostPerShare ?? pricePerShare) +
      shares * pricePerShare) /
    (retryExisting.shares + shares);
  const retryResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: targetCorpId, ...guardFilter, "shareholders.fundId": fundId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      $set: {
        "shareholders.$.avgCostPerShare": retryAvg,
        ...extraUpdate?.$set,
      },
    },
    mongoOptions(opts)
  );

  if (retryResult.matchedCount > 0) return true;
  if (isGuardedCredit(opts)) return false;
  throw new Error("Failed to credit fund shares after retry");
}

// ── Add / credit shares (NPP buyer) ────────────────────────────────

/**
 * Atomically credit `shares` to an NPP's shareholder entry in the target corp.
 * Mirrors `creditSharesToFund` (weighted-average cost basis, guarded float
 * check) — the `nppId` field already existed on `Shareholder` for CEO-owned
 * positions; this is the first writer that credits it for open-market buys.
 */
export async function creditSharesToNpp(
  db: Db,
  targetCorpId: ObjectId,
  nppId: ObjectId,
  shares: number,
  pricePerShare: number,
  extraUpdate?: { $inc?: Record<string, number>; $set?: Record<string, unknown> },
  opts?: Pick<CreditSharesOpts, "guardFilter" | "session">
): Promise<boolean> {
  const guardFilter = opts?.guardFilter ?? {};
  const targetCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: targetCorpId }, { projection: { shareholders: 1 }, ...mongoOptions(opts) });

  const existing = targetCorp?.shareholders?.find(
    (sh) => sh.nppId?.toString() === nppId.toString()
  );
  const existingShares = existing?.shares ?? 0;
  const oldAvg = existing?.avgCostPerShare ?? pricePerShare;
  const newAvg =
    existingShares > 0
      ? (existingShares * oldAvg + shares * pricePerShare) / (existingShares + shares)
      : pricePerShare;

  const incResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: targetCorpId, ...guardFilter, "shareholders.nppId": nppId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      $set: {
        "shareholders.$.avgCostPerShare": newAvg,
        ...extraUpdate?.$set,
      },
    },
    mongoOptions(opts)
  );

  if (incResult.matchedCount > 0) return true;

  const pushResult = await db.collection<Corporation>(CORP).updateOne(
    {
      _id: targetCorpId,
      ...guardFilter,
      shareholders: {
        $not: { $elemMatch: { nppId } },
      },
    },
    {
      $push: {
        shareholders: { nppId, shares, avgCostPerShare: pricePerShare },
      } as unknown as UpdateFilter<Corporation>,
      ...(extraUpdate?.$inc ? { $inc: extraUpdate.$inc } : {}),
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
    },
    mongoOptions(opts)
  );

  if (pushResult.matchedCount > 0) return true;

  const retryCorp = await db
    .collection<Corporation>(CORP)
    .findOne({ _id: targetCorpId }, { projection: { shareholders: 1 }, ...mongoOptions(opts) });
  const retryExisting = retryCorp?.shareholders?.find(
    (sh) => sh.nppId?.toString() === nppId.toString()
  );
  if (!retryExisting) return false;
  const retryAvg =
    (retryExisting.shares * (retryExisting.avgCostPerShare ?? pricePerShare) +
      shares * pricePerShare) /
    (retryExisting.shares + shares);
  const retryResult = await db.collection<Corporation>(CORP).updateOne(
    { _id: targetCorpId, ...guardFilter, "shareholders.nppId": nppId },
    {
      $inc: { "shareholders.$.shares": shares, ...extraUpdate?.$inc },
      $set: {
        "shareholders.$.avgCostPerShare": retryAvg,
        ...extraUpdate?.$set,
      },
    },
    mongoOptions(opts)
  );

  if (retryResult.matchedCount > 0) return true;
  if (isGuardedCredit(opts)) return false;
  throw new Error("Failed to credit NPP shares after retry");
}

// ── Debit / remove shares (NPP holder) ─────────────────────────────

/**
 * Atomically debit `shares` from an NPP's shareholder entry.
 * Mirrors `debitSharesFromFund`. Used by a future NPP sell/rebalance flow;
 * kept alongside the credit half for symmetry.
 */
export async function debitSharesFromNpp(
  db: Db,
  targetCorpId: ObjectId,
  nppId: ObjectId,
  shares: number,
  extraUpdate?: ShareholderExtraUpdate,
  opts?: DebitSharesOpts
): Promise<number> {
  const filter = opts?.requireSufficient
    ? {
        _id: targetCorpId,
        shareholders: { $elemMatch: { nppId, shares: { $gte: shares } } },
      }
    : { _id: targetCorpId, "shareholders.nppId": nppId };
  const result = await db.collection<Corporation>(CORP).findOneAndUpdate(
    filter,
    {
      $inc: { "shareholders.$.shares": -shares, ...extraUpdate?.$inc },
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
      ...(extraUpdate?.$unset ? { $unset: extraUpdate.$unset } : {}),
    },
    { returnDocument: "after", ...mongoOptions(opts) }
  );

  if (!result) return opts?.requireSufficient ? -1 : 0;

  const entry = result.shareholders?.find((sh) => sh.nppId?.toString() === nppId.toString());
  const remaining = entry?.shares ?? 0;

  if (remaining <= 0) {
    const pullUpdate = {
      $pull: {
        shareholders: { nppId },
      } as unknown as UpdateFilter<Corporation>,
    };
    const options = mongoOptions(opts);
    if (options) {
      await db.collection<Corporation>(CORP).updateOne({ _id: targetCorpId }, pullUpdate, options);
    } else {
      await db.collection<Corporation>(CORP).updateOne({ _id: targetCorpId }, pullUpdate);
    }
    return 0;
  }

  return remaining;
}

// ── Debit / remove shares (index fund holder) ─────────────────────

/**
 * Atomically debit `shares` from an index fund's shareholder entry.
 * Used by redemption/rebalance flows that sell fund-held stock back to public float.
 */
export async function debitSharesFromFund(
  db: Db,
  targetCorpId: ObjectId,
  fundId: ObjectId,
  shares: number,
  extraUpdate?: ShareholderExtraUpdate,
  opts?: DebitSharesOpts
): Promise<number> {
  const filter = opts?.requireSufficient
    ? {
        _id: targetCorpId,
        shareholders: { $elemMatch: { fundId, shares: { $gte: shares } } },
      }
    : { _id: targetCorpId, "shareholders.fundId": fundId };
  const result = await db.collection<Corporation>(CORP).findOneAndUpdate(
    filter,
    {
      $inc: { "shareholders.$.shares": -shares, ...extraUpdate?.$inc },
      ...(extraUpdate?.$set ? { $set: extraUpdate.$set } : {}),
      ...(extraUpdate?.$unset ? { $unset: extraUpdate.$unset } : {}),
    },
    { returnDocument: "after", ...mongoOptions(opts) }
  );

  if (!result) return opts?.requireSufficient ? -1 : 0;

  const entry = result.shareholders?.find((sh) => sh.fundId?.toString() === fundId.toString());
  const remaining = entry?.shares ?? 0;

  if (remaining <= 0) {
    const pullUpdate = {
      $pull: {
        shareholders: { fundId },
      } as unknown as UpdateFilter<Corporation>,
    };
    const options = mongoOptions(opts);
    if (options) {
      await db.collection<Corporation>(CORP).updateOne({ _id: targetCorpId }, pullUpdate, options);
    } else {
      await db.collection<Corporation>(CORP).updateOne({ _id: targetCorpId }, pullUpdate);
    }
    return 0;
  }

  return remaining;
}
