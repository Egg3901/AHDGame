/** Journal-owned same-document transfers publish cash and their read model atomically. */
import { type Db, type Document, type Filter, type UpdateFilter } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import {
  claimMoneyMove,
  MONEY_MOVE_COLLECTION,
  SETTLED_KEYS_FIELD,
  SETTLED_KEYS_CAP,
} from "./moneyMove";
import type { BankingTransition, TransitionProjection } from "./rules/boundary";
import type { SettlementResult } from "./settlementJournal";
import { reviveObjectIds } from "./settlementEncoding";

type AtomicUpdate = {
  $set?: Record<string, unknown>;
  $inc?: Record<string, number>;
  $unset?: Record<string, unknown>;
};
interface AtomicPlan {
  collection: string;
  identity: Record<string, unknown>;
  guard: Record<string, unknown>;
  update: AtomicUpdate;
  receipt: string;
  receiptGuard: unknown;
}
interface AtomicRecord extends Document {
  _id: string;
  kind: string;
  turn?: number;
  atomicDocument: AtomicPlan;
  legs: { kind: string; amount: number; path: string; applied: boolean }[];
  projections: { projection: TransitionProjection; applied: boolean; appliedAt?: Date }[];
}
const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value
    );
function balanceAfter(document: Document, update: AtomicUpdate, path: string): number {
  for (const [setPath, value] of Object.entries(update.$set ?? {})) {
    if (path === setPath) return Number(value);
    if (path.startsWith(`${setPath}.`))
      return Number(at(value, path.slice(setPath.length + 1)) ?? 0);
  }
  if (Object.keys(update.$unset ?? {}).some((key) => path === key || path.startsWith(`${key}.`)))
    return 0;
  return Number(at(document, path) ?? 0) + Number(update.$inc?.[path] ?? 0);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function settleAtomicDocumentTransition(
  db: Db,
  transition: BankingTransition,
  target: {
    identity: Record<string, unknown>;
    guard?: Record<string, unknown>;
    /** Receipt generation captured with the caller's quote. Null means absent. */
    expectedSettledKeys?: readonly string[] | null;
  }
): Promise<SettlementResult> {
  const identity = reviveObjectIds(target.identity);
  const projection = transition.projections[0];
  const bad = (error: string): SettlementResult => ({
    status: "rejected",
    key: transition.key,
    appliedLegs: [],
    appliedProjections: [],
    newlyAppliedProjections: [],
    error,
  });
  if (
    !transition.projections.length ||
    !projection?.update ||
    !projection.filter ||
    projection.insert
  )
    return bad("Atomic settlement needs a leading document update projection");
  if (
    transition.projections
      .slice(1)
      .some(
        (item) =>
          item.collection !== "financialTxLog" || !item.insert?._id || item.update || item.filter
      )
  )
    return bad("Atomic follow-up projections must be financial transaction inserts with fixed ids");
  if (!same(reviveObjectIds(projection.filter), identity))
    return bad("Atomic projection must address the same identity");
  if (Object.keys(identity).length !== 1 || identity._id === undefined)
    return bad("Atomic settlement identity must be a stable document id");
  const realLegs = transition.legs.filter((leg) => leg.kind === "debit" || leg.kind === "credit");
  if (!realLegs.length) return bad("Atomic settlement needs a document cash leg");
  if (transition.legs.some((leg) => !Number.isFinite(leg.amount) || leg.amount <= 0))
    return bad("Atomic legs need finite positive amounts");
  if (
    realLegs.some(
      (leg) =>
        leg.collection !== projection.collection ||
        !leg.path ||
        !same(reviveObjectIds(leg.filter), identity) ||
        leg.set
    )
  )
    return bad("Atomic cash legs must share the document identity");
  if (Object.keys(target.guard ?? {}).some((key) => key === "_id" || key === SETTLED_KEYS_FIELD))
    return bad("Atomic guard cannot override identity or receipt");
  if (Object.keys(projection.update).some((key) => !["$set", "$inc", "$unset"].includes(key)))
    return bad("Unsupported atomic projection operator");
  if (
    Object.values(projection.update).some(
      (value) =>
        value &&
        typeof value === "object" &&
        Object.keys(value).some(
          (key) => key === SETTLED_KEYS_FIELD || key.startsWith(`${SETTLED_KEYS_FIELD}.`)
        )
    )
  )
    return bad("Atomic projection cannot change settlement receipts");
  // Freeze the document generation before claiming. An old intent must not
  // become eligible again after another journal operation restores the same values.
  const original = await db
    .collection(projection.collection)
    .findOne(identity, { projection: { [SETTLED_KEYS_FIELD]: 1 } });
  if (target.expectedSettledKeys !== undefined) {
    // An existing claim owns its original plan even when its own delivery has
    // advanced the generation. A new claim cannot refresh an older quote.
    const existing = await db
      .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
      .findOne({ _id: transition.key });
    if (existing) return resumeAtomicDocumentSettlement(db, transition.key);
    if (!same(original?.[SETTLED_KEYS_FIELD] ?? null, target.expectedSettledKeys))
      return bad("Atomic quote receipt generation changed");
  }
  const plan: AtomicPlan = {
    collection: projection.collection,
    identity,
    guard: reviveObjectIds(target.guard ?? {}),
    update: reviveObjectIds(projection.update) as AtomicUpdate,
    receipt: `${transition.key}:atomic`,
    receiptGuard: (target.expectedSettledKeys === undefined
      ? original?.[SETTLED_KEYS_FIELD]
      : target.expectedSettledKeys) ?? { $exists: false },
  };
  const claimed = await claimMoneyMove(db, {
    key: transition.key,
    kind: transition.kind,
    turn: transition.turn,
    legs: transition.legs.map((leg) => ({ ...leg, filter: reviveObjectIds(leg.filter) })),
    record: {
      transitionKind: transition.kind,
      currency: transition.currency,
      atomicDocument: plan,
      projections: transition.projections.map((item) => ({
        collection: item.collection,
        note: item.note,
        claimedAt: null,
        appliedAt: null,
        applied: false,
        projection: item,
      })),
    },
  });
  if (claimed.status === "rejected") return bad(claimed.error);
  // The target receipt arbitrates concurrent first delivery and every recovery;
  // the journal's immutable quote, never the caller's recomputation, is applied.
  return resumeAtomicDocumentSettlement(db, transition.key);
}

export async function resumeAtomicDocumentSettlement(
  db: Db,
  key: string
): Promise<SettlementResult> {
  const journal = db.collection<AtomicRecord>(MONEY_MOVE_COLLECTION);
  const record = await journal.findOne({ _id: key });
  const result: SettlementResult = {
    status: "rejected",
    key,
    appliedLegs: [],
    appliedProjections: [],
    newlyAppliedProjections: [],
  };
  if (!record?.atomicDocument) return { ...result, error: "No atomic settlement record" };
  if (
    record.status === "applied" &&
    record.legs.every((leg) => leg.applied) &&
    record.projections.every((projection) => projection.applied)
  )
    return {
      status: "replayed",
      key,
      appliedLegs: record.legs.map((_leg, index) => index),
      appliedProjections: record.projections.map((_projection, index) => index),
      newlyAppliedProjections: [],
    };
  const plan = record.atomicDocument;
  const collection = db.collection(plan.collection);
  const receiptFilter = { ...plan.identity, [SETTLED_KEYS_FIELD]: plan.receipt };
  let replayed = !!(await collection.findOne(receiptFilter, { projection: { _id: 1 } }));
  if (!replayed) {
    if (record.status === "rejected")
      return { ...result, error: record.error ?? "Atomic settlement was rejected" };
    const document = await collection.findOne({
      ...plan.identity,
      ...plan.guard,
      [SETTLED_KEYS_FIELD]: plan.receiptGuard,
    });
    if (!document) {
      // A concurrent delivery may have changed the guarded state just now.
      replayed = !!(await collection.findOne(receiptFilter, { projection: { _id: 1 } }));
      if (!replayed) {
        await journal.updateOne(
          { _id: key },
          { $set: { status: "rejected", error: "Atomic document guard refused; no money moved" } }
        );
        return { ...result, error: "Atomic document guard refused; no money moved" };
      }
    } else {
      const deltas = new Map<string, number>();
      for (const leg of record.legs.filter((leg) => leg.kind === "debit" || leg.kind === "credit"))
        deltas.set(
          leg.path,
          (deltas.get(leg.path) ?? 0) + (leg.kind === "debit" ? -leg.amount : leg.amount)
        );
      const balanceGuards: Record<string, unknown> = {};
      for (const [path, delta] of deltas) {
        const value = at(document, path);
        const before = Number(value ?? 0);
        const after = balanceAfter(document, plan.update, path);
        if (
          !Number.isFinite(before) ||
          !Number.isFinite(after) ||
          after < 0 ||
          Math.abs(after - before - delta) >
            Math.max(
              1e-7,
              Number.EPSILON * (Math.abs(before) + Math.abs(after) + Math.abs(delta)) * 8
            )
        ) {
          const error = `Atomic projection does not implement journal balance delta at ${path}`;
          await journal.updateOne({ _id: key }, { $set: { status: "rejected", error } });
          return { ...result, error };
        }
        balanceGuards[path] = value === undefined ? { $exists: false } : value;
      }
      const changed = await collection.updateOne(
        {
          $and: [
            plan.identity,
            plan.guard,
            balanceGuards,
            { [SETTLED_KEYS_FIELD]: plan.receiptGuard },
            { [SETTLED_KEYS_FIELD]: { $ne: plan.receipt } },
          ],
        } as Filter<Document>,
        {
          ...plan.update,
          $push: { [SETTLED_KEYS_FIELD]: { $each: [plan.receipt], $slice: -SETTLED_KEYS_CAP } },
        } as unknown as UpdateFilter<Document>
      );
      if (changed.matchedCount !== 1) {
        replayed = !!(await collection.findOne(receiptFilter, { projection: { _id: 1 } }));
        if (!replayed) {
          const error = "Atomic document changed before delivery; no money moved";
          await journal.updateOne({ _id: key }, { $set: { status: "rejected", error } });
          return { ...result, error };
        }
      }
    }
  }
  // Cash is already receipted. Recover the original visible transaction rows
  // before completing the journal, including applied-but-unacknowledged writes.
  for (const { projection } of record.projections.slice(1)) {
    if (projection.collection !== "financialTxLog" || !projection.insert?._id)
      throw new Error("Invalid atomic transaction receipt projection");
    const document = reviveObjectIds(projection.insert) as Document;
    const receipts = db.collection(projection.collection);
    await receipts.updateOne({ _id: document._id }, { $setOnInsert: document }, { upsert: true });
    const persisted = await receipts.findOne({ _id: document._id });
    if (!isDeepStrictEqual(persisted, document))
      throw new Error("Atomic transaction receipt conflicts with original settlement");
  }
  const now = new Date();
  const completed: Record<string, unknown> = {
    status: "applied",
    completedAt: now,
    projectionsCompletedAt: now,
  };
  record.legs.forEach((_leg, index) => {
    completed[`legs.${index}.applied`] = true;
  });
  record.projections.forEach((_projection, index) => {
    completed[`projections.${index}.applied`] = true;
    completed[`projections.${index}.appliedAt`] = now;
  });
  await journal.updateOne({ _id: key }, { $set: completed, $unset: { error: "" } });
  return {
    status: replayed ? "replayed" : "applied",
    key,
    appliedLegs: record.legs.map((_leg, index) => index),
    appliedProjections: record.projections.map((_projection, index) => index),
    newlyAppliedProjections: replayed ? [] : record.projections.map((_projection, index) => index),
  };
}
