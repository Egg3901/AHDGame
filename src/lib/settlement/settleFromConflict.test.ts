import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    status: "frozen",
    conflictId: "gq_de_412",
    ...over,
  } as SettlementCrisisDoc;
}

function conflict(over: Record<string, unknown> = {}) {
  return {
    _id: "gq_de_412",
    status: "resolved",
    sideA: { label: "NATO", backer: "west" },
    sideB: { label: "Warsaw Pact", backer: "east" },
    outcome: { winner: "A", note: "" },
    ...over,
  };
}

describe("settleFrozenCrisisFromConflict", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "conflicts").findOne.mockResolvedValue(conflict());
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("ignores a crisis that is not frozen", async () => {
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(
      db as unknown as Db,
      crisis({ status: "open" }),
      412
    );
    expect(res.settled).toBe(false);
    expect(prime(db, "conflicts").findOne).not.toHaveBeenCalled();
  });

  it("ignores a frozen crisis with no conflict linked", async () => {
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(
      db as unknown as Db,
      crisis({ conflictId: null }),
      412
    );
    expect(res.settled).toBe(false);
  });

  it("waits while the war is still being fought", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(conflict({ status: "active" }));
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
    expect(res.settled).toBe(false);
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("stays frozen when the conflict has vanished rather than resolving arbitrarily", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(null);
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
    expect(res.settled).toBe(false);
  });

  it("gives Germany to the incumbent when NATO wins", async () => {
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
    expect(res).toEqual({ settled: true, outcome: "incumbent" });
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      status: "resolved",
      outcome: "incumbent",
      resolvedTurn: 412,
    });
  });

  it("gives Germany to the challenger when the Pact wins", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      conflict({ outcome: { winner: "B", note: "" } })
    );
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
    expect(res).toEqual({ settled: true, outcome: "challenger" });
  });

  it("reads the winner off the backer, not the side's position in the document", async () => {
    // If the sides were ever built in the other order, position-based reading
    // would hand Germany to the loser.
    prime(db, "conflicts").findOne.mockResolvedValue(
      conflict({
        sideA: { label: "Warsaw Pact", backer: "east" },
        sideB: { label: "NATO", backer: "west" },
        outcome: { winner: "A", note: "" },
      })
    );
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
    expect(res.outcome).toBe("challenger");
  });

  it("leaves it frozen when the winning side carries no backer", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      conflict({ sideA: { label: "NATO" }, outcome: { winner: "A", note: "" } })
    );
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    expect((await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412)).settled).toBe(
      false
    );
  });

  it("guards on `frozen` so two runners cannot settle it twice", async () => {
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
    expect(res.settled).toBe(false);
    const [filter] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter).toMatchObject({ status: "frozen" });
  });

  describe("an attached war, which carries no backer", () => {
    /** What `declareWar` actually writes: rosters and labels, no `backer`. */
    const declared = (over: Record<string, unknown> = {}) =>
      conflict({
        sideA: { label: "United States", countries: ["US"], kind: "state" },
        sideB: { label: "East Germany", countries: ["DD"], kind: "state" },
        ...over,
      });

    const attached = (over: Partial<SettlementCrisisDoc> = {}) =>
      crisis({ conflictSides: { challenger: "B", incumbent: "A" }, ...over });

    it("reunifies Germany when East Germany's side wins", async () => {
      prime(db, "conflicts").findOne.mockResolvedValue(
        declared({ outcome: { winner: "B", note: "" } })
      );
      const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
      const res = await settleFrozenCrisisFromConflict(db as unknown as Db, attached(), 412);
      expect(res.outcome).toBe("challenger");
    });

    it("keeps West Germany sovereign when the other side wins", async () => {
      prime(db, "conflicts").findOne.mockResolvedValue(
        declared({ outcome: { winner: "A", note: "" } })
      );
      const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
      const res = await settleFrozenCrisisFromConflict(db as unknown as Db, attached(), 412);
      expect(res.outcome).toBe("incumbent");
    });

    it("would have stalled for ever on the backer alone", async () => {
      // The regression this whole stamp exists for: same war, no stamp, and the
      // crisis stays frozen because neither roster carries a bloc.
      prime(db, "conflicts").findOne.mockResolvedValue(
        declared({ outcome: { winner: "B", note: "" } })
      );
      const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
      const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
      expect(res.settled).toBe(false);
    });

    it("still reads the backer for a crisis frozen before the stamp existed", async () => {
      const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
      // `conflict()` is the crisis's OWN war: sideA NATO/west, sideB Pact/east.
      const res = await settleFrozenCrisisFromConflict(db as unknown as Db, crisis(), 412);
      expect(res.outcome).toBe("incumbent");
    });

    it("leaves it frozen when the winner matches neither stamped side", async () => {
      prime(db, "conflicts").findOne.mockResolvedValue(
        declared({ outcome: { winner: "B", note: "" } })
      );
      const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
      const res = await settleFrozenCrisisFromConflict(
        db as unknown as Db,
        attached({ conflictSides: { challenger: "A", incumbent: "A" } }),
        412
      );
      expect(res.settled).toBe(false);
      expect(res.outcome).toBeNull();
    });
  });

  it("decides on the war alone, never on where the index stood", async () => {
    // Frozen at 8% — hopeless on the board — but the Pact won the war.
    prime(db, "conflicts").findOne.mockResolvedValue(
      conflict({ outcome: { winner: "B", note: "" } })
    );
    const { settleFrozenCrisisFromConflict } = await import("./settleFromConflict");
    const res = await settleFrozenCrisisFromConflict(
      db as unknown as Db,
      crisis({ position: 800 }),
      412
    );
    expect(res.outcome).toBe("challenger");
  });
});
