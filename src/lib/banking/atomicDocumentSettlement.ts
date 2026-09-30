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
  receiptProtocol?: "protected_v1";
  nonCashMode?: "central_bank_bond_exchange";
  cashMode?: "central_bank_reserve_pool";
}
interface AtomicRecord extends Document {
  _id: string;
  kind: string;
  turn?: number;
  atomicDocument: AtomicPlan;
  legs: { kind: string; amount: number; path: string; applied: boolean }[];
  projections: { projection: TransitionProjection; applied: boolean; appliedAt?: Date | null }[];
}
const PROTECTED_RECEIPT = "pendingAtomicSettlementReceipt";
interface ProtectedReceipt {
  key: string;
  journalKey?: string;
  outcome: "applied" | "rejected";
  error?: string;
}
function mentionsProtectedReceipt(value: unknown): boolean {
  if (typeof value === "string")
    return value === `$${PROTECTED_RECEIPT}` || value.startsWith(`$${PROTECTED_RECEIPT}.`);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      key === PROTECTED_RECEIPT ||
      key.startsWith(`${PROTECTED_RECEIPT}.`) ||
      mentionsProtectedReceipt(nested)
  );
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
    nonCashMode?: "central_bank_bond_exchange";
    cashMode?: "central_bank_reserve_pool";
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
  const assetOnly =
    transition.legs.length === 0 && target.nonCashMode === "central_bank_bond_exchange";
  if (!realLegs.length && !assetOnly)
    return bad("Atomic settlement needs a document cash leg or an explicit bond exchange");
  if (assetOnly) {
    const allowed = new Set([
      "publicFloat",
      "centralBankHoldings",
      "marketPrice",
      "qeSupportRatio",
      "updatedAt",
    ]);
    if (
      projection.collection !== "bonds" ||
      projection.update.$unset ||
      Object.values(projection.update).some(
        (value) =>
          !value ||
          typeof value !== "object" ||
          Object.keys(value).some((path) => !allowed.has(path))
      )
    )
      return bad("Noncash bond exchanges may update only the permitted asset fields");
  }
  if (target.cashMode === "central_bank_reserve_pool") {
    const increment = projection.update.$inc as Record<string, unknown> | undefined;
    const debit = realLegs.find((leg) => leg.kind === "debit");
    const credit = realLegs.find((leg) => leg.kind === "credit");
    const poolPaths = new Set(["forexRevenue", "reserveBalance"]);
    if (
      projection.collection !== "centralBanks" ||
      target.nonCashMode ||
      transition.legs.length !== 2 ||
      realLegs.length !== 2 ||
      !debit ||
      !credit ||
      debit.amount !== credit.amount ||
      debit.path === credit.path ||
      !poolPaths.has(debit.path ?? "") ||
      !poolPaths.has(credit.path ?? "") ||
      Object.keys(projection.update).some((key) => !["$inc", "$set"].includes(key)) ||
      Object.keys(projection.update.$inc ?? {}).some(
        (path) => !poolPaths.has(path) && path !== "locBookRevision"
      ) ||
      (increment?.locBookRevision !== undefined && increment.locBookRevision !== 1) ||
      Object.keys(projection.update.$set ?? {}).some(
        (path) => !["updatedAt", "lastReservePoolTransferTurn"].includes(path)
      )
    )
      return bad("Reserve pool mode permits only a balanced central-bank pool exchange");
  }
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
  if (mentionsProtectedReceipt(target.guard) || mentionsProtectedReceipt(projection.update))
    return bad("Atomic callers cannot alter the protected settlement receipt");
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
    receiptProtocol: "protected_v1",
    receiptGuard: (target.expectedSettledKeys === undefined
      ? original?.[SETTLED_KEYS_FIELD]
      : target.expectedSettledKeys) ?? { $exists: false },
    ...(assetOnly ? { nonCashMode: target.nonCashMode } : {}),
    ...(target.cashMode ? { cashMode: target.cashMode } : {}),
  };
  const extension = {
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
  };
  if (assetOnly) {
    // The money primitive intentionally makes an empty cash move a no-op.
    // Asset exchanges still claim their complete original plan before mutation.
    try {
      await db.collection<AtomicRecord>(MONEY_MOVE_COLLECTION).insertOne({
        ...extension,
        _id: transition.key,
        kind: transition.kind,
        turn: transition.turn,
        legs: [],
        status: "partial",
        createdAt: new Date(),
      });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
    }
  } else {
    const claimed = await claimMoneyMove(db, {
      key: transition.key,
      kind: transition.kind,
      turn: transition.turn,
      legs: transition.legs.map((leg) => ({ ...leg, filter: reviveObjectIds(leg.filter) })),
      record: extension,
    });
    if (claimed.status === "rejected") return bad(claimed.error);
  }
  // The target receipt arbitrates concurrent first delivery and every recovery;
  // the journal's immutable quote, never the caller's recomputation, is applied.
  return resumeAtomicDocumentSettlement(db, transition.key);
}

export async function resumeAtomicDocumentSettlement(
  db: Db,
  key: string,
  recoverPendingOwner = true
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
  const plan = record.atomicDocument;
  const collection = db.collection(plan.collection);
  const completedResult = (status: "applied" | "replayed"): SettlementResult => ({
    status,
    key,
    appliedLegs: record.legs.map((_leg, index) => index),
    appliedProjections: record.projections.map((_projection, index) => index),
    newlyAppliedProjections: [],
  });
  const isComplete = (value: AtomicRecord) =>
    value.status === "applied" &&
    value.legs.every((leg) => leg.applied) &&
    value.projections.every((projection) => projection.applied);
  const release = () =>
    collection.updateOne(
      { ...plan.identity, [`${PROTECTED_RECEIPT}.key`]: plan.receipt },
      { $unset: { [PROTECTED_RECEIPT]: "" } }
    );
  const pending = (error: string): SettlementResult => ({ ...result, status: "partial", error });
  const readTarget = () =>
    collection.findOne(plan.identity, {
      projection: {
        [PROTECTED_RECEIPT]: 1,
        ...(!plan.receiptProtocol ? { [SETTLED_KEYS_FIELD]: 1 } : {}),
      },
    });
  const ownerOf = (document: Document | null) =>
    document?.[PROTECTED_RECEIPT] as ProtectedReceipt | undefined;
  const hasLegacyReceipt = (document: Document | null) =>
    !plan.receiptProtocol &&
    Array.isArray(document?.[SETTLED_KEYS_FIELD]) &&
    document[SETTLED_KEYS_FIELD].includes(plan.receipt);
  const busy = async (owner: ProtectedReceipt): Promise<SettlementResult> => {
    if (owner.journalKey) {
      const ownerRecord = await journal.findOne({ _id: owner.journalKey });
      if (
        ownerRecord?.atomicDocument &&
        ownerRecord.atomicDocument.collection === plan.collection &&
        same(ownerRecord.atomicDocument.identity, plan.identity) &&
        ownerRecord.atomicDocument.receipt === owner.key
      ) {
        if (
          isComplete(ownerRecord) ||
          (ownerRecord.status === "rejected" && owner.outcome === "rejected")
        ) {
          // A lost cleanup acknowledgement must not depend on the old API caller returning.
          await collection.updateOne(
            { ...plan.identity, [PROTECTED_RECEIPT]: owner },
            { $unset: { [PROTECTED_RECEIPT]: "" } }
          );
        } else if (recoverPendingOwner && ownerRecord.status === "partial") {
          // Help only this validated target owner, even if it is outside the
          // bounded recovery page. Disable further owner traversal in that call.
          await resumeAtomicDocumentSettlement(db, owner.journalKey, false);
        }
      }
    }
    return pending("Another atomic settlement owns this target; retry after its recovery");
  };
  const terminal = async (current: AtomicRecord): Promise<SettlementResult | null> => {
    if (isComplete(current)) {
      await release();
      return completedResult("replayed");
    }
    if (current.status === "rejected") {
      const owner = ownerOf(await readTarget());
      if (owner?.key === plan.receipt && owner.outcome === "applied")
        return pending(
          "Atomic journal contradicts its protected cash receipt; reconciliation required"
        );
      await release();
      return { ...result, error: current.error ?? "Atomic settlement was rejected" };
    }
    return null;
  };
  const finished = await terminal(record);
  if (finished) return finished;
  // The refusal competes on the same target field as cash. A stale worker
  // cannot publish cash after another retry has committed the refusal.
  const refuse = async (error: string): Promise<SettlementResult> => {
    const latest = await journal.findOne({ _id: key });
    if (!latest) throw new Error("Atomic journal disappeared before refusal");
    const prior = await terminal(latest);
    if (prior) return prior;
    await collection.updateOne({ ...plan.identity, [PROTECTED_RECEIPT]: { $exists: false } }, {
      $set: {
        [PROTECTED_RECEIPT]: { key: plan.receipt, journalKey: key, outcome: "rejected", error },
      },
      $push: {
        [SETTLED_KEYS_FIELD]: { $each: [`${plan.receipt}:rejected`], $slice: -SETTLED_KEYS_CAP },
      },
    } as unknown as UpdateFilter<Document>);
    const target = await readTarget(),
      owner = ownerOf(target);
    if (owner?.key !== plan.receipt)
      return pending("Atomic target is busy or unavailable; original settlement remains pending");
    if (owner.outcome === "applied") return resumeAtomicDocumentSettlement(db, key);
    await journal.updateOne(
      { _id: key, status: { $nin: ["applied", "rejected"] } },
      { $set: { status: "rejected", error: owner.error ?? error } }
    );
    const current = await journal.findOne({ _id: key });
    if (!current) throw new Error("Atomic journal disappeared after refusal");
    return (await terminal(current)) ?? pending("Atomic refusal remains pending");
  };
  let observed = await readTarget(),
    owner = ownerOf(observed);
  if (owner && owner.key !== plan.receipt) return busy(owner);
  if (owner?.outcome === "rejected") return refuse(owner.error ?? "Atomic quote refused");
  let replayed = owner?.outcome === "applied";
  if (!replayed && hasLegacyReceipt(observed)) {
    // Existing partial claims can retain their still-present original proof.
    await collection.updateOne(
      {
        ...plan.identity,
        [SETTLED_KEYS_FIELD]: plan.receipt,
        [PROTECTED_RECEIPT]: { $exists: false },
      },
      { $set: { [PROTECTED_RECEIPT]: { key: plan.receipt, journalKey: key, outcome: "applied" } } }
    );
    observed = await readTarget();
    owner = ownerOf(observed);
    if (owner?.key !== plan.receipt || owner.outcome !== "applied")
      return pending("Legacy atomic receipt could not be protected; retry recovery");
    replayed = true;
  }
  if (!replayed) {
    const document = await collection.findOne({
      ...plan.identity,
      ...plan.guard,
      [SETTLED_KEYS_FIELD]: plan.receiptGuard,
      [PROTECTED_RECEIPT]: { $exists: false },
    });
    if (!document) {
      observed = await readTarget();
      owner = ownerOf(observed);
      if (owner?.key === plan.receipt && owner.outcome === "applied") replayed = true;
      else if (owner && owner.key !== plan.receipt) return busy(owner);
      else {
        if (!plan.receiptProtocol && !owner)
          return pending("Legacy atomic outcome has no surviving receipt; reconciliation required");
        return refuse("Atomic document guard refused; no money moved");
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
          (after < 0 && !(plan.cashMode === "central_bank_reserve_pool" && delta > 0)) ||
          Math.abs(after - before - delta) >
            Math.max(
              1e-7,
              Number.EPSILON * (Math.abs(before) + Math.abs(after) + Math.abs(delta)) * 8
            )
        ) {
          const error = `Atomic projection does not implement journal balance delta at ${path}`;
          return refuse(error);
        }
        balanceGuards[path] = value === undefined ? { $exists: false } : value;
      }
      if (plan.nonCashMode === "central_bank_bond_exchange") {
        const paths = ["publicFloat", "centralBankHoldings"];
        const before = paths.map((path) => Number(at(document, path) ?? 0));
        const after = paths.map((path) => balanceAfter(document, plan.update, path));
        if (
          [...before, ...after].some((value) => !Number.isSafeInteger(value) || value < 0) ||
          before[0] + before[1] !== after[0] + after[1]
        ) {
          const error = "Atomic bond exchange must conserve nonnegative whole units";
          return refuse(error);
        }
        for (const path of paths) {
          const value = at(document, path);
          balanceGuards[path] =
            value === undefined ? { $exists: false } : { $eq: value, $exists: true };
        }
      }
      const changed = await collection.updateOne(
        {
          $and: [
            plan.identity,
            plan.guard,
            balanceGuards,
            { [SETTLED_KEYS_FIELD]: plan.receiptGuard },
            { [SETTLED_KEYS_FIELD]: { $ne: plan.receipt } },
            { [PROTECTED_RECEIPT]: { $exists: false } },
          ],
        } as Filter<Document>,
        {
          ...plan.update,
          $set: {
            ...plan.update.$set,
            [PROTECTED_RECEIPT]: { key: plan.receipt, journalKey: key, outcome: "applied" },
          },
          $push: { [SETTLED_KEYS_FIELD]: { $each: [plan.receipt], $slice: -SETTLED_KEYS_CAP } },
        } as unknown as UpdateFilter<Document>
      );
      if (changed.matchedCount !== 1) {
        observed = await readTarget();
        owner = ownerOf(observed);
        replayed = owner?.key === plan.receipt && owner.outcome === "applied";
        if (!replayed) {
          if (owner && owner.key !== plan.receipt) return busy(owner);
          return refuse("Atomic document changed before delivery; no money moved");
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
  await journal.updateOne(
    { _id: key, status: record.status, legs: record.legs, projections: record.projections },
    { $set: completed, $unset: { error: "" } }
  );
  const current = await journal.findOne({ _id: key });
  if (!current || !isComplete(current))
    return pending("Atomic cash receipt remains protected until journal completion is confirmed");
  await release();
  return {
    status: replayed ? "replayed" : "applied",
    key,
    appliedLegs: record.legs.map((_leg, index) => index),
    appliedProjections: record.projections.map((_projection, index) => index),
    newlyAppliedProjections: replayed ? [] : record.projections.map((_projection, index) => index),
  };
}
