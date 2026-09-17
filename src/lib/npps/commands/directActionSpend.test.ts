import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyDirectActionSpend,
  buildDirectActionFingerprint,
  DirectActionBalanceConflictError,
  type DirectActionSpendInput,
} from "./directActionSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Strict stateful fakes honoring exactly the operators the direct-action
// spend primitive emits: keyed `updateOne` ($inc, $set, $push+$each+$slice key
// records, $gte/$ne/$in guards), upsert `updateOne` with E11000 on the
// relationship `_id`, keyed `applyKeyedUpdate` writes, deterministic inserts
// with E11000 convergence, `replaceOne`/`deleteOne` reverts, `updateMany`
// stale-withdrawal, and receipt insertOne/findOne/updateOne. The REAL
// money-flow primitives run here (only the transaction probe is mocked), so
// an injected crash between any two writes models a real process death
// between the corresponding sequential Mongo writes.
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

function deletePath(doc: Doc, path: string): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]!] as Doc | undefined;
    if (typeof next !== "object" || next === null) return;
    node = next;
  }
  delete node[parts[parts.length - 1]!];
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

function valuesEqual(actual: unknown, want: unknown): boolean {
  if (actual instanceof ObjectId && want instanceof ObjectId) return actual.equals(want);
  if (actual instanceof Date && want instanceof Date) return actual.getTime() === want.getTime();
  if (Array.isArray(actual) && Array.isArray(want)) {
    return actual.length === want.length && actual.every((v, i) => valuesEqual(v, want[i]));
  }
  return actual === want;
}

function matchesCondition(actual: unknown, condition: unknown): boolean {
  if (condition instanceof ObjectId || condition instanceof Date) {
    return valuesEqual(actual, condition);
  }
  if (condition !== null && typeof condition === "object") {
    const ops = condition as Record<string, unknown>;
    for (const [op, want] of Object.entries(ops)) {
      if (op === "$gte") {
        if (!((actual as number) >= (want as number))) return false;
      } else if (op === "$ne") {
        if (Array.isArray(actual)) {
          if (actual.includes(want)) return false;
        } else if (valuesEqual(actual, want)) return false;
      } else if (op === "$in") {
        if (!Array.isArray(want) || !want.some((v) => valuesEqual(actual, v))) return false;
      } else if (op === "$exists") {
        if ((actual !== undefined) !== (want as boolean)) return false;
      } else {
        throw new Error(`fake does not implement operator ${op}`);
      }
    }
    return true;
  }
  return valuesEqual(actual, condition);
}

function matchesFilter(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    const actual = field === "_id" ? doc._id : getPath(doc, field);
    if (!matchesCondition(actual, condition)) return false;
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
    } else if (op === "$unset") {
      for (const field of Object.keys(clause as Record<string, unknown>)) {
        deletePath(doc, field);
      }
    } else {
      throw new Error(`fake does not implement update operator ${op}`);
    }
  }
}

function duplicateKeyError(id: unknown): Error & { code?: number } {
  const err = new Error(`E11000 duplicate key error: ${String(id)}`) as Error & { code?: number };
  err.code = 11000;
  return err;
}

interface CrashPoint {
  collection: string;
  op: string;
  times: number;
}

function createHarness() {
  const characters = new Map<string, Doc>();
  const relationships = new Map<string, Doc>();
  const endorsements = new Map<string, Doc>();
  const npps = new Map<string, Doc>();
  const candidates = new Map<string, Doc>();
  const elections = new Map<string, Doc>();
  const logs = new Map<string, Doc>();
  const receipts = new Map<string, Doc>();
  const crashPoints: CrashPoint[] = [];

  const maybeCrash = (collection: string, op: string) => {
    const point = crashPoints.find(
      (p) => p.collection === collection && p.op === op && p.times > 0
    );
    if (point) {
      point.times -= 1;
      throw new Error("CRASH");
    }
  };

  const updateOneMatch = (store: Map<string, Doc>, filter: Doc, update: Doc) => {
    for (const doc of store.values()) {
      if (matchesFilter(doc, filter)) {
        applyUpdate(doc, update, false);
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  };

  const charactersCol = {
    updateOne: vi.fn(async (filter: Doc, update: Doc) => {
      maybeCrash("characters", "updateOne");
      return updateOneMatch(characters, filter, update);
    }),
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of characters.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
  };

  const relationshipsCol = {
    updateOne: vi.fn(async (filter: Doc, update: Doc, options: Doc = {}) => {
      maybeCrash("nppRelationships", "updateOne");
      for (const doc of relationships.values()) {
        if (matchesFilter(doc, filter)) {
          applyUpdate(doc, update, false);
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
      }
      if (options?.upsert) {
        // Unique index on `_id`: a doc that exists but missed the key guard
        // turns the upsert-insert into E11000, exactly like production.
        if (relationships.has(String(filter._id))) throw duplicateKeyError(filter._id);
        const doc: Doc = { _id: filter._id };
        applyUpdate(doc, update, true);
        relationships.set(String(filter._id), doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }),
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of relationships.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
    replaceOne: vi.fn(async (filter: Doc, replacement: Doc) => {
      maybeCrash("nppRelationships", "replaceOne");
      const id = String(filter._id);
      if (!relationships.has(id)) return { matchedCount: 0, modifiedCount: 0 };
      relationships.set(id, cloneDoc(replacement));
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    deleteOne: vi.fn(async (filter: Doc) => {
      maybeCrash("nppRelationships", "deleteOne");
      return { deletedCount: relationships.delete(String(filter._id)) ? 1 : 0 };
    }),
  };

  const endorsementsCol = {
    find: vi.fn((filter: Doc) => ({
      toArray: async () => {
        const out: Doc[] = [];
        for (const doc of endorsements.values()) {
          if (matchesFilter(doc, filter)) out.push(cloneDoc(doc));
        }
        return out;
      },
    })),
    updateOne: vi.fn(async (filter: Doc, update: Doc) => {
      maybeCrash("nppEndorsements", "updateOne");
      return updateOneMatch(endorsements, filter, update);
    }),
    insertOne: vi.fn(async (doc: Doc) => {
      maybeCrash("nppEndorsements", "insertOne");
      const id = docKey(doc._id);
      if (endorsements.has(id)) throw duplicateKeyError(doc._id);
      endorsements.set(id, cloneDoc(doc));
      return { insertedId: doc._id };
    }),
    updateMany: vi.fn(async (filter: Doc, update: Doc) => {
      maybeCrash("nppEndorsements", "updateMany");
      let matched = 0;
      for (const doc of endorsements.values()) {
        if (matchesFilter(doc, filter)) {
          applyUpdate(doc, update, false);
          matched += 1;
        }
      }
      return { matchedCount: matched, modifiedCount: matched };
    }),
    deleteOne: vi.fn(async (filter: Doc) => {
      maybeCrash("nppEndorsements", "deleteOne");
      return { deletedCount: endorsements.delete(docKey(filter._id)) ? 1 : 0 };
    }),
  };

  const nppsCol = {
    updateOne: vi.fn(async (filter: Doc, update: Doc) => {
      maybeCrash("npps", "updateOne");
      return updateOneMatch(npps, filter, update);
    }),
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of npps.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
  };

  const candidatesCol = {
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of candidates.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
    countDocuments: vi.fn(async (filter: Doc) => {
      let n = 0;
      for (const doc of candidates.values()) {
        if (matchesFilter(doc, filter)) n += 1;
      }
      return n;
    }),
  };

  const electionsCol = {
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of elections.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
  };

  const logsCol = {
    insertOne: vi.fn(async (doc: Doc) => {
      maybeCrash("capitalActionLogs", "insertOne");
      const id = docKey(doc._id);
      if (logs.has(id)) throw duplicateKeyError(doc._id);
      logs.set(id, cloneDoc(doc));
      return { insertedId: doc._id };
    }),
    findOne: vi.fn(async (filter: Doc) => {
      for (const doc of logs.values()) {
        if (matchesFilter(doc, filter)) return cloneDoc(doc);
      }
      return null;
    }),
  };

  const receiptsCol = {
    insertOne: vi.fn(async (doc: Doc) => {
      maybeCrash("receipts", "insertOne");
      const id = String(doc._id);
      if (receipts.has(id)) throw duplicateKeyError(doc._id);
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
      if (name === "characters") return charactersCol;
      if (name === "nppRelationships") return relationshipsCol;
      if (name === "nppEndorsements") return endorsementsCol;
      if (name === "npps") return nppsCol;
      if (name === "electionCandidates") return candidatesCol;
      if (name === "elections") return electionsCol;
      if (name === "capitalActionLogs") return logsCol;
      if (name === "nonAtomicMoneyFlowReceipts") return receiptsCol;
      throw new Error(`fake db has no collection ${name}`);
    }),
  } as unknown as Db;

  return {
    db,
    characters,
    relationships,
    endorsements,
    npps,
    candidates,
    elections,
    logs,
    receipts,
    crashPoints,
    charactersCol,
    relationshipsCol,
    endorsementsCol,
    nppsCol,
    logsCol,
    receiptsCol,
  };
}

describe("applyDirectActionSpend", () => {
  const NOW = new Date("2026-09-01T12:00:00.000Z");
  const PRIOR_UPDATED = new Date("2026-08-01T12:00:00.000Z");
  const characterId = new ObjectId();
  const nppId = new ObjectId();
  const candidacyId = new ObjectId();
  const electionId = new ObjectId();
  const relationshipKey = `${characterId.toHexString()}_${nppId.toHexString()}`;

  const boostInput = (over: Partial<DirectActionSpendInput> = {}): DirectActionSpendInput => ({
    characterId,
    nppId,
    nppName: "Target NPP",
    relationshipKey,
    action: "boost_favorability",
    actionCost: 5,
    fundCostLocal: 10000,
    fundsField: "funds",
    relationshipDelta: 2,
    relationshipBefore: 10,
    relationshipAfter: 12,
    lastAttemptTurn: 7,
    priorRelationship: null,
    favorUpdate: {
      favorability: 63,
      politicalInfluence: 40,
      updatedAt: NOW,
      prior: { favorability: 60, politicalInfluence: 40, updatedAt: PRIOR_UPDATED },
    },
    endorsement: null,
    log: {
      actionsSpent: 5,
      fundsSpentAnchor: 10000,
      effectSummary: "Favorability boosted.",
      turn: 7,
      context: {},
    },
    now: NOW,
    fingerprint: "fp-boost",
    ...over,
  });

  const endorsementInput = (
    over: Partial<DirectActionSpendInput> = {}
  ): DirectActionSpendInput => ({
    characterId,
    nppId,
    nppName: "Target NPP",
    relationshipKey,
    action: "request_endorsement",
    actionCost: 6,
    fundCostLocal: 0,
    fundsField: "funds",
    relationshipDelta: 0,
    relationshipBefore: 10,
    relationshipAfter: 10,
    lastAttemptTurn: 7,
    priorRelationship: null,
    favorUpdate: null,
    endorsement: {
      candidacyId: candidacyId.toHexString(),
      arrangedByParty: "1",
      now: NOW,
      currentTurn: 7,
      priorActive: [],
    },
    log: {
      actionsSpent: 6,
      fundsSpentAnchor: 0,
      effectSummary: "Public endorsement secured.",
      turn: 7,
      context: { candidacyId },
    },
    now: NOW,
    fingerprint: "fp-endorse",
    ...over,
  });

  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    h = createHarness();
    h.characters.set(characterId.toHexString(), {
      _id: characterId,
      actions: 100,
      funds: 50000,
      countryId: "US",
    });
    h.npps.set(nppId.toHexString(), {
      _id: nppId,
      favorability: 60,
      politicalInfluence: 40,
      updatedAt: PRIOR_UPDATED,
    });
    h.candidates.set(candidacyId.toHexString(), {
      _id: candidacyId,
      electionId,
      characterId,
      characterName: "Player Candidate",
      status: "active",
      isNPP: false,
    });
    h.elections.set(electionId.toHexString(), {
      _id: electionId,
      primaryEndTime: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  it("applies a funded boost exactly once and reports the stored outcome", async () => {
    const out = await applyDirectActionSpend(h.db, boostInput({ idempotencyKey: "boost-1" }));

    expect(out).toEqual({
      duplicate: false,
      success: true,
      effect: "Favorability boosted.",
      action: "boost_favorability",
      actions: { current: 95, spent: 5 },
      funds: { current: 40000, spent: 10000 },
      homeCurrency: "USD",
      currencySymbol: "$",
      relationship: { before: 10, after: 12, delta: 2 },
    });

    const character = h.characters.get(characterId.toHexString())!;
    expect(character.actions).toBe(95);
    expect(character.funds).toBe(40000);
    expect(character.appliedMoneyFlowKeys).toEqual(["boost-1"]);

    const rel = h.relationships.get(relationshipKey)!;
    expect(rel.relationshipScore).toBe(12);
    expect(rel.lastAttemptTurn).toBe(7);
    expect(rel.totalAttempts).toBe(1);
    expect(rel.successfulAttempts).toBe(1);
    expect(rel.appliedMoneyFlowKeys).toEqual(["boost-1"]);

    const npp = h.npps.get(nppId.toHexString())!;
    expect(npp.favorability).toBe(63);
    expect(npp.politicalInfluence).toBe(40);
    expect(npp.appliedMoneyFlowKeys).toEqual(["boost-1"]);

    expect(h.logs.size).toBe(1);
    const log = [...h.logs.values()][0]!;
    expect(log.actionsSpent).toBe(5);
    expect(log.fundsSpent).toBe(10000);
    expect(log.relationshipBefore).toBe(10);
    expect(log.relationshipAfter).toBe(12);
    expect(h.receipts.get("boost-1")?.status).toBe("completed");
  });

  it("arranges an endorsement through the actions-only leg and withdraws stale rows", async () => {
    const staleId = new ObjectId();
    h.endorsements.set(staleId.toHexString(), {
      _id: staleId,
      nppId,
      electionId,
      candidateId: new ObjectId(),
      isActive: true,
      createdAt: PRIOR_UPDATED,
    });

    const inFlight = endorsementInput({ idempotencyKey: "endorse-1" });
    inFlight.endorsement!.priorActive = [
      { ...h.endorsements.get(staleId.toHexString())! } as never,
    ];
    const out = await applyDirectActionSpend(h.db, inFlight);

    expect(out.duplicate).toBe(false);
    expect(out.actions).toEqual({ current: 94, spent: 6 });
    // Zero-cash leg leaves the funds balance untouched.
    expect(h.characters.get(characterId.toHexString())!.funds).toBe(50000);

    const active = [...h.endorsements.values()].filter((row) => row.isActive);
    expect(active).toHaveLength(1);
    const row = active[0]!;
    expect(row.candidateId).toEqual(characterId);
    expect(row.source).toBe("arranged");
    expect(row.arrangedBy).toEqual(characterId);
    expect(row.arrangedByParty).toBe("1");
    expect(row.lastEvaluatedTurn).toBe(7);
    expect(row.reevaluateAfterTurn).toBe(11);

    const stale = h.endorsements.get(staleId.toHexString())!;
    expect(stale.isActive).toBe(false);
    expect(stale.withdrawnReason).toBe("switched");
  });

  it("fails the zero-cash leg exactly like the historical guard when the funds field is missing", async () => {
    // Historical filter asserted `[fundsField]: { $gte: 0 }` even for
    // zero-cash actions, so a character missing the field conflicted.
    const doc = h.characters.get(characterId.toHexString())!;
    delete doc.funds;
    await expect(
      applyDirectActionSpend(h.db, endorsementInput({ idempotencyKey: "endorse-nofunds" }))
    ).rejects.toBeInstanceOf(DirectActionBalanceConflictError);
    expect(h.receipts.get("endorse-nofunds")?.status).toBe("failed");
  });

  // Each crash point must fire on its flow: the endorsement insert only runs
  // on the endorsement flow, the NPP write only on the favor flow.
  it.each([
    ["characters", "updateOne", "boost"],
    ["nppRelationships", "updateOne", "boost"],
    ["nppEndorsements", "insertOne", "endorse"],
    ["nppEndorsements", "updateMany", "endorse"],
    ["npps", "updateOne", "boost"],
    ["receipts", "updateOne", "endorse"],
  ])("crash at %s.%s converges on retry with exactly one charge", async (collection, op, flow) => {
    const key = `crash-${collection}-${op}`;
    const inFlight =
      flow === "boost"
        ? boostInput({ idempotencyKey: key, fingerprint: `fp-${key}` })
        : endorsementInput({ idempotencyKey: key, fingerprint: `fp-${key}` });
    if (flow === "endorse") {
      // A stale row forces the withdrawal updateMany to run, so tail-write
      // crash points actually fire.
      const staleId = new ObjectId();
      h.endorsements.set(staleId.toHexString(), {
        _id: staleId,
        nppId,
        electionId,
        candidateId: new ObjectId(),
        isActive: true,
        createdAt: PRIOR_UPDATED,
      });
    }
    h.crashPoints.push({ collection, op, times: 1 });
    await expect(applyDirectActionSpend(h.db, inFlight)).rejects.toThrow("CRASH");
    expect(h.receipts.get(key)?.status).toBe("in_progress");

    const out = await applyDirectActionSpend(h.db, inFlight);
    expect(out.duplicate).toBe(true);
    if (flow === "boost") {
      expect(out.actions).toEqual({ current: 95, spent: 5 });
      expect(out.funds).toEqual({ current: 40000, spent: 10000 });
      expect(h.npps.get(nppId.toHexString())!.favorability).toBe(63);
    } else {
      expect(out.actions).toEqual({ current: 94, spent: 6 });
      expect([...h.endorsements.values()].filter((row) => row.isActive)).toHaveLength(1);
    }

    const character = h.characters.get(characterId.toHexString())!;
    expect(character.appliedMoneyFlowKeys).toEqual([key]);
    expect(h.relationships.get(relationshipKey)!.totalAttempts).toBe(1);
    expect(h.receipts.get(key)?.status).toBe("completed");
  });

  it("crash after the debit on a funded boost replays without double-charging", async () => {
    const key = "crash-boost-debit";
    h.crashPoints.push({ collection: "nppRelationships", op: "updateOne", times: 1 });
    await expect(
      applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key, fingerprint: `fp-${key}` }))
    ).rejects.toThrow("CRASH");

    const out = await applyDirectActionSpend(
      h.db,
      boostInput({ idempotencyKey: key, fingerprint: `fp-${key}` })
    );
    expect(out.funds).toEqual({ current: 40000, spent: 10000 });
    expect(h.characters.get(characterId.toHexString())!.funds).toBe(40000);
    expect(h.npps.get(nppId.toHexString())!.favorability).toBe(63);
    expect(h.receipts.get(key)?.status).toBe("completed");
  });

  it("replays a completed key without writing again", async () => {
    const key = "replay-1";
    const first = await applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key }));
    expect(first.duplicate).toBe(false);
    const debitCalls = h.charactersCol.updateOne.mock.calls.length;

    const second = await applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key }));
    expect(second.duplicate).toBe(true);
    expect({ ...second, duplicate: false }).toEqual(first);
    expect(h.charactersCol.updateOne.mock.calls.length).toBe(debitCalls);
    expect(h.characters.get(characterId.toHexString())!.actions).toBe(95);
    expect(h.relationships.get(relationshipKey)!.totalAttempts).toBe(1);
  });

  it("reports the stored outcome even after later actions moved the relationship", async () => {
    const key = "stored-1";
    const first = await applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key }));
    h.relationships.get(relationshipKey)!.relationshipScore = 99;

    const second = await applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key }));
    expect(second.duplicate).toBe(true);
    expect(second.relationship).toEqual(first.relationship);
    expect(second.relationship.after).toBe(12);
  });

  it("rejects a same-key retry with a different fingerprint", async () => {
    const key = "conflict-1";
    await applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key, fingerprint: "fp-a" }));
    await expect(
      applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key, fingerprint: "fp-b" }))
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(h.characters.get(characterId.toHexString())!.actions).toBe(95);
  });

  it("settles a rejected debit as failed and fails closed on retry", async () => {
    const key = "terminal-1";
    h.characters.get(characterId.toHexString())!.funds = 100;
    await expect(
      applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key }))
    ).rejects.toBeInstanceOf(DirectActionBalanceConflictError);
    expect(h.receipts.get(key)?.status).toBe("failed");
    expect(h.relationships.has(relationshipKey)).toBe(false);
    expect(h.logs.size).toBe(0);

    await expect(
      applyDirectActionSpend(h.db, boostInput({ idempotencyKey: key }))
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("converges concurrent same-key endorsement attempts onto one row and one charge", async () => {
    const key = "race-1";
    const makeCall = () =>
      applyDirectActionSpend(
        h.db,
        endorsementInput({ idempotencyKey: key, fingerprint: "fp-race" })
      );
    const [first, second] = await Promise.all([makeCall(), makeCall()]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(h.characters.get(characterId.toHexString())!.actions).toBe(94);
    expect(h.relationships.get(relationshipKey)!.totalAttempts).toBe(1);
    const active = [...h.endorsements.values()].filter((row) => row.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]!.candidateId).toEqual(characterId);
    expect(h.receipts.get(key)?.status).toBe("completed");
  });

  it("compensates the debit and restores the relationship when the NPP write cannot land", async () => {
    h.npps.clear();
    await expect(
      applyDirectActionSpend(h.db, boostInput({ idempotencyKey: "compensate-1" }))
    ).rejects.toThrow("DIRECT_ACTION_STEP_FAILED:npp-favor:missing");

    const character = h.characters.get(characterId.toHexString())!;
    expect(character.actions).toBe(100);
    expect(character.funds).toBe(50000);
    expect(h.relationships.has(relationshipKey)).toBe(false);
    expect(h.logs.size).toBe(0);
    const receipt = h.receipts.get("compensate-1")!;
    expect(receipt.status).toBe("compensated");
    expect(receipt.error).toMatch(/DIRECT_ACTION_STEP_FAILED/);
  });

  it("compensates the endorsement switch and reactivates the stale row", async () => {
    const staleId = new ObjectId();
    const staleRow = {
      _id: staleId,
      nppId,
      electionId,
      candidateId: new ObjectId(),
      isActive: true,
      createdAt: PRIOR_UPDATED,
    };
    h.endorsements.set(staleId.toHexString(), { ...staleRow });
    // The terminal audit insert survives with a real write error (not a
    // crash): the applied prefix compensates instead of stranding the charge.
    h.logsCol.insertOne.mockRejectedValueOnce(new Error("write failed"));

    const inFlight = endorsementInput({ idempotencyKey: "compensate-2" });
    inFlight.endorsement!.priorActive = [{ ...staleRow } as never];
    await expect(applyDirectActionSpend(h.db, inFlight)).rejects.toThrow(
      "DIRECT_ACTION_STEP_FAILED:action-log:guard-rejected"
    );

    // This attempt's row is gone; the pre-attempt active set is restored.
    expect([...h.endorsements.values()].filter((row) => row.isActive)).toHaveLength(1);
    const restored = h.endorsements.get(staleId.toHexString())!;
    expect(restored.isActive).toBe(true);
    expect(restored.withdrawnReason).toBeUndefined();
    const character = h.characters.get(characterId.toHexString())!;
    expect(character.actions).toBe(100);
    expect(h.receipts.get("compensate-2")?.status).toBe("compensated");
  });

  it("debits fractional FX amounts exactly and rounds only the spent echo", async () => {
    const doc = h.characters.get(characterId.toHexString())!;
    doc.currencyBalances = { campaign: 20000 };
    const costLocal = 10000 * 1.055;
    const out = await applyDirectActionSpend(
      h.db,
      boostInput({
        idempotencyKey: "fx-1",
        fundsField: "currencyBalances.campaign",
        fundCostLocal: costLocal,
      })
    );
    expect((h.characters.get(characterId.toHexString())!.currencyBalances as Doc).campaign).toBe(
      20000 - costLocal
    );
    // The legacy `funds` field is untouched when the campaign balance pays.
    expect(h.characters.get(characterId.toHexString())!.funds).toBe(50000);
    expect(out.funds).toEqual({ current: 20000 - costLocal, spent: Math.round(costLocal) });
  });

  it("passes the exact-funds guard edge under FX", async () => {
    const costLocal = 10000 * 1.055;
    const doc = h.characters.get(characterId.toHexString())!;
    doc.currencyBalances = { campaign: costLocal };
    const out = await applyDirectActionSpend(
      h.db,
      boostInput({
        idempotencyKey: "fx-edge",
        fundsField: "currencyBalances.campaign",
        fundCostLocal: costLocal,
      })
    );
    expect((h.characters.get(characterId.toHexString())!.currencyBalances as Doc).campaign).toBe(0);
    expect(out.funds.current).toBe(0);
  });

  it("builds distinct fingerprints per priced action and validates keys", async () => {
    const a = buildDirectActionFingerprint({
      characterId,
      nppId,
      action: "boost_favorability",
      actionCost: 5,
      fundCostAnchor: 10000,
      fundsField: "funds",
    });
    const b = buildDirectActionFingerprint({
      characterId,
      nppId,
      action: "boost_influence",
      actionCost: 6,
      fundCostAnchor: 20000,
      fundsField: "funds",
    });
    expect(a).not.toBe(b);

    await expect(
      applyDirectActionSpend(h.db, boostInput({ idempotencyKey: "" }))
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      applyDirectActionSpend(h.db, boostInput({ idempotencyKey: "k".repeat(129) }))
    ).rejects.toBeInstanceOf(RangeError);
  });
});
