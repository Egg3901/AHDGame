/**
 * Dividend Pass-Through for Index Funds
 *
 * When a corporation in which an index fund holds shares pays dividends, the
 * fund receives the dividend on its shareholder entry. Per the plan, 75% is
 * reinvested (added to fund cash for future public-float absorption) and 25%
 * is passed through to unit holders proportionally.
 *
 * This module provides helpers for:
 *   1. Calculating the 75/25 split.
 *   2. Distributing the 25% pass-through to unit holders in proportion to their
 *      unit holdings.
 *   3. Logging the dividend transaction.
 *
 * Called from the turn-processing dividend pipeline when a fund-held
 * corporation pays dividends.
 */

import type { Db, ObjectId } from "mongodb";
import type {
  Character,
  Corporation,
  ImperialCharacter,
  IndexFund,
  IndexFundPosition,
} from "@/lib/db/types";
import type { IndexFundTransaction } from "@/lib/db/types";
import {
  getFundById,
  listFundPositions,
  insertFundTransaction,
  insertFundTransactionsBulk,
} from "@/lib/indexFunds/fundQueries";
import { splitIndexFundDividend } from "@/lib/indexFunds/unitAccounting";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import {
  buildIndexFundDividendTxEntry,
  logIndexFundDividendBulk,
} from "@/lib/indexFunds/fundTxLog";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

export type DividendPassThroughResult = {
  fundId: ObjectId;
  /** Total gross dividend received by the fund (in anchor currency). */
  totalGrossAnchor: number;
  /** Amount reinvested into fund cash (75%). */
  reinvestedAnchor: number;
  /** Amount distributed to unit holders (25%). */
  passedThroughAnchor: number;
  /** Number of holders who received a distribution. */
  holdersPaid: number;
};

/**
 * Process a dividend payment received by an index fund from a constituent
 * corporation.
 *
 * @param db - MongoDB database handle.
 * @param fundId - The index fund that received the dividend.
 * @param grossDividendAnchor - Total dividend received, in the fund's anchor currency.
 * @param corporationId - The corporation that paid the dividend (for logging).
 * @param sharesHeld - Number of shares the fund holds in that corporation (for logging).
 * @returns Result of the pass-through distribution.
 */
export async function processIndexFundDividend(
  db: Db,
  fundId: ObjectId,
  grossDividendAnchor: number,
  corporationId: ObjectId,
  sharesHeld: number,
  options?: {
    turn?: number;
    // Optional prefetched fund doc + unit-holder positions. The turn-loop
    // caller groups accruals by fund and processes a fund's accruals back to
    // back; the fund's unitSupply and its position rows do NOT change during
    // dividend processing (dividends credit balances via $inc, they never mint
    // units or move holdings), so re-reading them for every same-fund accrual
    // was pure waste — the dominant residual cost of this step after the
    // group-by-fund parallelization. When supplied, they're reused instead of
    // re-queried. Correctness is unaffected: the distribution math reads only
    // unitSupply (constant) and positions (constant); the reinvest/undistributed
    // $inc on cashAnchor is additive and never reads the fetched cashAnchor.
    prefetch?: { fund: IndexFund; positions: IndexFundPosition[] };
  }
): Promise<DividendPassThroughResult> {
  const fund = options?.prefetch?.fund ?? (await getFundById(db, fundId));
  if (!fund) {
    throw new Error(`Index fund ${fundId} not found for dividend processing`);
  }

  const split = splitIndexFundDividend(grossDividendAnchor);

  if (split.grossAnchor <= 0 || fund.unitSupply <= 0) {
    return {
      fundId,
      totalGrossAnchor: split.grossAnchor,
      reinvestedAnchor: split.reinvestAnchor,
      passedThroughAnchor: split.passThroughAnchor,
      holdersPaid: 0,
    };
  }

  // Credit the reinvestment portion (75%) to fund cash.
  await db.collection("indexFunds").updateOne(
    { _id: fundId },
    {
      $inc: { cashAnchor: split.reinvestAnchor },
      $set: { updatedAt: new Date() },
    }
  );

  // Distribute the pass-through portion (25%) to unit holders proportionally.
  const forexEnabled = await isForexEnabled();
  const positions = options?.prefetch?.positions ?? (await listFundPositions(db, fundId));
  const perUnitDividend = split.passThroughAnchor / fund.unitSupply;
  const turn = options?.turn ?? (await getCurrentTurn(db));
  const now = new Date();

  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporationId }, { projection: { name: 1 } });
  const corporationName = corporation?.name;

  const characterIds = positions
    .filter((p) => p.holderKind === "character" && p.characterId)
    .map((p) => p.characterId!);
  const imperialIds = positions
    .filter((p) => p.holderKind === "imperial_character" && p.imperialCharacterId)
    .map((p) => p.imperialCharacterId!);

  const [characterDocs, imperialDocs] = await Promise.all([
    characterIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<Character, "_id" | "name">[]),
    imperialIds.length > 0
      ? db
          .collection<ImperialCharacter>("imperialCharacters")
          .find({ _id: { $in: imperialIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<ImperialCharacter, "_id" | "name">[]),
  ]);
  const characterNameById = new Map(characterDocs.map((c) => [c._id.toString(), c.name]));
  const imperialNameById = new Map(imperialDocs.map((c) => [c._id.toString(), c.name]));

  let holdersPaid = 0;
  let distributedAnchor = 0;
  const dividendTxEntries: ReturnType<typeof buildIndexFundDividendTxEntry>[] = [];
  const characterOps: {
    updateOne: {
      filter: { _id: ObjectId };
      update: { $inc: Record<string, number>; $set: { updatedAt: Date } };
    };
  }[] = [];
  const imperialOps: typeof characterOps = [];
  const nppOps: {
    updateOne: {
      filter: { _id: ObjectId };
      update: { $inc: Record<string, number>; $set: { updatedAt: Date } };
    };
  }[] = [];

  for (const position of positions) {
    if (position.holderKind === "fund_reserve") continue;
    if (position.units <= 0) continue;

    const holderDividend = Math.floor(position.units * perUnitDividend * 100) / 100;
    if (holderDividend <= 0) continue;

    if (position.holderKind === "character" && position.characterId) {
      const holderName = characterNameById.get(position.characterId.toString());
      if (!holderName) continue;

      const inc = buildPersonalBalanceInc(holderDividend, fund.anchorCurrencyCode, forexEnabled);
      characterOps.push({
        updateOne: {
          filter: { _id: position.characterId },
          update: { $inc: inc, $set: { updatedAt: now } },
        },
      });
      dividendTxEntries.push(
        buildIndexFundDividendTxEntry({
          fund,
          holder: {
            holderKind: "character",
            holderId: position.characterId,
            holderName,
          },
          amountAnchor: holderDividend,
          units: position.units,
          corporationId,
          corporationName,
          turn,
          createdAt: now,
        })
      );
      holdersPaid++;
      distributedAnchor += holderDividend;
    } else if (position.holderKind === "imperial_character" && position.imperialCharacterId) {
      const holderName = imperialNameById.get(position.imperialCharacterId.toString());
      if (!holderName) continue;

      const inc = buildPersonalBalanceInc(holderDividend, fund.anchorCurrencyCode, forexEnabled);
      imperialOps.push({
        updateOne: {
          filter: { _id: position.imperialCharacterId },
          update: { $inc: inc, $set: { updatedAt: now } },
        },
      });
      dividendTxEntries.push(
        buildIndexFundDividendTxEntry({
          fund,
          holder: {
            holderKind: "imperial_character",
            holderId: position.imperialCharacterId,
            holderName,
          },
          amountAnchor: holderDividend,
          units: position.units,
          corporationId,
          corporationName,
          turn,
          createdAt: now,
        })
      );
      holdersPaid++;
      distributedAnchor += holderDividend;
    } else if (position.holderKind === "npp" && position.nppId) {
      nppOps.push({
        updateOne: {
          filter: { _id: position.nppId },
          update: {
            $inc: { nppInvestmentCashAnchor: holderDividend },
            $set: { updatedAt: new Date() },
          },
        },
      });
      holdersPaid++;
      distributedAnchor += holderDividend;
    }
  }

  if (characterOps.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("characters").bulkWrite(characterOps as any);
  }
  if (imperialOps.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("imperialCharacters").bulkWrite(imperialOps as any);
  }
  if (nppOps.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("npps").bulkWrite(nppOps as any);
  }

  if (dividendTxEntries.length > 0) {
    await logIndexFundDividendBulk(db, dividendTxEntries);
  }

  const undistributedPassThrough =
    Math.round(Math.max(0, split.passThroughAnchor - distributedAnchor) * 100) / 100;
  if (undistributedPassThrough > 0) {
    await db.collection("indexFunds").updateOne(
      { _id: fundId },
      {
        $inc: { cashAnchor: undistributedPassThrough },
        $set: { updatedAt: new Date() },
      }
    );
  }

  // Log the dividend transaction on the fund.
  await insertFundTransaction(db, {
    fundId,
    kind: "dividend_pass_through",
    corporationId,
    shares: sharesHeld,
    navAnchor: fund.quotedNav,
    amountAnchor: distributedAnchor,
    note: `Dividend pass-through: ${distributedAnchor.toFixed(2)}₳ to ${holdersPaid} holders`,
    createdAt: new Date(),
  });

  // Also log the retained cash portion.
  const retainedAnchor = split.reinvestAnchor + undistributedPassThrough;
  await insertFundTransaction(db, {
    fundId,
    kind: "dividend_reinvest",
    corporationId,
    shares: sharesHeld,
    navAnchor: fund.quotedNav,
    amountAnchor: retainedAnchor,
    note: `Dividend retained: ${retainedAnchor.toFixed(2)}₳ to fund cash`,
    createdAt: new Date(),
  });

  return {
    fundId,
    totalGrossAnchor: split.grossAnchor,
    reinvestedAnchor: retainedAnchor,
    passedThroughAnchor: distributedAnchor,
    holdersPaid,
  };
}

/** One constituent-corp dividend accrual to a fund (turn-loop input). */
export interface FundDividendAccrualInput {
  fundId: ObjectId;
  amountAnchor: number;
  corporationId: ObjectId;
  shares: number;
}

/**
 * Batched index-fund dividend pass-through — behaviourally identical to calling
 * processIndexFundDividend once per accrual, but collapsing the ~9 DB
 * round-trips × N accruals into a handful of bulk operations.
 *
 * How it stays equivalent: the per-holder / per-fund credits are pure `$inc`s
 * (additive, order-independent), so they aggregate across accruals to the same
 * final balances; each accrual's amount is floored to 2dp BEFORE aggregation
 * exactly as the per-call path does; and every transaction-log row is preserved
 * (holder tx entries and the two per-accrual fund-tx rows are collected and bulk
 * inserted), keeping per-corporation attribution granularity. Reads (fund docs,
 * positions, corp/holder names) are batched with `$in`. The only observable
 * difference is `updatedAt`/`createdAt` timestamps sharing one turn-instant
 * instead of per-call `new Date()` — immaterial.
 *
 * This is the dominant cost of corporationTurn on production (remote Mongo: ~5k
 * serial round-trips/turn); batching it is the single biggest turn-time win.
 */
export async function processIndexFundDividendsBatch(
  db: Db,
  accruals: readonly FundDividendAccrualInput[],
  options?: { turn?: number }
): Promise<void> {
  const valid = accruals.filter((a) => Number.isFinite(a.amountAnchor) && a.amountAnchor > 0);
  if (valid.length === 0) return;

  const forexEnabled = await isForexEnabled();
  const turn = options?.turn ?? (await getCurrentTurn(db));
  const now = new Date();

  // Prefetch each distinct fund + its positions once.
  const fundIdStrs = [...new Set(valid.map((a) => a.fundId.toString()))];
  const fundById = new Map<string, IndexFund>();
  const positionsByFund = new Map<string, IndexFundPosition[]>();
  await Promise.all(
    valid
      .filter(
        (a, i, arr) => arr.findIndex((b) => b.fundId.toString() === a.fundId.toString()) === i
      )
      .map(async (a) => {
        const key = a.fundId.toString();
        const fund = await getFundById(db, a.fundId);
        if (fund) {
          fundById.set(key, fund);
          positionsByFund.set(key, await listFundPositions(db, a.fundId));
        }
      })
  );

  // Batch-read corp names (for tx entries) and holder names in one $in each.
  const corpIds = [
    ...new Map(valid.map((a) => [a.corporationId.toString(), a.corporationId])).values(),
  ];
  const charIds: ObjectId[] = [];
  const impIds: ObjectId[] = [];
  for (const key of fundIdStrs) {
    for (const p of positionsByFund.get(key) ?? []) {
      if (p.holderKind === "character" && p.characterId) charIds.push(p.characterId);
      if (p.holderKind === "imperial_character" && p.imperialCharacterId)
        impIds.push(p.imperialCharacterId);
    }
  }
  const [corpDocs, charDocs, impDocs] = await Promise.all([
    corpIds.length
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corpIds } }, { projection: { name: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<Corporation, "_id" | "name">[]),
    charIds.length
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<Character, "_id" | "name">[]),
    impIds.length
      ? db
          .collection<ImperialCharacter>("imperialCharacters")
          .find({ _id: { $in: impIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<ImperialCharacter, "_id" | "name">[]),
  ]);
  const corpNameById = new Map(corpDocs.map((c) => [c._id.toString(), c.name]));
  const charNameById = new Map(charDocs.map((c) => [c._id.toString(), c.name]));
  const impNameById = new Map(impDocs.map((c) => [c._id.toString(), c.name]));

  // Aggregators (all $inc, so additive across accruals).
  const fundCashInc = new Map<string, { id: ObjectId; amt: number }>();
  const charInc = new Map<string, { id: ObjectId; inc: Record<string, number> }>();
  const impInc = new Map<string, { id: ObjectId; inc: Record<string, number> }>();
  const nppInc = new Map<string, { id: ObjectId; amt: number }>();
  const holderTxEntries: ReturnType<typeof buildIndexFundDividendTxEntry>[] = [];
  const fundTxDocs: Omit<IndexFundTransaction, "_id">[] = [];

  const addInc = (
    map: Map<string, { id: ObjectId; inc: Record<string, number> }>,
    id: ObjectId,
    inc: Record<string, number>
  ) => {
    const key = id.toString();
    const e = map.get(key) ?? { id, inc: {} };
    for (const [field, v] of Object.entries(inc)) e.inc[field] = (e.inc[field] ?? 0) + v;
    map.set(key, e);
  };
  const addAmt = (map: Map<string, { id: ObjectId; amt: number }>, id: ObjectId, amt: number) => {
    const key = id.toString();
    const e = map.get(key) ?? { id, amt: 0 };
    e.amt += amt;
    map.set(key, e);
  };

  for (const accrual of valid) {
    const fund = fundById.get(accrual.fundId.toString());
    if (!fund) continue;
    const split = splitIndexFundDividend(accrual.amountAnchor);
    if (split.grossAnchor <= 0 || fund.unitSupply <= 0) continue;

    const positions = positionsByFund.get(accrual.fundId.toString()) ?? [];
    const perUnitDividend = split.passThroughAnchor / fund.unitSupply;
    const corporationName = corpNameById.get(accrual.corporationId.toString());
    let holdersPaid = 0;
    let distributedAnchor = 0;

    for (const position of positions) {
      if (position.holderKind === "fund_reserve" || position.units <= 0) continue;
      const holderDividend = Math.floor(position.units * perUnitDividend * 100) / 100;
      if (holderDividend <= 0) continue;

      if (position.holderKind === "character" && position.characterId) {
        const holderName = charNameById.get(position.characterId.toString());
        if (!holderName) continue;
        addInc(
          charInc,
          position.characterId,
          buildPersonalBalanceInc(holderDividend, fund.anchorCurrencyCode, forexEnabled)
        );
        holderTxEntries.push(
          buildIndexFundDividendTxEntry({
            fund,
            holder: { holderKind: "character", holderId: position.characterId, holderName },
            amountAnchor: holderDividend,
            units: position.units,
            corporationId: accrual.corporationId,
            corporationName,
            turn,
            createdAt: now,
          })
        );
        holdersPaid++;
        distributedAnchor += holderDividend;
      } else if (position.holderKind === "imperial_character" && position.imperialCharacterId) {
        const holderName = impNameById.get(position.imperialCharacterId.toString());
        if (!holderName) continue;
        addInc(
          impInc,
          position.imperialCharacterId,
          buildPersonalBalanceInc(holderDividend, fund.anchorCurrencyCode, forexEnabled)
        );
        holderTxEntries.push(
          buildIndexFundDividendTxEntry({
            fund,
            holder: {
              holderKind: "imperial_character",
              holderId: position.imperialCharacterId,
              holderName,
            },
            amountAnchor: holderDividend,
            units: position.units,
            corporationId: accrual.corporationId,
            corporationName,
            turn,
            createdAt: now,
          })
        );
        holdersPaid++;
        distributedAnchor += holderDividend;
      } else if (position.holderKind === "npp" && position.nppId) {
        addAmt(nppInc, position.nppId, holderDividend);
        holdersPaid++;
        distributedAnchor += holderDividend;
      }
    }

    const undistributedPassThrough =
      Math.round(Math.max(0, split.passThroughAnchor - distributedAnchor) * 100) / 100;
    const retainedAnchor = split.reinvestAnchor + undistributedPassThrough;
    addAmt(fundCashInc, accrual.fundId, retainedAnchor);

    fundTxDocs.push({
      fundId: accrual.fundId,
      kind: "dividend_pass_through",
      corporationId: accrual.corporationId,
      shares: accrual.shares,
      navAnchor: fund.quotedNav,
      amountAnchor: distributedAnchor,
      note: `Dividend pass-through: ${distributedAnchor.toFixed(2)}₳ to ${holdersPaid} holders`,
      createdAt: now,
    } as Omit<IndexFundTransaction, "_id">);
    fundTxDocs.push({
      fundId: accrual.fundId,
      kind: "dividend_reinvest",
      corporationId: accrual.corporationId,
      shares: accrual.shares,
      navAnchor: fund.quotedNav,
      amountAnchor: retainedAnchor,
      note: `Dividend retained: ${retainedAnchor.toFixed(2)}₳ to fund cash`,
      createdAt: now,
    } as Omit<IndexFundTransaction, "_id">);
  }

  // Bulk writes — one round-trip per collection.
  const fundOps = [...fundCashInc.values()]
    .filter((e) => e.amt !== 0)
    .map((e) => ({
      updateOne: {
        filter: { _id: e.id },
        update: { $inc: { cashAnchor: e.amt }, $set: { updatedAt: now } },
      },
    }));
  const charOps = [...charInc.values()].map((e) => ({
    updateOne: { filter: { _id: e.id }, update: { $inc: e.inc, $set: { updatedAt: now } } },
  }));
  const impOps = [...impInc.values()].map((e) => ({
    updateOne: { filter: { _id: e.id }, update: { $inc: e.inc, $set: { updatedAt: now } } },
  }));
  const nppOps = [...nppInc.values()].map((e) => ({
    updateOne: {
      filter: { _id: e.id },
      update: { $inc: { nppInvestmentCashAnchor: e.amt }, $set: { updatedAt: now } },
    },
  }));

  /* eslint-disable @typescript-eslint/no-explicit-any */
  await Promise.all([
    fundOps.length ? db.collection("indexFunds").bulkWrite(fundOps as any[]) : Promise.resolve(),
    charOps.length ? db.collection("characters").bulkWrite(charOps as any[]) : Promise.resolve(),
    impOps.length
      ? db.collection("imperialCharacters").bulkWrite(impOps as any[])
      : Promise.resolve(),
    nppOps.length ? db.collection("npps").bulkWrite(nppOps as any[]) : Promise.resolve(),
  ]);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  await logIndexFundDividendBulk(db, holderTxEntries);
  await insertFundTransactionsBulk(db, fundTxDocs);
}

/**
 * Find all funds that hold shares in a given corporation.
 * Used by the turn-processing dividend pipeline to determine which funds
 * should receive pass-through from a corporation's dividend payment.
 */
export async function findFundsHoldingCorporation(
  db: Db,
  corporationId: ObjectId
): Promise<{ fundId: ObjectId; sharesHeld: number }[]> {
  const { FUND_COLLECTION } = await import("@/lib/indexFunds/fundQueries");
  const activeFunds = await db
    .collection<IndexFund>(FUND_COLLECTION)
    .find({
      status: "active",
      "holdings.corporationId": corporationId,
    })
    .project<{ _id: ObjectId; holdings: IndexFund["holdings"] }>({ _id: 1, holdings: 1 })
    .toArray();

  return activeFunds.flatMap((fund) => {
    const holding = fund.holdings.find(
      (h) => h.corporationId.toString() === corporationId.toString()
    );
    if (!holding || holding.shares <= 0) return [];
    return [{ fundId: fund._id, sharesHeld: holding.shares }];
  });
}
