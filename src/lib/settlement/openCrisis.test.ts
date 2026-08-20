import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import {
  CARRY_THRESHOLD,
  LOCK_THRESHOLD,
  SETTLEMENT_DEFAULT_RULES,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_MAX_YEAR,
  SETTLEMENT_MIN_YEAR,
  SETTLEMENT_SEATS,
} from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/country/registeredCountries", () => ({ getRegisteredCountryIds: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("openSettlementCrisisIfDue", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    // No crisis live, none ever resolved.
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    prime(db, "settlementCrises").find.mockReturnValue(cursor([]));
    prime(db, "settlementCrises").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    const { getRegisteredCountryIds } = await import("@/lib/country/registeredCountries");
    vi.mocked(getRegisteredCountryIds).mockResolvedValue(["DE", "DD", "US", "UK", "RU"] as never);
  });

  it("opens the question inside the era window", async () => {
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    const res = await openSettlementCrisisIfDue(db as unknown as Db, {
      turn: 12,
      year: SETTLEMENT_MIN_YEAR,
    });
    expect(res.opened).toBe(true);
    expect(res.crisisId).toBeTruthy();
  });

  it("refuses before the window opens and after it closes", async () => {
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    for (const year of [SETTLEMENT_MIN_YEAR - 1, SETTLEMENT_MAX_YEAR + 1]) {
      const res = await openSettlementCrisisIfDue(db as unknown as Db, { turn: 12, year });
      expect(res.opened).toBe(false);
      expect(res.reason).toContain("outside");
    }
    expect(prime(db, "settlementCrises").insertOne).not.toHaveBeenCalled();
  });

  it("refuses when the world has no resolvable year", async () => {
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    const res = await openSettlementCrisisIfDue(db as unknown as Db, { turn: 12, year: null });
    expect(res.opened).toBe(false);
  });

  it("refuses while a crisis is already open or frozen", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue({ _id: new ObjectId() });
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    const res = await openSettlementCrisisIfDue(db as unknown as Db, { turn: 12, year: 1953 });
    expect(res).toMatchObject({ opened: false, reason: "a settlement crisis is already live" });
  });

  it("refuses while the last question is still cooling down", async () => {
    prime(db, "settlementCrises").find.mockReturnValue(
      cursor([{ _id: new ObjectId(), status: "resolved", cooldownUntilTurn: 500 }])
    );
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    const res = await openSettlementCrisisIfDue(db as unknown as Db, { turn: 412, year: 1953 });
    expect(res.opened).toBe(false);
    expect(res.reason).toContain("cooling down");
  });

  it("reopens once the cooldown has passed", async () => {
    prime(db, "settlementCrises").find.mockReturnValue(
      cursor([{ _id: new ObjectId(), status: "resolved", cooldownUntilTurn: 400 }])
    );
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    expect(
      (await openSettlementCrisisIfDue(db as unknown as Db, { turn: 412, year: 1953 })).opened
    ).toBe(true);
  });

  it("refuses to reopen on top of a close that has not been actuated", async () => {
    // A null cooldown means the absorption is still pending. Opening a fresh
    // question there would race the merge.
    prime(db, "settlementCrises").find.mockReturnValue(
      cursor([{ _id: new ObjectId(), status: "resolved", cooldownUntilTurn: null }])
    );
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    const res = await openSettlementCrisisIfDue(db as unknown as Db, { turn: 412, year: 1953 });
    expect(res).toMatchObject({ opened: false, reason: "the last question has not been actuated" });
  });

  it("refuses once one of the two Germanies has been absorbed", async () => {
    // The whole point of the registry check: a reunification win dissolves DD,
    // and the question must not reopen against a country that no longer exists.
    const { getRegisteredCountryIds } = await import("@/lib/country/registeredCountries");
    vi.mocked(getRegisteredCountryIds).mockResolvedValue(["DE", "US", "UK", "RU"] as never);
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    const res = await openSettlementCrisisIfDue(db as unknown as Db, { turn: 412, year: 1953 });
    expect(res).toMatchObject({ opened: false, reason: "DD is not a live country" });
  });

  it("treats a duplicate key as another runner winning, not as an error", async () => {
    const dup = new MongoServerError({ message: "E11000 duplicate key" });
    dup.code = 11000;
    prime(db, "settlementCrises").insertOne.mockRejectedValue(dup);
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    const res = await openSettlementCrisisIfDue(db as unknown as Db, { turn: 12, year: 1953 });
    expect(res).toMatchObject({ opened: false, reason: "another runner opened it first" });
  });

  it("rethrows a write failure that is not a duplicate", async () => {
    prime(db, "settlementCrises").insertOne.mockRejectedValue(new Error("disk full"));
    const { openSettlementCrisisIfDue } = await import("./openCrisis");
    await expect(
      openSettlementCrisisIfDue(db as unknown as Db, { turn: 12, year: 1953 })
    ).rejects.toThrow("disk full");
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
    expect(doc.seats.every((s) => s.capital === 0 && s.committedPoints === 0)).toBe(true);
  });

  it("opens cold, unarmed and never ticked", async () => {
    const { buildGermanQuestion } = await import("./openCrisis");
    const doc = buildGermanQuestion(12);
    expect(doc.ladder).toEqual({ heat: 0, armedTurn: null });
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
