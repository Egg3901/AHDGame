import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { computeWarApproval } from "../warApproval";

function cursorOf<T>(data: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(data),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function conflict(over: Partial<ConflictDoc> = {}): ConflictDoc {
  return {
    _id: "war_us_ru_10",
    conflictId: 1,
    name: "Test War",
    hostCountry: "RU",
    region: "eeu",
    type: "interstate",
    sideA: { label: "US", countries: ["US"], kind: "state" },
    sideB: { label: "RU", countries: ["RU"], kind: "state" },
    bloc: "contested",
    terrain: "plains",
    severity: "MEDIUM",
    baseStrength: 320,
    supplyA: 80,
    supplyB: 80,
    terr: 1,
    infra: 50,
    enemyMix: [],
    intensity: 40,
    control: 100,
    controlStart: 100,
    status: "active",
    createdBy: "player",
    startTurn: 10,
    ...over,
  } as ConflictDoc;
}

let db: MockDb;

function wire(conflicts: ConflictDoc[], units: Array<Record<string, unknown>> = []) {
  db.collection("conflicts").find.mockReturnValue(cursorOf(conflicts));
  db.collection("militaryUnits").find.mockReturnValue(cursorOf(units));
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
});

describe("computeWarApproval", () => {
  it("produces nothing for a country at peace", async () => {
    wire([]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, 0);
    expect(result.modifiers).toEqual([]);
    expect(result.total).toBe(0);
  });

  /**
   * resolveConflict stamps status and endTurn but never deletes the document.
   * Without a liveness filter, `turn - entry` on a war that ended years ago
   * keeps growing and every country that has ever fought drifts to the floor.
   */
  it("ignores wars that have already been resolved", async () => {
    wire([conflict({ status: "resolved", endTurn: 60 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 5000, 0);
    expect(result.modifiers).toEqual([]);
  });

  it("ignores a conflict the country merely hosts without fighting", async () => {
    wire([
      conflict({ hostCountry: "US", sideA: { label: "x", countries: ["FR"], kind: "state" } }),
    ]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, 0);
    expect(result.modifiers).toEqual([]);
  });

  it("scores a war and reports a single chip", async () => {
    wire([conflict({ startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, 0);
    expect(result.modifiers).toHaveLength(1);
    expect(result.modifiers[0]!.id).toBe("war");
    expect(result.modifiers[0]!.source).toBe("war");
  });

  it("damps the block rather than applying its full total at once", async () => {
    wire([conflict({ startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 5000, 0);
    // Raw would be deep in the floor; one turn moves at most two points.
    expect(result.total).toBe(-2);
    expect(result.modifiers[0]!.effect).toBe(-2);
  });

  it("retires the block gradually once the war is over", async () => {
    wire([]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, -9);
    expect(result.total).toBe(-7);
    expect(result.modifiers[0]!.effect).toBe(-7);
  });

  /** The exhaustion clock and the war-effort baseline both run from own entry. */
  it("bills a late joiner from its own entry, not the war's start", async () => {
    const late = conflict({
      startTurn: 10,
      sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
      joinTurns: [{ countryId: "UK", turn: 900, control: 100 }],
    });
    wire([late]);
    const founder = await computeWarApproval(db as unknown as Db, "US", 902, 0);
    const joiner = await computeWarApproval(db as unknown as Db, "UK", 902, 0);
    expect(joiner.total).toBeGreaterThan(founder.total);
  });

  it("picks the war the country has personally fought longest", async () => {
    const old = conflict({ _id: "old", startTurn: 10 });
    const recent = conflict({
      _id: "recent",
      startTurn: 800,
      joinTurns: [{ countryId: "US", turn: 800, control: 100 }],
    });
    wire([recent, old]);
    const result = await computeWarApproval(db as unknown as Db, "US", 1000, 0);
    expect(result.modifiers[0]!.breakdown?.some((p) => p.id === "war_exhaustion")).toBe(true);
    // Scored against the older war, so exhaustion is deep rather than shallow.
    const exhaustion = result.modifiers[0]!.breakdown!.find((p) => p.id === "war_exhaustion")!;
    expect(exhaustion.effect).toBeLessThan(-15);
  });

  /**
   * A find() with no sort has no guaranteed order, so two wars a country
   * entered on the same turn could swap places between turns and make the
   * block oscillate. Selection has to be total, not merely by entry turn.
   */
  it("picks the same war on every turn when two were entered together", async () => {
    // Same entry turn, very different fronts, so a flip in selection order
    // shows up as a different score rather than hiding behind equal inputs.
    const a = conflict({ _id: "aaa", startTurn: 10, control: 100 });
    const b = conflict({ _id: "bbb", startTurn: 10, control: 0 });

    const effortOf = (r: Awaited<ReturnType<typeof computeWarApproval>>) =>
      r.modifiers[0]!.breakdown!.find((p) => p.id === "war_effort")!.effect;

    wire([a, b]);
    const first = await computeWarApproval(db as unknown as Db, "US", 500, 0);
    wire([b, a]);
    const second = await computeWarApproval(db as unknown as Db, "US", 500, 0);

    // Compared on the undamped part: the block total is clamped to the damping
    // step, which would hide a flip behind an identical -2 either way.
    expect(effortOf(first)).toBe(effortOf(second));
  });

  it("does not score alliance contribution for a country that declared the war", async () => {
    wire([conflict({ startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, 0);
    const ids = result.modifiers[0]!.breakdown!.map((p) => p.id);
    expect(ids).not.toContain("alliance_contribution");
  });

  it("scores alliance contribution for a treaty pulled ally", async () => {
    const withAlly = conflict({
      startTurn: 10,
      sideB: { label: "Pact", countries: ["RU", "PL"], kind: "coalition" },
      treatyEntries: [
        { countryId: "PL", organizationId: "WARSAW_PACT", defending: "RU", joinedTurn: 10 },
      ],
    });
    wire(
      [withAlly],
      [
        { countryId: "RU", theaterId: "war_us_ru_10", personnel: 100000 },
        { countryId: "PL", theaterId: "war_us_ru_10", personnel: 0 },
      ]
    );
    const result = await computeWarApproval(db as unknown as Db, "PL", 500, 0);
    const ids = result.modifiers[0]!.breakdown!.map((p) => p.id);
    expect(ids).toContain("alliance_contribution");
  });

  /**
   * A corrupt conflict document must not put a NaN into governmentApprovals.
   * NaN survives the clamps and the damping step, and once stored the rating
   * arithmetic downstream is poisoned until something overwrites it.
   */
  it("never persists a non-finite total from a corrupt conflict", async () => {
    wire([conflict({ control: Number.NaN, controlStart: Number.NaN })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, -4);
    expect(Number.isFinite(result.total)).toBe(true);
    for (const modifier of result.modifiers) {
      expect(Number.isFinite(modifier.effect)).toBe(true);
    }
  });

  /**
   * The provider runs inside runPhase("approvalSnapshot") across every country in
   * one Promise.all, so a throw would kill the snapshot for all of them. Holding
   * the previous total also stops a transient failure reading as "target zero"
   * and walking the block down and back up again.
   */
  it("holds the previous total when the read fails", async () => {
    db.collection("conflicts").find.mockImplementation(() => {
      throw new Error("mongo is having a day");
    });
    const result = await computeWarApproval(db as unknown as Db, "US", 100, -6);
    expect(result.total).toBe(-6);
    expect(result.modifiers[0]!.effect).toBe(-6);
  });
});
