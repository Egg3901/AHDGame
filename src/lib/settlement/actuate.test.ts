import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { SETTLEMENT_REOPEN_COOLDOWN_TURNS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({ recordCountryEvent: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "resolved",
    outcome: "incumbent",
    targetEntityId: "DE",
    challengerEntityId: "DD",
    cooldownUntilTurn: null,
    ...over,
  } as SettlementCrisisDoc;
}

describe("actuateSettlementOutcome", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("ignores a crisis that has not resolved", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ status: "open", outcome: null }),
      412
    );
    expect(res.actuated).toBe(false);
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("ignores a crisis already actuated", async () => {
    // A cooldown is the marker; without this check the history entries double.
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ cooldownUntilTurn: 500 }),
      412
    );
    expect(res.actuated).toBe(false);
  });

  it("sets a cooldown so the question can be asked again, but not at once", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 412);
    const [filter, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter).toMatchObject({ cooldownUntilTurn: null });
    expect(update.$set.cooldownUntilTurn).toBe(412 + SETTLEMENT_REOPEN_COOLDOWN_TURNS);
  });

  it("records the close against both Germanies on a Western win", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(db as unknown as Db, crisis(), 412);
    expect(res).toEqual({ actuated: true, outcome: "incumbent", deferred: false });
    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    const countries = vi.mocked(recordCountryEvent).mock.calls.map((c) => c[1].countryId);
    expect(countries.sort()).toEqual(["DD", "DE"]);
    expect(vi.mocked(recordCountryEvent).mock.calls[0][1].title).toContain("stays sovereign");
  });

  it("records a reunification win as NOT enacted rather than implying a border moved", async () => {
    // The absorption needs three capabilities this codebase does not have; the
    // outcome is real, the map change is not built.
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ outcome: "challenger" }),
      412
    );
    expect(res).toEqual({ actuated: true, outcome: "challenger", deferred: true });
    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    const first = vi.mocked(recordCountryEvent).mock.calls[0][1];
    expect(first.title).toContain("awaits enactment");
    expect(first.details).toMatchObject({ enacted: false });
  });

  it("does not touch a single region on either outcome", async () => {
    // The guard that matters: no half-merge. If this ever starts moving regions
    // it must do the whole job, not part of it.
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    expect(db.collectionMocks.states).toBeUndefined();
    expect(db.collectionMocks.countryGameStates).toBeUndefined();
  });

  it("guards the cooldown write so two runners cannot both record history", async () => {
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(db as unknown as Db, crisis(), 412);
    expect(res.actuated).toBe(false);
    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    expect(vi.mocked(recordCountryEvent)).not.toHaveBeenCalled();
  });
});
