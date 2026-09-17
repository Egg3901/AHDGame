import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyCampaignDonationSpend,
  CAMPAIGN_DONATION_CAMPAIGN_MISSING,
  CAMPAIGN_DONATION_INSUFFICIENT,
} from "./campaignDonationSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import type { Campaign } from "@/lib/db/types";

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
// Stateful in-memory fakes. They honor exactly the operators the money-flow
// primitive emits ($inc / $push+$each+$slice / $set writes; _id equality,
// $ne-on-keys and $gte-on-balance filters; duplicate-key errors on insert),
// so an injected crash between any two writes models a real process death
// between the corresponding sequential Mongo writes.
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
    opts?: { projection?: Record<string, unknown> }
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    if (!opts?.projection) return structuredClone(doc);
    const out: Record<string, unknown> = { _id: doc._id };
    for (const field of Object.keys(opts.projection)) {
      if (field !== "_id") out[field] = structuredClone(doc[field]);
    }
    return out;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (doc && !matchesFlowFilter(doc, filter)) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };

    const inc = (update.$inc ?? {}) as Record<string, number>;
    for (const [field, delta] of Object.entries(inc)) {
      setPath(doc, field, ((getPath(doc, field) as number | undefined) ?? 0) + delta);
    }
    const push = (update.$push ?? {}) as Record<string, { $each: unknown[]; $slice: number }>;
    for (const [field, spec] of Object.entries(push)) {
      const current = (doc[field] as unknown[] | undefined) ?? [];
      const next = [...current, ...spec.$each];
      doc[field] = spec.$slice < 0 ? next.slice(spec.$slice) : next;
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      setPath(doc, field, value);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

function matchesFlowFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    if (
      condition !== null &&
      typeof condition === "object" &&
      "$ne" in (condition as Record<string, unknown>)
    ) {
      const keys = doc[field] as string[] | undefined;
      if (keys?.includes((condition as { $ne: string }).$ne)) return false;
      continue;
    }
    if (
      condition !== null &&
      typeof condition === "object" &&
      "$gte" in (condition as Record<string, unknown>)
    ) {
      const balance = getPath(doc, field) as number | undefined;
      if (!((balance ?? Number.NEGATIVE_INFINITY) >= (condition as { $gte: number }).$gte)) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
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

const partyId = new ObjectId();
const characterId = new ObjectId();
const campaignId = new ObjectId();

function seedDb(db: FakeDb): void {
  db.collection("politicalParties").docs.set(partyId.toHexString(), {
    _id: partyId,
    treasury: 5000,
  });
  db.collection("characters").docs.set(characterId.toHexString(), {
    _id: characterId,
    currencyBalances: { campaign: 1000 },
  });
  db.collection("campaigns").docs.set(campaignId.toHexString(), {
    _id: campaignId,
    funds: 0,
    totalFundsGenerated: 0,
    donationLog: [],
  });
}

function partyEntry(): Campaign["donationLog"][0] {
  return {
    donorId: partyId.toString(),
    donorName: "Test Party (Chair)",
    donorType: "party",
    amount: 500,
    timestamp: new Date("2026-01-01T00:00:00Z"),
    turnNumber: 42,
  };
}

function characterEntry(): Campaign["donationLog"][0] {
  return {
    donorId: characterId.toString(),
    donorName: "Test Character",
    donorType: "character",
    amount: 100,
    timestamp: new Date("2026-01-01T00:00:00Z"),
    turnNumber: 42,
  };
}

function partyInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "party" as const,
    donorDocId: partyId,
    campaignId,
    amountLocal: 500,
    donationEntry: partyEntry(),
    fingerprint: `party:${partyId.toHexString()}:${campaignId.toHexString()}:500`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function characterInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "character" as const,
    donorDocId: characterId,
    campaignId,
    characterFundsField: "currencyBalances.campaign",
    amountLocal: 100,
    donationEntry: characterEntry(),
    fingerprint: `character:${characterId.toHexString()}:${campaignId.toHexString()}:100`,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function treasury(db: FakeDb): number {
  return db.collection("politicalParties").docs.get(partyId.toHexString())?.treasury as number;
}

function characterCampaignBalance(db: FakeDb): number {
  const balances = db.collection("characters").docs.get(characterId.toHexString())
    ?.currencyBalances as { campaign: number };
  return balances.campaign;
}

function campaignDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("campaigns").docs.get(campaignId.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyCampaignDonationSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("charges the party treasury once, credits the campaign, and completes the receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = partyInput({ idempotencyKey: "party-happy" });

    const result = await applyCampaignDonationSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(treasury(db)).toBe(4500);
    expect(campaignDoc(db).funds).toBe(500);
    expect(campaignDoc(db).totalFundsGenerated).toBe(500);
    const log = campaignDoc(db).donationLog as unknown[];
    expect(log).toHaveLength(1);
    expect(receipt(db, "party-happy").status).toBe("completed");
  });

  it("charges character campaign funds once and records one log row", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = characterInput({ idempotencyKey: "character-happy" });

    const result = await applyCampaignDonationSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(characterCampaignBalance(db)).toBe(900);
    expect(campaignDoc(db).funds).toBe(100);
    expect(campaignDoc(db).donationLog as unknown[]).toHaveLength(1);
    expect(receipt(db, "character-happy").status).toBe("completed");
  });

  // Writes per attempt: 1 receipt claim, 2 donor debit, 3 campaign credit,
  // 4 receipt settle. A throw from the fake models a real process death ONLY
  // where no cleanup code runs for it: the claim and the debit leg propagate
  // untouched, so the retry reconciles. The credit step converts a survived
  // error into a compensatable failure (a real crash would run no code at
  // all), which the credit-failure test below covers.
  it.each([0, 1])(
    "reconciles a crash after %i successful writes to exactly one charged donation",
    async (crashAfter) => {
      const db = new FakeDb();
      seedDb(db);
      db.crashAfterWrites = crashAfter;
      const input = partyInput({ idempotencyKey: `crash-${crashAfter}` });

      await expect(applyCampaignDonationSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      // Process restarts; storage survived. The same key reconciles.
      // Crash-on-write-0 left no receipt at all, so that retry is a fresh
      // attempt; a later crash reconciles an in-progress receipt.
      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const result = await applyCampaignDonationSpend(db as unknown as Db, input);

      expect(result.duplicate).toBe(crashAfter > 0);
      expect(treasury(db)).toBe(4500);
      expect(campaignDoc(db).funds).toBe(500);
      expect(campaignDoc(db).donationLog as unknown[]).toHaveLength(1);
      expect(receipt(db, `crash-${crashAfter}`).status).toBe("completed");
    }
  );

  it("reconciles a crash on the receipt settle to exactly one charged donation", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.crashAfterWrites = 3;
    const input = partyInput({ idempotencyKey: "crash-settle" });

    await expect(applyCampaignDonationSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // Debit and credit both survived; the retry replays every step as
    // already-applied and settles completed.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const result = await applyCampaignDonationSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(true);
    expect(treasury(db)).toBe(4500);
    expect(campaignDoc(db).funds).toBe(500);
    expect(campaignDoc(db).donationLog as unknown[]).toHaveLength(1);
    expect(receipt(db, "crash-settle").status).toBe("completed");
  });

  it("refunds the debit when the campaign credit cannot be written", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = partyInput({ idempotencyKey: "credit-failure" });
    db.collection("campaigns").updateOne = async () => {
      throw new Error("disk on fire");
    };

    await expect(applyCampaignDonationSpend(db as unknown as Db, input)).rejects.toThrow(
      CAMPAIGN_DONATION_CAMPAIGN_MISSING
    );

    // Debit refunded, no credit, receipt compensated: never a partial state.
    expect(treasury(db)).toBe(5000);
    expect(campaignDoc(db).funds).toBe(0);
    expect(campaignDoc(db).donationLog as unknown[]).toHaveLength(0);
    expect(receipt(db, "credit-failure").status).toBe("compensated");
  });

  it("fails closed on insufficient party funds and keeps the failure terminal", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = partyInput({ idempotencyKey: "poor-party", amountLocal: 99999 });

    await expect(applyCampaignDonationSpend(db as unknown as Db, input)).rejects.toThrow(
      CAMPAIGN_DONATION_INSUFFICIENT
    );
    expect(treasury(db)).toBe(5000);
    expect(campaignDoc(db).funds).toBe(0);
    expect(receipt(db, "poor-party").status).toBe("failed");

    await expect(applyCampaignDonationSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(treasury(db)).toBe(5000);
  });

  it("fails closed on insufficient character funds without touching the campaign", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = characterInput({ idempotencyKey: "poor-character", amountLocal: 99999 });

    await expect(applyCampaignDonationSpend(db as unknown as Db, input)).rejects.toThrow(
      CAMPAIGN_DONATION_INSUFFICIENT
    );
    expect(characterCampaignBalance(db)).toBe(1000);
    expect(campaignDoc(db).funds).toBe(0);
    expect(receipt(db, "poor-character").status).toBe("failed");
  });

  it("loses a race for the same treasury to exactly one winner", async () => {
    const db = new FakeDb();
    seedDb(db);
    // A concurrent donation spends the treasury first (separate key).
    await applyCampaignDonationSpend(
      db as unknown as Db,
      partyInput({ idempotencyKey: "race-winner", amountLocal: 4800 })
    );
    expect(treasury(db)).toBe(200);

    await expect(
      applyCampaignDonationSpend(
        db as unknown as Db,
        partyInput({ idempotencyKey: "race-loser", amountLocal: 500 })
      )
    ).rejects.toThrow(CAMPAIGN_DONATION_INSUFFICIENT);
    expect(treasury(db)).toBe(200);
    expect(campaignDoc(db).funds).toBe(4800);
  });

  it("replays a completed key without charging or recording again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = partyInput({ idempotencyKey: "replay" });

    const first = await applyCampaignDonationSpend(db as unknown as Db, input);
    const second = await applyCampaignDonationSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ duplicate: true });
    expect(treasury(db)).toBe(4500);
    expect(campaignDoc(db).donationLog as unknown[]).toHaveLength(1);
  });

  it("rejects a key reused for a different donation", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyCampaignDonationSpend(db as unknown as Db, partyInput({ idempotencyKey: "shared" }));

    await expect(
      applyCampaignDonationSpend(
        db as unknown as Db,
        partyInput({
          idempotencyKey: "shared",
          amountLocal: 600,
          fingerprint: `party:${partyId.toHexString()}:${campaignId.toHexString()}:600`,
        })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(treasury(db)).toBe(4500);
    expect(campaignDoc(db).funds).toBe(500);
  });

  it("leaves the debit stranded-but-visible when compensation itself crashes", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = partyInput({ idempotencyKey: "comp-crash" });
    const campaigns = db.collection("campaigns");
    campaigns.updateOne = async () => {
      throw new Error("disk on fire");
    };
    const parties = db.collection("politicalParties");
    const realUpdate = parties.updateOne.bind(parties);
    let calls = 0;
    parties.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ) => {
      calls += 1;
      // First call is the debit; the second is the compensation refund.
      if (calls === 2) throw new Error("INJECTED_CRASH");
      return realUpdate(filter, update);
    }) as typeof parties.updateOne;

    await expect(applyCampaignDonationSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The debit applied, the credit never landed, the refund never ran: the
    // receipt rests in_progress (fail open by crash, TTL-visible) rather than
    // pretending the prefix was reversed.
    expect(treasury(db)).toBe(4500);
    expect(receipt(db, "comp-crash").status).toBe("in_progress");
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
    seedDb(db);

    const result = await applyCampaignDonationSpend(
      db as unknown as Db,
      partyInput({ idempotencyKey: "tx-path" })
    );

    expect(result.duplicate).toBe(false);
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(endSession).toHaveBeenCalledOnce();
    expect(treasury(db)).toBe(4500);
    expect(campaignDoc(db).funds).toBe(500);
    expect(receipt(db, "tx-path").status).toBe("completed");
  });
});
