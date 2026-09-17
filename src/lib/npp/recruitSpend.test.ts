import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyRecruitSpend,
  NATIONAL_RECRUITMENT_CHANGED,
  STATE_RECRUITMENT_CHANGED,
  type RecruitSpendInput,
} from "./recruitSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import { recruitmentCooldownReadyFilter, recruitmentCooldownSet } from "./recruitmentCooldown";
import { NPP_ECONOMY_DEFAULTS } from "./economyDefaults";
import type { NPP } from "@/lib/db/types";

const { supportMock, getMongoClientMock } = vi.hoisted(() => ({
  supportMock: vi.fn(),
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
  getDb: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes. They honor exactly the operators the spend flow
// emits ($inc / $set / $unset / $push+$each+$slice writes; _id equality,
// $or (+ nesting), $ne-on-keys, $gte/$lte and $exists filters; duplicate key
// errors on insert), so an injected crash between any two writes models a
// real process death between the corresponding sequential Mongo writes. The
// real `recruitmentCooldownReadyFilter` output is fed through this matcher,
// so cooldown-race behavior is tested against the actual filter shape.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return Buffer.from((id as { buffer: Uint8Array }).buffer).toString("hex");
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
}

function setPath(doc: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

function deletePath(doc: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]!] as Record<string, unknown> | undefined;
    if (typeof next !== "object" || next === null) return;
    node = next;
  }
  delete node[parts[parts.length - 1]!];
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function matchesClause(doc: Record<string, unknown>, field: string, condition: unknown): boolean {
  if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
    const ops = condition as Record<string, unknown>;
    if ("$ne" in ops) {
      const keys = doc[field] as string[] | undefined;
      if (keys?.includes(ops.$ne as string)) return false;
      return true;
    }
    if ("$exists" in ops) {
      return (getPath(doc, field) !== undefined) === (ops.$exists as boolean);
    }
    const value = getPath(doc, field);
    // Like MongoDB, ordered comparisons do not match a missing field; the
    // readiness filter carries its own $exists:false branch for that case.
    if (value === undefined) return false;
    if ("$gte" in ops) return (comparable(value) as number) >= (comparable(ops.$gte) as number);
    if ("$lte" in ops) return (comparable(value) as number) <= (comparable(ops.$lte) as number);
    return comparable(value) === comparable(condition);
  }
  return comparable(getPath(doc, field)) === comparable(condition);
}

function matchesFlowFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (field === "$or") {
      const branches = condition as Record<string, unknown>[];
      if (!branches.some((branch) => matchesFlowFilter(doc, branch))) return false;
      continue;
    }
    if (!matchesClause(doc, field, condition)) return false;
  }
  return true;
}

class FakeCollection {
  readonly docs = new Map<string, Record<string, unknown>>();

  constructor(private readonly db: FakeDb) {}

  private countWrite(): void {
    this.db.writeCount += 1;
    if (this.db.writeCount > this.db.crashAfterWrites) {
      throw new Error("INJECTED_CRASH");
    }
  }

  async insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }> {
    this.countWrite();
    const key = docKey(doc._id);
    if (this.docs.has(key)) {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      throw error;
    }
    this.docs.set(key, structuredClone(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    _opts?: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    return structuredClone(doc);
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (!matchesFlowFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(doc, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
  const inc = (update.$inc ?? {}) as Record<string, number>;
  for (const [field, delta] of Object.entries(inc)) {
    setPath(doc, field, ((getPath(doc, field) as number | undefined) ?? 0) + delta);
  }
  const push = (update.$push ?? {}) as Record<string, { $each: unknown[]; $slice: number }>;
  for (const [field, spec] of Object.entries(push)) {
    const current = (doc[field] as string[] | undefined) ?? [];
    const next = [...current, ...(spec.$each as string[])];
    doc[field] = spec.$slice < 0 ? next.slice(spec.$slice) : next;
  }
  const unset = (update.$unset ?? {}) as Record<string, unknown>;
  for (const field of Object.keys(unset)) deletePath(doc, field);
  const set = (update.$set ?? {}) as Record<string, unknown>;
  for (const [field, value] of Object.entries(set)) {
    setPath(doc, field, value);
  }
}

class FakeDb {
  writeCount = 0;
  crashAfterWrites = Number.POSITIVE_INFINITY;
  private readonly collections = new Map<string, FakeCollection>();

  collection(name: string): FakeCollection {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection(this);
      this.collections.set(name, collection);
    }
    return collection;
  }
}

const CURRENT_TURN = 100;
const GAME_NOW = new Date("2026-06-01T00:00:00Z");
const partyObjectId = new ObjectId();
const ORG_ID = "CA_1";

function seedNational(
  db: FakeDb,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const doc = {
    _id: partyObjectId,
    sequentialId: 1,
    nppActionPoints: 20,
    treasury: 50_000,
    ...overrides,
  };
  db.collection("politicalParties").docs.set(partyObjectId.toHexString(), doc);
  return doc;
}

function seedState(db: FakeDb, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const doc = {
    _id: ORG_ID,
    stateId: "CA",
    partyId: "1",
    nppActionPoints: 10,
    treasury: 50_000,
    organization: 60,
    ...overrides,
  };
  db.collection("statePartyOrg").docs.set(ORG_ID, doc);
  return doc;
}

function nppBody(): Omit<NPP, "_id"> {
  return {
    name: "Test NPP",
    countryId: "US",
    homeState: "CA",
    politicalInfluence: 10,
    favorability: 50,
    policies: { economic: 0, social: 0 },
    party: "1",
    currentOffice: null,
    ...NPP_ECONOMY_DEFAULTS,
    personality: { loyalty: 50, ambition: 40, stubbornness: 40 },
    generatedAt: GAME_NOW,
    retiredAt: null,
    influenceState: { totalTimesInfluenced: 0 },
    sequentialId: 7,
    createdAt: GAME_NOW,
    updatedAt: GAME_NOW,
  };
}

function spendInput(
  scope: "national" | "state",
  overrides: Record<string, unknown> = {}
): RecruitSpendInput {
  const cooldownSet = recruitmentCooldownSet(CURRENT_TURN, GAME_NOW.getTime());
  return {
    scope,
    partyObjectId,
    orgDocId: scope === "state" ? ORG_ID : null,
    recruitCost: 5,
    recruitFund: 1_000,
    cooldown: {
      set: cooldownSet,
      readyFilter: recruitmentCooldownReadyFilter(CURRENT_TURN, GAME_NOW),
      prior: {},
    },
    npp: nppBody(),
    fingerprint: `${scope}:1:CA:${CURRENT_TURN}`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function balances(db: FakeDb, scope: "national" | "state"): { ap: number; funds: number } {
  const doc =
    scope === "national"
      ? db.collection("politicalParties").docs.get(partyObjectId.toHexString())!
      : db.collection("statePartyOrg").docs.get(ORG_ID)!;
  return { ap: doc.nppActionPoints as number, funds: doc.treasury as number };
}

function cooldownOf(db: FakeDb, scope: "national" | "state"): Record<string, unknown> {
  const doc =
    scope === "national"
      ? db.collection("politicalParties").docs.get(partyObjectId.toHexString())!
      : db.collection("statePartyOrg").docs.get(ORG_ID)!;
  return {
    turn: doc.nppRecruitmentCooldownUntilTurn,
    date: doc.nppRecruitmentCooldownUntil,
  };
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

function nppRows(db: FakeDb): Record<string, unknown>[] {
  return [...db.collection("npps").docs.values()];
}

const SCOPES = ["national", "state"] as const;
const SENTINEL = {
  national: NATIONAL_RECRUITMENT_CHANGED,
  state: STATE_RECRUITMENT_CHANGED,
} as const;

describe.each(SCOPES)("applyRecruitSpend (%s scope, standalone fallback)", (scope) => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  function seed(db: FakeDb, overrides: Record<string, unknown> = {}) {
    if (scope === "national") seedNational(db, overrides);
    else seedState(db, overrides);
  }

  it("spends once, records one NPP, sets the cooldown, and completes the receipt", async () => {
    const db = new FakeDb();
    seed(db);
    const input = spendInput(scope, { idempotencyKey: `${scope}-happy` });

    const result = await applyRecruitSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(balances(db, scope)).toEqual({ ap: scope === "national" ? 15 : 5, funds: 49_000 });
    const cooldown = cooldownOf(db, scope);
    expect(cooldown.turn).toBe(CURRENT_TURN + 24);
    expect(cooldown.date).toBeInstanceOf(Date);
    expect(nppRows(db)).toHaveLength(1);
    expect(docKey(nppRows(db)[0]?._id)).toBe(result.nppId.toHexString());
    expect(receipt(db, `${scope}-happy`).status).toBe("completed");
  });

  // Writes per attempt: 1 receipt claim, 2 spend debit, 3 NPP-row insert,
  // 4 receipt settle. A throw from the fake models a process death ONLY where
  // no cleanup code runs for it, so the retry reconciles.
  it.each([0, 1, 2])(
    "reconciles a crash after %i successful writes to exactly one charged recruit",
    async (crashAfter) => {
      const db = new FakeDb();
      seed(db);
      db.crashAfterWrites = crashAfter;
      const input = spendInput(scope, { idempotencyKey: `${scope}-crash-${crashAfter}` });

      await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyRecruitSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(balances(db, scope)).toEqual({
        ap: scope === "national" ? 15 : 5,
        funds: 49_000,
      });
      expect(nppRows(db)).toHaveLength(1);
      expect(receipt(db, `${scope}-crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged recruit", async () => {
    const db = new FakeDb();
    seed(db);
    db.crashAfterWrites = 3;
    const input = spendInput(scope, { idempotencyKey: `${scope}-crash-settle` });

    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

    // Debit and row survived; the retry replays both as already-applied.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyRecruitSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(balances(db, scope)).toEqual({
      ap: scope === "national" ? 15 : 5,
      funds: 49_000,
    });
    expect(nppRows(db)).toHaveLength(1);
    expect(receipt(db, `${scope}-crash-settle`).status).toBe("completed");
  });

  it("loses the race when the cooldown is already held and charges nothing", async () => {
    const db = new FakeDb();
    // A concurrent recruit won first: the cooldown is now in the future, so
    // the real readiness filter rejects this attempt's atomic deduct.
    seed(db, {
      nppRecruitmentCooldownUntilTurn: CURRENT_TURN + 24,
      nppRecruitmentCooldownUntil: new Date(GAME_NOW.getTime() + 24 * 3600 * 1000),
    });
    const input = spendInput(scope, { idempotencyKey: `${scope}-race` });

    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow(SENTINEL[scope]);

    // Nothing applied: receipt failed, balances untouched, no NPP row.
    expect(balances(db, scope)).toEqual({
      ap: scope === "national" ? 20 : 10,
      funds: 50_000,
    });
    expect(nppRows(db)).toHaveLength(0);
    expect(receipt(db, `${scope}-race`).status).toBe("failed");

    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("a second keyed attempt while the cooldown is held also loses", async () => {
    const db = new FakeDb();
    seed(db);
    const first = spendInput(scope, { idempotencyKey: `${scope}-first-wins` });
    await applyRecruitSpend(db as unknown as Db, first);

    // Same transfer content, new key: the cooldown written by the first
    // attempt rejects the deduct, so the country is charged exactly once.
    const second = spendInput(scope, { idempotencyKey: `${scope}-second-loses` });
    await expect(applyRecruitSpend(db as unknown as Db, second)).rejects.toThrow(SENTINEL[scope]);
    expect(balances(db, scope)).toEqual({
      ap: scope === "national" ? 15 : 5,
      funds: 49_000,
    });
    expect(nppRows(db)).toHaveLength(1);
  });

  it("fails closed on insufficient actions and on insufficient funds", async () => {
    for (const [variant, seedOverrides] of [
      ["poor-ap", { nppActionPoints: 4 }],
      ["poor-funds", { treasury: 500 }],
    ] as const) {
      const db = new FakeDb();
      seed(db, seedOverrides);
      const input = spendInput(scope, { idempotencyKey: `${scope}-${variant}` });

      await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow(SENTINEL[scope]);
      expect(nppRows(db)).toHaveLength(0);
      expect(receipt(db, `${scope}-${variant}`).status).toBe("failed");

      await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
        MoneyFlowTerminalError
      );
    }
  });

  it("hands everything back when the NPP row cannot be written", async () => {
    const db = new FakeDb();
    seed(db);
    const input = spendInput(scope, { idempotencyKey: `${scope}-row-failure` });
    db.collection("npps").insertOne = async () => {
      throw new Error("disk on fire");
    };

    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow("RECRUIT_CONFLICT");

    // Debit refunded, no row, receipt compensated: never a partial state.
    expect(balances(db, scope)).toEqual({
      ap: scope === "national" ? 20 : 10,
      funds: 50_000,
    });
    expect(nppRows(db)).toHaveLength(0);
    expect(receipt(db, `${scope}-row-failure`).status).toBe("compensated");
  });

  it("restores the exact prior cooldown on compensation, without phantoms", async () => {
    const db = new FakeDb();
    // Legacy row: Date cooldown only, no turn field. The revert must $set the
    // Date back and $unset the turn field it wrote — never leave a phantom.
    const legacyDate = new Date(GAME_NOW.getTime() - 48 * 3600 * 1000);
    seed(db, { nppRecruitmentCooldownUntil: legacyDate });
    const seeded =
      scope === "national"
        ? db.collection("politicalParties").docs.get(partyObjectId.toHexString())!
        : db.collection("statePartyOrg").docs.get(ORG_ID)!;
    delete seeded.nppRecruitmentCooldownUntilTurn;
    const input = spendInput(scope, {
      idempotencyKey: `${scope}-cooldown-restore`,
      cooldown: {
        set: recruitmentCooldownSet(CURRENT_TURN, GAME_NOW.getTime()),
        readyFilter: recruitmentCooldownReadyFilter(CURRENT_TURN, GAME_NOW),
        prior: { nppRecruitmentCooldownUntil: legacyDate },
      },
    });
    db.collection("npps").insertOne = async () => {
      throw new Error("disk on fire");
    };

    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow("RECRUIT_CONFLICT");

    expect(balances(db, scope)).toEqual({
      ap: scope === "national" ? 20 : 10,
      funds: 50_000,
    });
    const restored =
      scope === "national"
        ? db.collection("politicalParties").docs.get(partyObjectId.toHexString())!
        : db.collection("statePartyOrg").docs.get(ORG_ID)!;
    expect(restored.nppRecruitmentCooldownUntil).toEqual(legacyDate);
    expect("nppRecruitmentCooldownUntilTurn" in restored).toBe(false);
  });

  it("recovers a crash during compensation without refunding twice", async () => {
    const db = new FakeDb();
    // The NPP insert persistently fails, so the failure recurs and the retry
    // converges. Crash on the settle write after the refund.
    // Writes: 1 receipt claim, 2 spend debit, 3 refund, 4 receipt settle
    // (the insert override throws without counting a write). Crash on 4.
    seed(db);
    db.collection("npps").insertOne = async () => {
      throw new Error("disk on fire");
    };
    db.crashAfterWrites = 3;
    const input = spendInput(scope, { idempotencyKey: `${scope}-crash-compensate` });

    // The survived insert error converts to a compensatable failure, but the
    // settle write crashes first.
    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow("INJECTED_CRASH");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow("RECRUIT_CONFLICT");

    expect(balances(db, scope)).toEqual({
      ap: scope === "national" ? 20 : 10,
      funds: 50_000,
    });
    expect(nppRows(db)).toHaveLength(0);
    expect(receipt(db, `${scope}-crash-compensate`).status).toBe("compensated");
  });

  it("replays a completed key without spending or recording again", async () => {
    const db = new FakeDb();
    seed(db);
    const input = spendInput(scope, { idempotencyKey: `${scope}-replay` });

    const first = await applyRecruitSpend(db as unknown as Db, input);
    const second = await applyRecruitSpend(db as unknown as Db, input);

    expect(second).toEqual({ duplicate: true, nppId: first.nppId });
    expect(balances(db, scope)).toEqual({
      ap: scope === "national" ? 15 : 5,
      funds: 49_000,
    });
    expect(nppRows(db)).toHaveLength(1);
  });

  it("rejects a key reused for a different recruit", async () => {
    const db = new FakeDb();
    seed(db);
    await applyRecruitSpend(
      db as unknown as Db,
      spendInput(scope, { idempotencyKey: `${scope}-shared` })
    );

    await expect(
      applyRecruitSpend(
        db as unknown as Db,
        spendInput(scope, {
          idempotencyKey: `${scope}-shared`,
          fingerprint: `${scope}:1:NV:${CURRENT_TURN}`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(nppRows(db)).toHaveLength(1);
  });

  it("derives a stable NPP id from the key: replay converges on one row", async () => {
    const db = new FakeDb();
    seed(db, { nppActionPoints: 1_000, treasury: 10_000_000 });

    const first = await applyRecruitSpend(
      db as unknown as Db,
      spendInput(scope, { idempotencyKey: `${scope}-stable` })
    );
    // Same key replays the same row id instead of inserting a second row (a
    // different key would be a new recruit, still gated by the cooldown).
    const replay = await applyRecruitSpend(
      db as unknown as Db,
      spendInput(scope, { idempotencyKey: `${scope}-stable` })
    );
    expect(replay.nppId).toEqual(first.nppId);
    expect(nppRows(db)).toHaveLength(1);
  });
});

describe("applyRecruitSpend scope edges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("refuses a state recruit with no org row before claiming any receipt", async () => {
    const db = new FakeDb();
    const input = spendInput("state", { idempotencyKey: "state-no-row", orgDocId: null });

    await expect(applyRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      STATE_RECRUITMENT_CHANGED
    );
    expect(db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.has("state-no-row")).toBe(
      false
    );
  });

  it("preserves the transaction path when the deployment supports it", async () => {
    supportMock.mockResolvedValue(true);
    const endSession = vi.fn().mockResolvedValue(undefined);
    const withTransaction = vi.fn(async (callback: (session: unknown) => Promise<unknown>) =>
      callback({})
    );
    getMongoClientMock.mockResolvedValue({
      startSession: () => ({ withTransaction, endSession }),
    });

    const db = new FakeDb();
    seedNational(db);
    const input = spendInput("national", { idempotencyKey: "tx-path" });

    const result = await applyRecruitSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(balances(db, "national")).toEqual({ ap: 15, funds: 49_000 });
    expect(nppRows(db)).toHaveLength(1);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
