/**
 * Fund float trades freeze cash, share custody and receipts before settlement.
 * settleFundFloatPlan resumes the quote or reverses a proven refusal.
 */
import { type ClientSession, type Db, type Document, type ObjectId } from "mongodb";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import { MONEY_MOVE_COLLECTION, type MoneyMoveRecordLeg } from "@/lib/banking/moneyMove";
import type {
  BankingTransition,
  TransitionLeg,
  TransitionProjection,
} from "@/lib/banking/rules/boundary";
import { legsNet } from "@/lib/banking/rules/invariants";
import type { IndexFund, IndexFundHolding } from "@/lib/db/types";

export type FundFloatPlan = {
  key: string;
  state: "pending" | "completed" | "cancelled";
  direction: "buy" | "sell";
  corporationId: ObjectId;
  shares: number;
  amountAnchor: number;
  holdingsBefore: IndexFundHolding[];
  holdingsAfter: IndexFundHolding[];
  transition: BankingTransition;
  inverseCustody: TransitionLeg;
  reversalProjections?: TransitionProjection[];
  compensation?: BankingTransition;
  undoRequested?: boolean;
};
export type SettlementFund = IndexFund & {
  floatSettlementPlan?: FundFloatPlan;
  floatSettlementGeneration?: number;
  moneyMoveRevision?: number;
};
type FloatJournal = {
  _id: string;
  status: string;
  legs: MoneyMoveRecordLeg[];
  reversedBy?: string;
};

/** Journal calls participate in an existing caller transaction when one is supplied. */
export function fundSettlementDb(db: Db, session?: ClientSession): Db {
  if (!session) return db;
  const optionPositions: Record<string, number> = {
    find: 1,
    findOne: 1,
    insertOne: 1,
    insertMany: 1,
    updateOne: 2,
    updateMany: 2,
    findOneAndUpdate: 2,
    deleteOne: 1,
    deleteMany: 1,
    countDocuments: 1,
    bulkWrite: 1,
  };
  return new Proxy(db, {
    get(target, property) {
      if (property === "collection")
        return (...args: Parameters<Db["collection"]>) => {
          const collection = target.collection(...args);
          return new Proxy(collection, {
            get(inner, method) {
              const value = Reflect.get(inner, method);
              const position = optionPositions[String(method)];
              if (typeof value === "function" && position !== undefined)
                return (...call: unknown[]) => {
                  call[position] = { ...(call[position] as Document | undefined), session };
                  return value.apply(inner, call);
                };
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function finish(db: Db, transition: BankingTransition): Promise<SettlementResult> {
  const result = await settleTransition(db, transition);
  return result.status === "replayed" && result.error
    ? resumeSettlement(db, transition.key)
    : result;
}
const completed = (result: SettlementResult) =>
  !result.error && (result.status === "applied" || result.status === "replayed");

/** A fresh quote cannot supersede a pending plan or an unacknowledged target outcome. */
export async function claimFundFloatPlan(db: Db, fund: SettlementFund, plan: FundFloatPlan) {
  const generation = fund.floatSettlementGeneration;
  // Retain completed quotes before a later trade replaces the fund's active plan.
  // A multi-sale redemption can then undo its own trades in reverse order.
  const previous = fund.floatSettlementPlan;
  if (previous && previous.state !== "pending")
    await db
      .collection<{ _id: string; fundId: ObjectId; plan: FundFloatPlan }>("fundFloatSettlements")
      .updateOne(
        { _id: previous.key },
        { $setOnInsert: { fundId: fund._id, plan: previous } },
        { upsert: true }
      );
  const claimed = await db.collection<SettlementFund>("indexFunds").findOneAndUpdate(
    {
      _id: fund._id,
      cashAnchor: fund.cashAnchor,
      holdings: fund.holdings,
      floatSettlementGeneration: generation ?? { $exists: false },
      pendingMoneyMoveReceipt: { $exists: false },
      pendingSettlementProjection: { $exists: false },
      $or: [
        { floatSettlementPlan: { $exists: false } },
        { "floatSettlementPlan.state": { $in: ["completed", "cancelled"] } },
      ],
    },
    {
      $set: { floatSettlementPlan: plan },
      $inc: { floatSettlementGeneration: 1 },
    },
    { returnDocument: "after" }
  );
  return claimed !== null;
}

/** Freeze compensation only from the journal's proven refusal and applied outcomes. */
async function compensateRefusal(
  db: Db,
  fundId: ObjectId,
  plan: FundFloatPlan,
  reverseCompleted = false
) {
  const record = await db
    .collection<FloatJournal>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: plan.transition.key });
  if (!record) return false;
  if (reverseCompleted) {
    if (record.status !== "applied" || !record.legs.every((leg) => leg.applied)) return false;
  } else if (!record.legs.some((leg) => leg.refusal)) return false;
  const reversed: TransitionLeg[] = record.legs.flatMap((leg) => {
    if (!leg.applied) return [];
    if (leg.kind === "asset") return [plan.inverseCustody];
    if (leg.kind === "mint" || leg.kind === "burn")
      return [
        {
          kind: leg.kind === "mint" ? "burn" : "mint",
          amount: leg.amount,
          note: "Reverse the original frozen currency conversion",
        },
      ];
    const fundCash = leg.collection === "indexFunds";
    return [
      {
        kind: leg.kind === "debit" ? "credit" : "debit",
        amount: leg.amount,
        collection: leg.collection,
        path: leg.path,
        filter: {
          ...leg.filter,
          ...(fundCash
            ? {
                _id: fundId,
                "floatSettlementPlan.key": plan.key,
                holdings: plan.holdingsAfter,
              }
            : {}),
        },
        ...(fundCash ? { set: { holdings: plan.holdingsBefore } } : {}),
        note: "Reverse the original refused trade's proven cash leg",
      },
    ];
  });
  const net = legsNet(reversed);
  if (Math.abs(net) > 1e-6)
    reversed.push({
      kind: net > 0 ? "mint" : "burn",
      amount: Math.abs(net),
      note: "Contra for the original undelivered cash leg",
    });
  const compensationKey = `${plan.key}:${reverseCompleted ? "undo" : "refund"}`;
  const compensation: BankingTransition = {
    key: compensationKey,
    kind: "fund_float_refund",
    turn: plan.transition.turn,
    currency: plan.transition.currency,
    legs: reversed,
    projections: [
      ...(reverseCompleted ? (plan.reversalProjections ?? []) : []),
      {
        collection: MONEY_MOVE_COLLECTION,
        filter: { _id: plan.transition.key },
        update: {
          $set: reverseCompleted
            ? { reversedBy: compensationKey }
            : { status: "rejected", error: "Refused fund trade compensated", compensationKey },
        },
        note: "Close the original refusal after every proven effect is reversed",
      },
      {
        collection: "indexFunds",
        filter: { _id: fundId, "floatSettlementPlan.key": plan.key },
        update: { $set: { "floatSettlementPlan.state": "cancelled" } },
        note: "Release the original compensated quote",
      },
    ],
    event: { kind: "prop.traded", command: "fund_float_refund" },
  };
  await db.collection<SettlementFund>("indexFunds").updateOne(
    {
      _id: fundId,
      "floatSettlementPlan.key": plan.key,
      "floatSettlementPlan.compensation": { $exists: false },
      ...(reverseCompleted
        ? {
            "floatSettlementPlan.state": { $in: ["completed", "pending"] },
            "floatSettlementPlan.undoRequested": true,
            pendingSettlementProjection: { $exists: false },
          }
        : {}),
    },
    {
      $set: {
        "floatSettlementPlan.compensation": compensation,
        "floatSettlementPlan.state": "pending",
      },
    }
  );
  const frozen = await db
    .collection<SettlementFund>("indexFunds")
    .findOne(
      { _id: fundId, "floatSettlementPlan.key": plan.key },
      { projection: { floatSettlementPlan: 1 } }
    );
  if (!frozen?.floatSettlementPlan?.compensation)
    throw new Error("Fund refund plan is unavailable");
  const result = await finish(db, frozen.floatSettlementPlan.compensation);
  if (!completed(result))
    throw new Error(result.error ?? "Fund float refund requires reconciliation");
  return true;
}

/** Unknown acknowledgements resume the original plan; only proven refusals reverse it. */
export async function settleFundFloatPlan(db: Db, fundId: ObjectId, plan: FundFloatPlan) {
  const original = await db
    .collection<SettlementFund>("indexFunds")
    .findOne(
      { _id: fundId, "floatSettlementPlan.key": plan.key },
      { projection: { floatSettlementPlan: 1 } }
    );
  if (!original?.floatSettlementPlan)
    throw new Error("The original fund float quote is unavailable");
  plan = original.floatSettlementPlan;
  if (plan.compensation) {
    const refunded = await finish(db, plan.compensation);
    if (!completed(refunded))
      throw new Error(refunded.error ?? "Fund float refund requires reconciliation");
    return false;
  }
  if (plan.undoRequested) {
    if (!(await compensateRefusal(db, fundId, plan, true)))
      throw new Error("The completed fund trade lacks reversal proof");
    return false;
  }
  // A single lost acknowledgement can be resolved immediately from protected target proof.
  let result = await finish(db, plan.transition);
  if (!completed(result) && result.status !== "rejected")
    result = await finish(db, plan.transition);
  if (completed(result)) return true;
  if (await compensateRefusal(db, fundId, plan)) return false;
  throw new Error(result.error ?? "Fund float settlement requires reconciliation");
}

/** A caller reversing its own completed trade retains inverse cash and audit witnesses. */
export async function reverseCompletedFundFloatPlan(db: Db, fundId: ObjectId, plan: FundFloatPlan) {
  const proof = await db.collection<FloatJournal>(MONEY_MOVE_COLLECTION).findOne({ _id: plan.key });
  if (proof?.reversedBy) {
    const result = await resumeSettlement(db, proof.reversedBy);
    if (!completed(result)) throw new Error(result.error ?? "Fund trade reversal is incomplete");
    return false;
  }
  const current = await db
    .collection<SettlementFund>("indexFunds")
    .findOne(
      { _id: fundId },
      { projection: { floatSettlementPlan: 1, holdings: 1, floatSettlementGeneration: 1 } }
    );
  if (!current?.floatSettlementPlan)
    throw new Error("The original completed fund trade is unavailable");
  const active = current.floatSettlementPlan;
  if (active.key === plan.key && (active.compensation || active.undoRequested))
    return settleFundFloatPlan(db, fundId, active);
  const archived =
    active.key === plan.key
      ? active
      : (
          await db
            .collection<{ _id: string; fundId: ObjectId; plan: FundFloatPlan }>(
              "fundFloatSettlements"
            )
            .findOne({ _id: plan.key, fundId })
        )?.plan;
  if (
    !archived ||
    archived.state !== "completed" ||
    !proof ||
    proof.status !== "applied" ||
    !proof.legs.every((leg) => leg.applied)
  )
    throw new Error("The fund trade cannot be reversed without its completed settlement proof");
  const requested = { ...archived, state: "pending" as const, undoRequested: true };
  const claimed = await db.collection<SettlementFund>("indexFunds").findOneAndUpdate(
    {
      _id: fundId,
      "floatSettlementPlan.key": active.key,
      "floatSettlementPlan.state": { $in: ["completed", "cancelled"] },
      floatSettlementGeneration: current.floatSettlementGeneration,
      holdings: archived.holdingsAfter,
      pendingMoneyMoveReceipt: { $exists: false },
      pendingSettlementProjection: { $exists: false },
    },
    { $set: { floatSettlementPlan: requested }, $inc: { floatSettlementGeneration: 1 } },
    { returnDocument: "after" }
  );
  if (!claimed) throw new Error("The completed fund trade changed before reversal");
  return settleFundFloatPlan(db, fundId, requested);
}

/** Recovery precedes pricing, rebalancing and queued payouts in the ordinary cron. */
export async function recoverAllFundFloatSettlements(db: Db) {
  const pending = await db
    .collection<SettlementFund>("indexFunds")
    .find(
      {
        floatSettlementPlan: { $exists: true },
        $or: [
          { "floatSettlementPlan.state": "pending" },
          { pendingSettlementProjection: { $exists: true } },
        ],
      },
      { projection: { floatSettlementPlan: 1 } }
    )
    .toArray();
  for (const fund of pending) await settleFundFloatPlan(db, fund._id, fund.floatSettlementPlan!);
  return pending.length;
}
