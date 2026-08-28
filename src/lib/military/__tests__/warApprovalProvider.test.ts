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
  const fresh = { exhaustion: undefined, conflictId: null };
  const chipOf = (r: Awaited<ReturnType<typeof computeWarApproval>>, id: string) =>
    r.modifiers.find((m) => m.id === id);

  it("produces nothing for a country at peace that has never fought", async () => {
    wire([]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, fresh);
    expect(result.modifiers).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.exhaustion).toBe(0);
  });

  /**
   * resolveConflict stamps status and endTurn but never deletes the document.
   * Without a liveness filter, `turn - entry` on a war that ended years ago
   * keeps growing and every country that has ever fought drifts to the floor.
   */
  it("ignores wars that have already been resolved", async () => {
    wire([conflict({ status: "resolved", endTurn: 60 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 5000, fresh);
    expect(result.modifiers).toEqual([]);
  });

  it("ignores a conflict the country merely hosts without fighting", async () => {
    wire([
      conflict({ hostCountry: "US", sideA: { label: "x", countries: ["FR"], kind: "state" } }),
    ]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, fresh);
    expect(result.modifiers).toEqual([]);
  });

  it("reports one chip per war term while the fighting is live", async () => {
    wire([conflict({ startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, fresh);
    expect(result.modifiers.map((m) => m.id)).toEqual(["war_exhaustion", "war_effort"]);
    for (const modifier of result.modifiers) expect(modifier.source).toBe("war");
  });

  /**
   * The block total used to be damped as a block, which is what forced it into a
   * single chip: a damped total cannot be attributed back across its parts
   * without inverting. Exhaustion is now an integrator that cannot move faster
   * than a point per in-game year, so nothing needs damping and the chips add up.
   */
  it("reports a total that is exactly the sum of its chips", async () => {
    wire([conflict({ startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, fresh);
    const sum = result.modifiers.reduce((s, m) => s + m.effect, 0);
    expect(result.total).toBeCloseTo(sum, 5);
  });

  it("seeds an existing war from the old curve rather than rallying it to plus one", async () => {
    wire([conflict({ startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 490, fresh);
    // 480 turns in: ten in-game years, so nine points of exhaustion spent.
    expect(chipOf(result, "war_exhaustion")!.effect).toBe(-9);
  });

  it("accrues exhaustion against the war it is already scoring", async () => {
    wire([conflict({ _id: "war_us_ru_10", startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, {
      exhaustion: -2,
      conflictId: "war_us_ru_10",
    });
    expect(result.exhaustion).toBeLessThan(-2);
    expect(result.conflictId).toBe("war_us_ru_10");
  });

  /**
   * The cooldown, end to end. A country that fought itself to -3 and signs peace
   * keeps the residue and heals it a point per in-game year, so declaring again
   * next turn does not hand it a clean slate.
   */
  it("keeps healing exhaustion after the war is over", async () => {
    wire([]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, {
      exhaustion: -3,
      conflictId: "war_us_ru_10",
    });
    expect(result.exhaustion).toBeGreaterThan(-3);
    expect(result.exhaustion).toBeLessThan(0);
    expect(chipOf(result, "war_exhaustion")!.effect).toBe(-3);
  });

  it("drops the front terms the moment the fighting stops", async () => {
    wire([]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, {
      exhaustion: -3,
      conflictId: "war_us_ru_10",
    });
    expect(result.modifiers.map((m) => m.id)).toEqual(["war_exhaustion"]);
  });

  it("tells the player the exhaustion is recovering once the war is over", async () => {
    wire([]);
    const result = await computeWarApproval(db as unknown as Db, "US", 100, {
      exhaustion: -3,
      conflictId: "war_us_ru_10",
    });
    expect(result.modifiers[0]!.label).toBe("War exhaustion (recovering)");
  });

  /**
   * A failed read is not peace. The war may well still be running, so the
   * held-over exhaustion must not tell the player the fighting has stopped.
   */
  it("does not claim a war has ended when the read merely failed", async () => {
    db.collection("conflicts").find.mockImplementation(() => {
      throw new Error("mongo is having a day");
    });
    const result = await computeWarApproval(db as unknown as Db, "US", 100, {
      exhaustion: -6,
      conflictId: "war_us_ru_10",
    });
    expect(result.modifiers[0]!.label).toBe("War exhaustion");
  });

  /** The exhaustion clock and the war-effort baseline both run from own entry. */
  it("bills a late joiner from its own entry, not the war's start", async () => {
    const late = conflict({
      startTurn: 10,
      sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
      joinTurns: [{ countryId: "UK", turn: 900, control: 100 }],
    });
    wire([late]);
    const founder = await computeWarApproval(db as unknown as Db, "US", 902, fresh);
    const joiner = await computeWarApproval(db as unknown as Db, "UK", 902, fresh);
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
    const result = await computeWarApproval(db as unknown as Db, "US", 1000, fresh);
    // Scored against the older war, so exhaustion is deep rather than shallow.
    expect(chipOf(result, "war_exhaustion")!.effect).toBeLessThan(-15);
    expect(result.conflictId).toBe("old");
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

    wire([a, b]);
    const first = await computeWarApproval(db as unknown as Db, "US", 500, fresh);
    wire([b, a]);
    const second = await computeWarApproval(db as unknown as Db, "US", 500, fresh);

    expect(chipOf(first, "war_effort")!.effect).toBe(chipOf(second, "war_effort")!.effect);
    expect(first.conflictId).toBe(second.conflictId);
  });

  it("does not score alliance contribution for a country that declared the war", async () => {
    wire([conflict({ startTurn: 10 })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, fresh);
    expect(result.modifiers.map((m) => m.id)).not.toContain("alliance_contribution");
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
    const result = await computeWarApproval(db as unknown as Db, "PL", 500, fresh);
    expect(result.modifiers.map((m) => m.id)).toContain("alliance_contribution");
  });

  /**
   * A corrupt conflict document must not put a NaN into governmentApprovals.
   * NaN survives the clamps, and once stored the rating arithmetic downstream is
   * poisoned until something overwrites it.
   */
  it("never persists a non-finite total from a corrupt conflict", async () => {
    wire([conflict({ control: Number.NaN, controlStart: Number.NaN })]);
    const result = await computeWarApproval(db as unknown as Db, "US", 500, {
      exhaustion: -4,
      conflictId: "war_us_ru_10",
    });
    expect(Number.isFinite(result.total)).toBe(true);
    expect(Number.isFinite(result.exhaustion)).toBe(true);
    for (const modifier of result.modifiers) {
      expect(Number.isFinite(modifier.effect)).toBe(true);
    }
  });

  /**
   * The provider runs inside runPhase("approvalSnapshot") across every country in
   * one Promise.all, so a throw would kill the snapshot for all of them. Holding
   * the stored exhaustion also stops a transient failure from healing a war that
   * is still being fought, or accruing against a front nobody could read.
   */
  it("holds the stored exhaustion when the read fails", async () => {
    db.collection("conflicts").find.mockImplementation(() => {
      throw new Error("mongo is having a day");
    });
    const result = await computeWarApproval(db as unknown as Db, "US", 100, {
      exhaustion: -6,
      conflictId: "war_us_ru_10",
    });
    expect(result.exhaustion).toBe(-6);
    expect(result.conflictId).toBe("war_us_ru_10");
    expect(result.modifiers[0]!.effect).toBe(-6);
  });
});
