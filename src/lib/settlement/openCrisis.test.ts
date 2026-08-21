import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import {
  CARRY_THRESHOLD,
  LOCK_THRESHOLD,
  SETTLEMENT_DEFAULT_RULES,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_SEATS,
} from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/country/registeredCountries", () => ({ getRegisteredCountryIds: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

/**
 * The two live-crisis reads differ only by filter, and MockDb's `findOne`
 * ignores filters — so every test that cares must mock BY FILTER or the
 * already-live check swallows the pending-actuation one.
 */
function noCrisis(db: MockDb) {
  prime(db, "settlementCrises").findOne.mockResolvedValue(null);
}

describe("openSettlementCrisis", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    noCrisis(db);
    prime(db, "settlementCrises").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    const { getRegisteredCountryIds } = await import("@/lib/country/registeredCountries");
    vi.mocked(getRegisteredCountryIds).mockResolvedValue(["DE", "DD", "US", "UK", "RU"] as never);
  });

  it("opens the question on demand, at any turn", async () => {
    const { openSettlementCrisis } = await import("./openCrisis");
    const res = await openSettlementCrisis(db as unknown as Db, { turn: 12 });
    expect(res.opened).toBe(true);
    expect(res.crisisId).toBeTruthy();
  });

  it("opens just as readily deep into a world's life", async () => {
    // There is no era window: the question is asked when an operator decides
    // to ask it, not when a calendar allows it.
    const { openSettlementCrisis } = await import("./openCrisis");
    expect((await openSettlementCrisis(db as unknown as Db, { turn: 9_000 })).opened).toBe(true);
  });

  it("refuses while a crisis is already open or frozen", async () => {
    prime(db, "settlementCrises").findOne.mockImplementation(async (f: { status?: unknown }) =>
      typeof f?.status === "object" ? { _id: new ObjectId() } : null
    );
    const { openSettlementCrisis } = await import("./openCrisis");
    const res = await openSettlementCrisis(db as unknown as Db, { turn: 12 });
    expect(res.opened).toBe(false);
    expect(res.reason).toContain("already live");
    expect(prime(db, "settlementCrises").insertOne).not.toHaveBeenCalled();
  });

  it("reopens immediately after a settled question, with no cooldown", async () => {
    // The re-open cooldown gates nothing now. A resolved-and-actuated crisis is
    // simply history.
    prime(db, "settlementCrises").findOne.mockImplementation(async (f: { status?: unknown }) =>
      f?.status === "resolved" ? null : null
    );
    const { openSettlementCrisis } = await import("./openCrisis");
    expect((await openSettlementCrisis(db as unknown as Db, { turn: 13 })).opened).toBe(true);
  });

  it("reopens on the same turn a crisis was closed", async () => {
    // A cancelled crisis is neither live nor resolved, so neither refusal sees
    // it. Closing and reopening back to back is the intended workflow.
    prime(db, "settlementCrises").findOne.mockImplementation(async (f: { status?: unknown }) => {
      const cancelled = { _id: new ObjectId(), status: "cancelled", cooldownUntilTurn: null };
      if (typeof f?.status === "object") return null; // $in: [open, frozen]
      if (f?.status === "resolved") return null;
      return cancelled;
    });
    const { openSettlementCrisis } = await import("./openCrisis");
    expect((await openSettlementCrisis(db as unknown as Db, { turn: 412 })).opened).toBe(true);
  });

  it("refuses while a resolved question is still waiting to be enacted", async () => {
    // Not a cooldown — a merge still pending. Opening here would name a
    // challenger that the actuation sweep dissolves a tick later.
    prime(db, "settlementCrises").findOne.mockImplementation(async (f: { status?: unknown }) =>
      f?.status === "resolved" ? { _id: new ObjectId(), cooldownUntilTurn: null } : null
    );
    const { openSettlementCrisis } = await import("./openCrisis");
    const res = await openSettlementCrisis(db as unknown as Db, { turn: 412 });
    expect(res.opened).toBe(false);
    expect(res.reason).toContain("not yet been enacted");
  });

  it("refuses once one of the two Germanies has been absorbed", async () => {
    // A reunification win dissolves DD; the question must not reopen against a
    // country that no longer exists.
    const { getRegisteredCountryIds } = await import("@/lib/country/registeredCountries");
    vi.mocked(getRegisteredCountryIds).mockResolvedValue(["DE", "US", "UK", "RU"] as never);
    const { openSettlementCrisis } = await import("./openCrisis");
    const res = await openSettlementCrisis(db as unknown as Db, { turn: 412 });
    expect(res.opened).toBe(false);
    expect(res.reason).toContain("not separate");
  });

  it("refuses when the target itself is gone, not only the challenger", async () => {
    const { getRegisteredCountryIds } = await import("@/lib/country/registeredCountries");
    vi.mocked(getRegisteredCountryIds).mockResolvedValue(["DD", "US", "UK", "RU"] as never);
    const { openSettlementCrisis } = await import("./openCrisis");
    expect((await openSettlementCrisis(db as unknown as Db, { turn: 412 })).reason).toContain("DE");
  });

  it("treats a duplicate key as another operator winning, not as an error", async () => {
    const dup = new MongoServerError({ message: "E11000 duplicate key" });
    dup.code = 11000;
    prime(db, "settlementCrises").insertOne.mockRejectedValue(dup);
    const { openSettlementCrisis } = await import("./openCrisis");
    const res = await openSettlementCrisis(db as unknown as Db, { turn: 12 });
    expect(res).toMatchObject({ opened: false, reason: "Another operator opened it first." });
  });

  it("rethrows a write failure that is not a duplicate", async () => {
    prime(db, "settlementCrises").insertOne.mockRejectedValue(new Error("disk full"));
    const { openSettlementCrisis } = await import("./openCrisis");
    await expect(openSettlementCrisis(db as unknown as Db, { turn: 12 })).rejects.toThrow(
      "disk full"
    );
  });
});

describe("buildGermanQuestion", () => {
  it("opens at the authored institution figures", async () => {
    const { buildGermanQuestion } = await import("./openCrisis");
    const doc = buildGermanQuestion(12);
    expect(doc.institutions.map((i) => [i.id, i.position])).toEqual(
      SETTLEMENT_INSTITUTIONS.map((d) => [d.id, d.opening])
    );
  });

  it("derives the index rather than quoting it", async () => {
    // 3x43 + 2x37 + 2x61 + 3x19, over a total weight of 10.
    const { buildGermanQuestion } = await import("./openCrisis");
    expect(buildGermanQuestion(12).position).toBe(3820);
  });

  it("opens strictly between the two thresholds", async () => {
    // An opening board outside them would resolve itself on the first tick.
    const { buildGermanQuestion } = await import("./openCrisis");
    const { position } = buildGermanQuestion(12);
    expect(position).toBeGreaterThan(LOCK_THRESHOLD);
    expect(position).toBeLessThan(CARRY_THRESHOLD);
  });

  it("seats every delegation with an empty pool", async () => {
    const { buildGermanQuestion } = await import("./openCrisis");
    const doc = buildGermanQuestion(12);
    expect(doc.seats.map((s) => s.id)).toEqual(SETTLEMENT_SEATS.map((s) => s.id));
    expect(doc.seats.every((s) => s.capital === 0 && s.actions === 0)).toBe(true);
  });

  it("opens cold, unarmed and never ticked", async () => {
    const { buildGermanQuestion } = await import("./openCrisis");
    const doc = buildGermanQuestion(12);
    expect(doc.ladder).toEqual({ heat: 0, armedTurn: null, quietTurns: 0 });
    expect(doc.lastTickedTurn).toBeNull();
    expect(doc.driftHistory).toEqual([]);
    expect(doc.openedTurn).toBe(12);
  });

  it("writes the rules block explicitly, at the source design's defaults", async () => {
    const { buildGermanQuestion } = await import("./openCrisis");
    expect(buildGermanQuestion(12).rules).toEqual(SETTLEMENT_DEFAULT_RULES);
  });

  it("names both Germanies, in the direction the merge runs", async () => {
    const { buildGermanQuestion } = await import("./openCrisis");
    const doc = buildGermanQuestion(12);
    expect(doc.targetEntityId).toBe("DE");
    expect(doc.challengerEntityId).toBe("DD");
  });
});
