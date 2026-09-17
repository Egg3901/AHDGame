import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import {
  applyStateOrgBuildSpend,
  buildStateOrgBuildFingerprint,
  type StateOrgBuildSpendInput,
} from "./stateOrgBuildSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Strict stateful fakes honoring exactly the operators the state-org build
// primitive emits: keyed `updateOne` ($inc, $set, $push+$each+$slice key
// records, $gte/$ne guards), `findOne` by `_id` or { characterId, stateId },
// `findOneAndUpdate` upsert with E11000 on the { characterId, stateId }
// unique index, and receipt insertOne/findOne/updateOne. The REAL money-flow
// primitives run here (only the transaction probe is mocked), so an injected
// crash between any two writes models a real process death between the
// corresponding sequential Mongo writes.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

function docKey(id: unknown): string {
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node as Doc)?.[part], doc);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Doc;
  }
  node[parts[parts.length - 1]!] = value;
}

function cloneDoc(doc: Doc): Doc {
  const out: Doc = { ...doc };
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = [...v];
    else if (
      v !== null &&
      typeof v === "object" &&
      !(v instanceof ObjectId) &&
      !(v instanceof Date)
    ) {
      out[k] = { ...(v as Doc) };
    }
  }
  return out;
}

function matchesCondition(actual: unknown, condition: unknown): boolean {
  if (condition instanceof ObjectId || condition instanceof Date) {
    if (actual instanceof ObjectId && condition instanceof ObjectId)
      return actual.equals(condition);
    if (actual instanceof Date && condition instanceof Date) {
      return actual.getTime() === condition.getTime();
    }
    return actual === condition;
  }
  if (condition !== null && typeof condition === "object") {
    const ops = condition as Record<string, unknown>;
    for (const [op, want] of Object.entries(ops)) {
      if (op === "$gte") {
        if (!((actual as number) >= (want as number))) return false;
      } else if (op === "$gt") {
        if (!((actual as number) > (want as number))) return false;
      } else if (op === "$lt") {
        if (actual instanceof Date && want instanceof Date) {
          if (!(actual.getTime() < want.getTime())) return false;
        } else if (!((actual as number) < (want as number))) return false;
      } else if (op === "$lte") {
        if (!((actual as number) <= (want as number))) return false;
      } else if (op === "$exists") {
        const exists = actual !== undefined;
        if (exists !== (want as boolean)) return false;
      } else if (op === "$ne") {
        if (Array.isArray(actual)) {
          if (actual.includes(want)) return false;
        } else if (actual instanceof ObjectId && want instanceof ObjectId) {
          if (actual.equals(want)) return false;
        } else if (actual === want) return false;
      } else {
        throw new Error(`fake does not implement operator ${op}`);
      }
    }
    return true;
  }
  if (actual instanceof ObjectId && condition instanceof ObjectId) return actual.equals(condition);
  if (actual instanceof Date && condition instanceof Date) {
    return actual.getTime() === condition.getTime();
  }
  return actual === condition;
}

function matchesOr(doc: Doc, clauses: unknown): boolean {
  if (!Array.isArray(clauses)) throw new Error("fake $or needs an array");
  return (clauses as Array<Record<string, unknown>>).some((clause) => matchesFilter(doc, clause));
}

function matchesAnd(doc: Doc, clauses: unknown): boolean {
  if (!Array.isArray(clauses)) throw new Error("fake $and needs an array");
  return (clauses as Array<Record<string, unknown>>).every((clause) => matchesFilter(doc, clause));
}

function matchesFilter(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "$or") {
      if (!matchesOr(doc, condition)) return false;
    } else if (field === "$and") {
      if (!matchesAnd(doc, condition)) return false;
    } else {
      const actual = field === "_id" ? doc._id : getPath(doc, field);
      if (!matchesCondition(actual, condition)) return false;
    }
  }
  return true;
}

function applyUpdate(doc: Doc, update: Record<string, unknown>, isInsert: boolean): void {
  for (const [op, clause] of Object.entries(update)) {
    if (op === "$inc") {
      for (const [field, delta] of Object.entries(clause as Record<string, number>)) {
        setPath(doc, field, ((getPath(doc, field) as number) ?? 0) + delta);
      }
    } else if (op === "$set") {
      for (const [field, value] of Object.entries(clause as Record<string, unknown>)) {
        setPath(doc, field, value);
      }
    } else if (op === "$setOnInsert") {
      if (isInsert) {
        for (const [field, value] of Object.entries(clause as Record<string, unknown>)) {
          if (getPath(doc, field) === undefined) setPath(doc, field, value);
        }
      }
    } else if (op === "$push") {
      for (const [field, spec] of Object.entries(clause as Record<string, Doc>)) {
        const arr = (getPath(doc, field) as unknown[]) ?? [];
        const next = [...arr, ...(spec.$each as unknown[])];
        const slice = spec.$slice as number | undefined;
        setPath(doc, field, typeof slice === "number" && slice < 0 ? next.slice(slice) : next);
      }
    } else {
      throw new Error(`fake does not implement update operator ${op}`);
    }
  }
}

function duplicateKeyError(): MongoServerError {
  const err = new MongoServerError({
    message:
      "E11000 duplicate key error collection: test.characterStateOrg index: characterId_1_stateId_1",
  });
  err.code = 11000;
  err.keyPattern = { characterId: 1, stateId: 1 };
  return err;
}

interface CrashPoint {
  collection: string;
  op: string;
  times: number;
}

function createHarness() {
  const campaigns = new Map<string, Doc>();
  const orgs = new Map<string, Doc>();
  const receipts = new Map<string, Doc>();
  const crashPoints: CrashPoint[] = [];
  const writes: string[] = [];

  const maybeCrash = (collection: string, op: string) => {
    writes.push(`${collection}.${op}`);
    const point = crashPoints.find(
      (p) => p.collection === collection && p.op === op && p.times > 0
    );
    if (point) {
      point.times -= 1;
      throw new Error("CRASH");
    }
  };

  const orgCompoundKey = (characterId: unknown, stateId: unknown) =>
    `${docKey(characterId)}:${String(stateId)}`;

  const campaignsCol = {
    updateOne: vi.fn(async (filter: Doc, update: Doc) => {
      maybeCrash("campaigns", "updateOne");
      for (const doc of campaigns.values()) {
        if (matchesFilter(doc, filter)) {
          applyUpdate(doc, update, false);
          return { matchedCount: 1, modifiedCount: 1 };
        }
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }),
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of campaigns.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
  };

  const orgsCol = {
    findOneAndUpdate: vi.fn(async (filter: Doc, update: Doc, options: Doc) => {
      maybeCrash("characterStateOrg", "findOneAndUpdate");
      for (const doc of orgs.values()) {
        if (matchesFilter(doc, filter)) {
          applyUpdate(doc, update, false);
          return cloneDoc(doc);
        }
      }
      if (options?.upsert) {
        const characterId = filter.characterId as ObjectId;
        const stateId = filter.stateId as string;
        // The unique index on { characterId, stateId }: a doc that exists
        // but missed the throttle/level/key guards turns the upsert-insert
        // into E11000, exactly like production.
        if (orgs.has(orgCompoundKey(characterId, stateId))) throw duplicateKeyError();
        const doc: Doc = { _id: new ObjectId() };
        applyUpdate(doc, update, true);
        orgs.set(orgCompoundKey(characterId, stateId), doc);
        return cloneDoc(doc);
      }
      return null;
    }),
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of orgs.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
  };

  const receiptsCol = {
    insertOne: vi.fn(async (doc: Doc) => {
      maybeCrash("receipts", "insertOne");
      const id = String(doc._id);
      if (receipts.has(id)) {
        const err = new MongoServerError({ message: `E11000 duplicate key: ${id}` });
        err.code = 11000;
        throw err;
      }
      receipts.set(id, cloneDoc(doc));
      return { insertedId: doc._id };
    }),
    findOne: vi.fn(async (filter: Doc) => {
      const doc = receipts.get(String(filter._id));
      return doc ? cloneDoc(doc) : null;
    }),
    updateOne: vi.fn(async (filter: Doc, update: Doc) => {
      maybeCrash("receipts", "updateOne");
      const doc = receipts.get(String(filter._id));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(doc, update, false);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "campaigns") return campaignsCol;
      if (name === "characterStateOrg") return orgsCol;
      if (name === "nonAtomicMoneyFlowReceipts") return receiptsCol;
      throw new Error(`fake db has no collection ${name}`);
    }),
  } as unknown as Db;

  return { db, campaigns, orgs, receipts, crashPoints, writes, campaignsCol, orgsCol, receiptsCol };
}

describe("applyStateOrgBuildSpend", () => {
  const campaignId = new ObjectId();
  const characterId = new ObjectId();
  const cutoff = new Date("2026-06-30T12:00:00.000Z");
  const ACTION_COST = 3;
  const FUND_COST = 250_000;

  const input = (over: Partial<StateOrgBuildSpendInput> = {}): StateOrgBuildSpendInput => ({
    campaignId,
    characterId,
    stateId: "PA",
    currentLevel: 0,
    actionCost: ACTION_COST,
    fundCostLocal: FUND_COST,
    throttleCutoff: cutoff,
    fingerprint: buildStateOrgBuildFingerprint({
      characterId,
      stateId: "PA",
      currentLevel: 0,
      actionCost: ACTION_COST,
      fundCostLocal: FUND_COST,
      throttleCutoff: cutoff,
    }),
    idempotencyKey: `test-key-${new ObjectId().toHexString()}`,
    ...over,
  });

  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    h = createHarness();
    h.campaigns.set(docKey(campaignId), {
      _id: campaignId,
      actions: 50,
      funds: 100_000_000,
    });
  });

  it("builds the first level on a fresh doc and settles completed", async () => {
    const out = await applyStateOrgBuildSpend(h.db, input({ idempotencyKey: "fresh-build-1" }));
    expect(out).toEqual({ duplicate: false, level: 1, totalInvested: ACTION_COST });

    const campaign = h.campaigns.get(docKey(campaignId))!;
    expect(campaign.actions).toBe(47);
    expect(campaign.funds).toBe(100_000_000 - FUND_COST);
    expect(campaign.appliedMoneyFlowKeys).toEqual(["fresh-build-1"]);

    const org = h.orgs.get(`${characterId.toHexString()}:PA`)!;
    expect(org.level).toBe(1);
    expect(org.totalInvested).toBe(ACTION_COST);
    expect(org.appliedMoneyFlowKeys).toEqual(["fresh-build-1"]);

    expect(h.receipts.get("fresh-build-1")?.status).toBe("completed");
  });

  it("increments an existing doc past the throttle cutoff", async () => {
    h.orgs.set(`${characterId.toHexString()}:PA`, {
      _id: new ObjectId(),
      characterId,
      stateId: "PA",
      level: 7,
      totalInvested: 21,
      updatedAt: new Date(cutoff.getTime() - 1000),
    });
    const in7 = input({ idempotencyKey: "level-8", currentLevel: 7, fundCostLocal: 828_200 });
    in7.fingerprint = buildStateOrgBuildFingerprint({
      characterId,
      stateId: "PA",
      currentLevel: 7,
      actionCost: ACTION_COST,
      fundCostLocal: 828_200,
      throttleCutoff: cutoff,
    });
    const out = await applyStateOrgBuildSpend(h.db, in7);
    expect(out).toEqual({ duplicate: false, level: 8, totalInvested: 24 });
  });

  it("crash between debit and org converges on retry with one charge and one level", async () => {
    const key = "crash-debit-org";
    h.crashPoints.push({ collection: "characterStateOrg", op: "findOneAndUpdate", times: 1 });
    await expect(applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }))).rejects.toThrow(
      "CRASH"
    );
    expect(h.receipts.get(key)?.status).toBe("in_progress");

    const out = await applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }));
    expect(out.duplicate).toBe(true);
    expect(out.level).toBe(1);

    const campaign = h.campaigns.get(docKey(campaignId))!;
    expect(campaign.actions).toBe(47);
    expect(campaign.funds).toBe(100_000_000 - FUND_COST);
    expect(h.receipts.get(key)?.status).toBe("completed");
  });

  it("crash after org before settle converges without stacking a second level", async () => {
    const key = "crash-org-settle";
    h.crashPoints.push({ collection: "receipts", op: "updateOne", times: 1 });
    await expect(applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }))).rejects.toThrow(
      "CRASH"
    );

    const out = await applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }));
    expect(out.duplicate).toBe(true);
    expect(out).toMatchObject({ level: 1, totalInvested: ACTION_COST });

    const org = h.orgs.get(`${characterId.toHexString()}:PA`)!;
    expect(org.level).toBe(1);
    const campaign = h.campaigns.get(docKey(campaignId))!;
    expect(campaign.actions).toBe(47);
    expect(h.receipts.get(key)?.status).toBe("completed");
  });

  it("replays a completed key without charging again", async () => {
    const key = "replay-key";
    const first = await applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }));
    expect(first.duplicate).toBe(false);
    const debitCalls = h.campaignsCol.updateOne.mock.calls.length;

    const second = await applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }));
    expect(second).toEqual({ duplicate: true, level: 1, totalInvested: ACTION_COST });
    expect(h.campaignsCol.updateOne.mock.calls.length).toBe(debitCalls);
    expect(h.campaigns.get(docKey(campaignId))!.actions).toBe(47);
  });

  it("a settled compensated key fails closed on retry", async () => {
    const key = "terminal-key";
    // Another build already took this turn: the org guard rejects, the debit
    // prefix compensates, the receipt settles compensated.
    h.orgs.set(`${characterId.toHexString()}:PA`, {
      _id: new ObjectId(),
      characterId,
      stateId: "PA",
      level: 1,
      totalInvested: ACTION_COST,
      updatedAt: new Date(cutoff.getTime() + 1000),
    });
    await expect(applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }))).rejects.toThrow(
      /ORG_RACE_OR_THROTTLE/
    );
    expect(h.receipts.get(key)?.status).toBe("compensated");

    await expect(applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }))).rejects.toThrow(
      MoneyFlowTerminalError
    );
  });

  it("rejects the same key with a different fingerprint", async () => {
    const key = "conflict-key";
    await applyStateOrgBuildSpend(h.db, input({ idempotencyKey: key }));
    await expect(
      applyStateOrgBuildSpend(
        h.db,
        input({ idempotencyKey: key, fingerprint: "char:PA:level:9:actions:3:funds:1:cutoff:2" })
      )
    ).rejects.toThrow(MoneyFlowKeyConflictError);
    // The conflicted retry charged nothing further.
    expect(h.campaigns.get(docKey(campaignId))!.actions).toBe(47);
  });

  it("a stale-price concurrent build compensates the debit and reports the race", async () => {
    h.orgs.set(`${characterId.toHexString()}:PA`, {
      _id: new ObjectId(),
      characterId,
      stateId: "PA",
      level: 4,
      totalInvested: 12,
      updatedAt: new Date(cutoff.getTime() - 1000),
    });
    // Priced off level 0 while the stored level is 4: the level guard misses,
    // E11000 disambiguates to guard-rejected (different key), debit refunds.
    await expect(
      applyStateOrgBuildSpend(h.db, input({ idempotencyKey: "stale-price" }))
    ).rejects.toThrow(/ORG_RACE_OR_THROTTLE/);

    const campaign = h.campaigns.get(docKey(campaignId))!;
    expect(campaign.actions).toBe(50);
    expect(campaign.funds).toBe(100_000_000);
    const org = h.orgs.get(`${characterId.toHexString()}:PA`)!;
    expect(org.level).toBe(4);
    expect(h.receipts.get("stale-price")?.status).toBe("compensated");
  });

  it("an insufficient debit settles failed without touching the org", async () => {
    h.campaigns.set(docKey(campaignId), { _id: campaignId, actions: 50, funds: 100 });
    await expect(
      applyStateOrgBuildSpend(h.db, input({ idempotencyKey: "broke-key" }))
    ).rejects.toThrow(/INSUFFICIENT_RESOURCES/);
    expect(h.orgs.size).toBe(0);
    expect(h.receipts.get("broke-key")?.status).toBe("failed");
  });

  it("debits a fractional FX cost exactly and replays on the same float", async () => {
    const cost = 250_000 * 1.037;
    const key = "fx-fractional";
    const fx = input({ idempotencyKey: key, fundCostLocal: cost });
    fx.fingerprint = buildStateOrgBuildFingerprint({
      characterId,
      stateId: "PA",
      currentLevel: 0,
      actionCost: ACTION_COST,
      fundCostLocal: cost,
      throttleCutoff: cutoff,
    });
    const out = await applyStateOrgBuildSpend(h.db, fx);
    expect(out.duplicate).toBe(false);
    // No rounding on the write: the stored debit is the exact priced float.
    expect(h.campaigns.get(docKey(campaignId))!.funds).toBe(100_000_000 - cost);

    const replay = await applyStateOrgBuildSpend(h.db, fx);
    // A different float serializes differently, so the fingerprint must carry
    // the exact value: same float converges, and the charge applied once.
    expect(replay.duplicate).toBe(true);
    expect(h.campaigns.get(docKey(campaignId))!.funds).toBe(100_000_000 - cost);
  });

  it("applies when funds exactly equal the cost", async () => {
    h.campaigns.set(docKey(campaignId), { _id: campaignId, actions: 3, funds: FUND_COST });
    const out = await applyStateOrgBuildSpend(h.db, input({ idempotencyKey: "exact-funds" }));
    expect(out.level).toBe(1);
    expect(h.campaigns.get(docKey(campaignId))).toMatchObject({ actions: 0, funds: 0 });
  });

  it("validates inputs", async () => {
    await expect(applyStateOrgBuildSpend(h.db, input({ idempotencyKey: "" }))).rejects.toThrow(
      RangeError
    );
    await expect(applyStateOrgBuildSpend(h.db, input({ fundCostLocal: 0 }))).rejects.toThrow(
      RangeError
    );
    await expect(applyStateOrgBuildSpend(h.db, input({ actionCost: -1 }))).rejects.toThrow(
      RangeError
    );
    await expect(
      applyStateOrgBuildSpend(h.db, input({ throttleCutoff: new Date("invalid") }))
    ).rejects.toThrow(TypeError);
  });

  it("builds a stable fingerprint from the priced build", () => {
    const a = buildStateOrgBuildFingerprint({
      characterId,
      stateId: "PA",
      currentLevel: 2,
      actionCost: ACTION_COST,
      fundCostLocal: 100,
      throttleCutoff: cutoff,
    });
    const b = buildStateOrgBuildFingerprint({
      characterId,
      stateId: "PA",
      currentLevel: 2,
      actionCost: ACTION_COST,
      fundCostLocal: 100,
      throttleCutoff: new Date(cutoff.getTime()),
    });
    expect(a).toBe(b);
    expect(a).toContain("PA");
  });
});
