import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import { processNppUnionBehavior } from "./nppUnionBehavior";
import { SEED_MEMBERSHIP_PRESSURE } from "@/lib/admin/seed/seedUnions";
import { STRIKE_CALL_MIN_UNIONIZATION } from "@/lib/unions/unionEconomy";
import { realWageIndex } from "@/lib/labour/unionization";
import { STRIKE_EXPECTATION_GAP_THRESHOLD } from "@/lib/labour/strikes";

let nppAutonomyLevel: "off" | "v3" = "v3";
let labourSystemMode: "off" | "full" = "full";

vi.mock("@/lib/nppAutonomy/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nppAutonomy/featureFlag")>();
  return {
    ...actual,
    getNppAutonomyLevel: vi.fn().mockImplementation(async () => nppAutonomyLevel),
  };
});

vi.mock("@/lib/labour/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labour/featureFlag")>();
  return {
    ...actual,
    getLabourSystemMode: vi.fn().mockImplementation(async () => labourSystemMode),
  };
});

function makeUnion(countryId: string, overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId,
    sectorType: "manufacturing",
    name: "Test Union",
    ownerId: null,
    treasury: 0,
    membershipPressure: SEED_MEMBERSHIP_PRESSURE,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Union;
}

/** A militant NPP: ambition/stubbornness both 80 → militancy 0.8, well past every gate (0.35/0.55). */
function makeMilitantNpp(countryId: string): NPP {
  return {
    _id: new ObjectId(),
    countryId,
    name: "Test NPP",
    homeState: "X",
    personality: { loyalty: 50, ambition: 80, stubbornness: 80 },
    generatedAt: new Date(),
    retiredAt: null,
  } as unknown as NPP;
}

/**
 * Minimal fake `unions`/`npps`/`corporateSectors`/`corporations` collections.
 * `bulkWrite` actually applies $set/$unset back onto the backing arrays, like
 * a real DB would, so multi-call sequencing (election then recruit) composes
 * the same way it does in production instead of only inspecting the raw ops.
 */
function mockDb({ unions, npps }: { unions: Union[]; npps: NPP[] }) {
  const unionsBulkWrite = vi.fn().mockImplementation(async (ops: unknown[]) => {
    for (const raw of ops as Array<{
      updateOne: { filter: { _id: ObjectId }; update: Record<string, unknown> };
    }>) {
      const { filter, update } = raw.updateOne;
      const union = unions.find((u) => u._id.equals(filter._id));
      if (!union) continue;
      if (update.$set) Object.assign(union, update.$set);
      if (update.$unset) {
        for (const key of Object.keys(update.$unset as Record<string, unknown>)) {
          (union as unknown as Record<string, unknown>)[key] = undefined;
        }
      }
    }
    return {};
  });
  const unionsUpdateMany = vi.fn().mockResolvedValue({});

  const db = {
    collection: (name: string) => {
      if (name === "unions") {
        return {
          find: () => ({ toArray: () => Promise.resolve(unions) }),
          bulkWrite: unionsBulkWrite,
          updateMany: unionsUpdateMany,
        };
      }
      if (name === "npps") {
        // Real query filters by countryId/retiredAt/_id — the backing array here
        // is small and entirely retiredAt: null, so returning it unfiltered is
        // equivalent for what this test exercises (union-side outcomes).
        return { find: () => ({ toArray: () => Promise.resolve(npps) }) };
      }
      if (name === "corporateSectors") {
        return {
          aggregate: () => ({ toArray: () => Promise.resolve([]) }),
          bulkWrite: vi.fn().mockResolvedValue({}),
        };
      }
      if (name === "corporations") {
        return { find: () => ({ toArray: () => Promise.resolve([]) }) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;

  return { db, unionsBulkWrite, unionsUpdateMany };
}

describe("processNppUnionBehavior", () => {
  it(
    "elects NPP leaders into every vacant union and recruits — regression: without this phase " +
      "membershipPressure is uniformly stuck across every row forever (the turn-650 sandbox " +
      "symptom: all 408 unions read exactly 0 against the ADR-5 seed of 20)",
    async () => {
      const unions = [
        makeUnion("PL", { treasury: 1000 }),
        makeUnion("PL", { treasury: 1000 }),
        makeUnion("PL", { treasury: 1000 }),
        makeUnion("HU", { treasury: 1000 }),
        makeUnion("HU", { treasury: 1000 }),
        makeUnion("HU", { treasury: 1000 }),
      ];
      const npps = [
        makeMilitantNpp("PL"),
        makeMilitantNpp("PL"),
        makeMilitantNpp("PL"),
        makeMilitantNpp("HU"),
        makeMilitantNpp("HU"),
        makeMilitantNpp("HU"),
      ];
      const { db } = mockDb({ unions, npps });

      const result = await processNppUnionBehavior(db, 1);

      // Every vacant union got an NPP leader — the precondition for anything
      // downstream (recruiting, demands, strikes) to ever happen at all.
      expect(result.leadersElected).toBe(6);
      for (const union of unions) {
        expect(union.ownerId).not.toBeNull();
        expect(union.ownerType).toBe("npp");
      }

      // A militant leader with treasury >= RECRUIT_COST recruits every union —
      // membershipPressure moves OFF the seed value this same turn.
      expect(result.recruited).toBe(6);
      const pressures = unions.map((u) => u.membershipPressure);
      for (const p of pressures) {
        expect(p).toBeGreaterThan(SEED_MEMBERSHIP_PRESSURE);
      }

      // The exact shape the audit caught: "every row reads the same frozen
      // value". Assert it is false here — this is what would fail if the
      // phase were reverted/disabled/unregistered (leadersElected would stay
      // 0 and every union would stay at its seeded, never-changing pressure).
      const allUnchanged = pressures.every((p) => p === SEED_MEMBERSHIP_PRESSURE);
      expect(allUnchanged).toBe(false);
      const allZero = pressures.every((p) => p === 0);
      expect(allZero).toBe(false);
    }
  );

  it("is a no-op when labourSystemMode is below 'unions' (never touches membershipPressure)", async () => {
    labourSystemMode = "off";
    const unions = [makeUnion("PL")];
    const npps = [makeMilitantNpp("PL")];
    const { db, unionsBulkWrite } = mockDb({ unions, npps });

    const result = await processNppUnionBehavior(db, 1);

    expect(result.leadersElected).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled();
    expect(unions[0].membershipPressure).toBe(SEED_MEMBERSHIP_PRESSURE);
    labourSystemMode = "full"; // reset for subsequent tests
  });

  it("is a no-op when NPP autonomy is below 'v3'", async () => {
    nppAutonomyLevel = "off";
    const unions = [makeUnion("PL")];
    const npps = [makeMilitantNpp("PL")];
    const { db, unionsBulkWrite } = mockDb({ unions, npps });

    const result = await processNppUnionBehavior(db, 1);

    expect(result.leadersElected).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled();
    nppAutonomyLevel = "v3"; // reset for subsequent tests
  });

  it("plants NPP strikes only on eligible sectors, with a CLOSABLE expectation gap", async () => {
    // Regression for the exploit: the plant was updateMany({countryId,sectorType})
    // with a fixed workerExpectationIndex of 2.0. That struck 0%-unionized player
    // corps, reset live strikes, ignored cooldowns, and — with wages capped at 1.5
    // — made concession impossible, looping player corps into a perma-strike. The
    // fix mirrors the player path exactly: an eligibility-filtered find and a
    // realWageIndex+threshold+0.05 plant.
    const CURRENT_TURN = 50;
    const leader = makeMilitantNpp("PL");
    // A led union past every strike gate: organised, standing unmet demand,
    // never struck (so cooled + patient), treasury to fund it.
    const union = makeUnion("PL", {
      ownerId: leader._id,
      ownerType: "npp",
      membershipPressure: 40,
      demandedWageLevel: 1.4,
      treasury: 10_000_000,
      lastCalledStrikeTurn: null,
    } as Partial<Union>);

    let strikeFindQuery: Record<string, unknown> | null = null;
    const strikePlantOps: Array<{
      updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
    }> = [];
    const eligibleSector = { _id: new ObjectId(), wageLevel: 1.0 };

    const db = {
      collection: (name: string) => {
        if (name === "unions") {
          return {
            find: () => ({ toArray: async () => [union] }),
            bulkWrite: vi.fn().mockImplementation(async (ops: unknown[]) => {
              for (const raw of ops as Array<{
                updateOne: { filter: { _id: ObjectId }; update: Record<string, unknown> };
              }>) {
                const { filter, update } = raw.updateOne;
                if (!union._id.equals(filter._id)) continue;
                if (update.$set) Object.assign(union, update.$set);
                if (update.$inc) {
                  for (const [k, v] of Object.entries(update.$inc as Record<string, number>)) {
                    (union as unknown as Record<string, number>)[k] =
                      ((union as unknown as Record<string, number>)[k] ?? 0) + v;
                  }
                }
              }
              return {};
            }),
            updateMany: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "npps") return { find: () => ({ toArray: async () => [leader] }) };
        if (name === "corporateSectors") {
          return {
            aggregate: () => ({
              toArray: async () => [
                { _id: { c: "PL", s: "manufacturing" }, avgWage: 1.0, avgMargin: 20, n: 1 },
              ],
            }),
            find: (query: Record<string, unknown>) => {
              strikeFindQuery = query;
              return { toArray: async () => [eligibleSector] };
            },
            bulkWrite: vi.fn().mockImplementation(async (ops: unknown[]) => {
              strikePlantOps.push(...(ops as typeof strikePlantOps));
              return {};
            }),
          };
        }
        // No NPP-run corporations → the concession pass returns before touching
        // corporateSectors a second time.
        if (name === "corporations") return { find: () => ({ toArray: async () => [] }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await processNppUnionBehavior(db, CURRENT_TURN);

    expect(result.strikesCalled).toBe(1);

    // (1) The eligibility filter is present — this is what confines strikes to
    // organised, not-already-striking, cooled-down sectors (player parity).
    expect(strikeFindQuery).not.toBeNull();
    expect(strikeFindQuery!.unionization).toEqual({ $gte: STRIKE_CALL_MIN_UNIONIZATION });
    expect(strikeFindQuery!.strikeStartedAtTurn).toBeNull();

    // (2) The plant is guarded and uses a CLOSABLE gap, never the fixed 2.0.
    expect(strikePlantOps).toHaveLength(1);
    const op = strikePlantOps[0].updateOne;
    expect(op.filter).toMatchObject({ strikeStartedAtTurn: null });
    const set = op.update.$set as Record<string, number>;
    expect(set.strikeStartedAtTurn).toBe(CURRENT_TURN);
    const expected = realWageIndex(1.0, undefined) + STRIKE_EXPECTATION_GAP_THRESHOLD + 0.05;
    expect(set.workerExpectationIndex).toBeCloseTo(expected, 6);
    expect(set.workerExpectationIndex).not.toBe(2.0);
    expect(set.workerExpectationIndex).toBeLessThanOrEqual(1.5 + STRIKE_EXPECTATION_GAP_THRESHOLD);
  });
});
