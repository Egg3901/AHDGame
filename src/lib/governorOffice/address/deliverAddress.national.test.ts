import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { deliverAddress } from "./deliverAddress";

/**
 * Focused unit test: national-scope deliverAddress fan-out.
 *
 * Covers the new branch that, when stateId is a national pseudo-stateId
 * (e.g. "federal"), iterates every state in the country and applies the
 * demographic turnout boost per-state with headroom clamping, recording
 * each actual applied delta in `turnoutDeltasByState` on the address row.
 */

interface MockState {
  _id: string;
  countryId: string;
}

interface MockTurnout {
  _id: string;
  modifiers: { voterGroups: Record<string, number> };
}

function makeMockDb(seed: {
  currentTurn: number;
  officeAP: number;
  charNPI: number;
  states: MockState[];
  turnoutDocs: MockTurnout[];
}) {
  const captured = {
    insertedAddress: null as unknown,
    bulkTurnoutOps: [] as Array<{ stateId: string; group: string; inc: number }>,
    singleTurnoutOps: [] as Array<{ stateId: string; group: string; inc: number }>,
    officeUpdates: [] as Array<{ inc: number }>,
    charUpdates: [] as Array<{ inc: number }>,
  };

  const collections = {
    gameState: {
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: seed.currentTurn }),
    },
    governorAddresses: {
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          limit: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      insertOne: vi.fn(async (doc: unknown) => {
        captured.insertedAddress = doc;
        return { insertedId: new ObjectId() };
      }),
    },
    governorOfficeState: {
      updateOne: vi.fn(async (_filter: unknown, update: { $inc?: Record<string, number> }) => {
        const inc = update.$inc?.gubernatorialActions ?? 0;
        captured.officeUpdates.push({ inc });
        // Office AP debit succeeds on first call (AP >= cost).
        return { modifiedCount: seed.officeAP >= 1 || inc > 0 ? 1 : 0 };
      }),
    },
    characters: {
      updateOne: vi.fn(async (_filter: unknown, update: { $inc?: Record<string, number> }) => {
        const inc = update.$inc?.nationalInfluence ?? 0;
        captured.charUpdates.push({ inc });
        return { modifiedCount: seed.charNPI >= 5 ? 1 : 0 };
      }),
    },
    states: {
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(seed.states) })),
    },
    stateDemographicTurnout: {
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(seed.turnoutDocs) })),
      findOne: vi.fn(async (filter: { _id: string }) => {
        return seed.turnoutDocs.find((t) => t._id === filter._id) ?? null;
      }),
      bulkWrite: vi.fn(
        async (
          ops: Array<{
            updateOne: {
              filter: { _id: string };
              update: { $inc?: Record<string, number> };
            };
          }>
        ) => {
          for (const op of ops) {
            for (const [key, val] of Object.entries(op.updateOne.update.$inc ?? {})) {
              const group = key.split(".").pop()!;
              captured.bulkTurnoutOps.push({
                stateId: op.updateOne.filter._id,
                group,
                inc: val as number,
              });
            }
          }
          return { modifiedCount: ops.length };
        }
      ),
      updateOne: vi.fn(
        async (filter: { _id: string }, update: { $inc?: Record<string, number> }) => {
          for (const [key, val] of Object.entries(update.$inc ?? {})) {
            const group = key.split(".").pop()!;
            captured.singleTurnoutOps.push({
              stateId: filter._id,
              group,
              inc: val as number,
            });
          }
          return { modifiedCount: 1 };
        }
      ),
    },
  };

  const db = {
    collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
  } as unknown as Db;

  return { db, captured };
}

describe("deliverAddress — national fan-out", () => {
  it("applies turnout boost to every state, clamped per-state by headroom", async () => {
    // Seed: US national address. CA already at +18 (headroom 2), TX at 0
    // (headroom 20 → applies full +5), NY missing turnout doc (headroom 20).
    const charId = new ObjectId();
    const { db, captured } = makeMockDb({
      currentTurn: 100,
      officeAP: 3,
      charNPI: 10,
      states: [
        { _id: "CA", countryId: "US" },
        { _id: "TX", countryId: "US" },
        { _id: "NY", countryId: "US" },
      ],
      turnoutDocs: [
        { _id: "CA", modifiers: { voterGroups: { college_liberals: 18 } } },
        { _id: "TX", modifiers: { voterGroups: { college_liberals: 0 } } },
        // NY: no doc — upsert path with headroom 20.
      ],
    });

    const result = await deliverAddress(db, {
      countryId: "US",
      stateId: "federal",
      character: { _id: charId, name: "President", party: "1" },
      title: "National address title",
      emphasizedCategories: ["economic"],
      targetDemographicGroupId: "college_liberals",
    });

    expect(result.status).toBe(200);

    // Bulk write applied to all 3 states; CA clamped to +2, TX/NY full +5.
    const byState = new Map(captured.bulkTurnoutOps.map((op) => [op.stateId, op.inc]));
    expect(byState.get("CA")).toBe(2);
    expect(byState.get("TX")).toBe(5);
    expect(byState.get("NY")).toBe(5);

    // Single-state path NOT taken — national branch must avoid the state path.
    expect(captured.singleTurnoutOps).toHaveLength(0);

    // Address row has per-state map; scalar reflects sum (representative value).
    const addr = captured.insertedAddress as {
      demographicEffect: { turnoutDelta: number; turnoutDeltasByState: Record<string, number> };
      stateId: string;
    };
    expect(addr.stateId).toBe("federal");
    expect(addr.demographicEffect.turnoutDeltasByState).toEqual({ CA: 2, TX: 5, NY: 5 });
    expect(addr.demographicEffect.turnoutDelta).toBe(12);
  });

  it("state-scope path is unchanged (regression guard)", async () => {
    const charId = new ObjectId();
    const { db, captured } = makeMockDb({
      currentTurn: 100,
      officeAP: 3,
      charNPI: 10,
      states: [{ _id: "AZ", countryId: "US" }],
      turnoutDocs: [{ _id: "AZ", modifiers: { voterGroups: { college_liberals: 0 } } }],
    });

    const result = await deliverAddress(db, {
      countryId: "US",
      stateId: "AZ",
      character: { _id: charId, name: "Governor", party: "1" },
      title: "State address title",
      emphasizedCategories: ["economic"],
      targetDemographicGroupId: "college_liberals",
    });

    expect(result.status).toBe(200);
    expect(captured.bulkTurnoutOps).toHaveLength(0);
    expect(captured.singleTurnoutOps).toHaveLength(1);
    expect(captured.singleTurnoutOps[0]).toEqual({
      stateId: "AZ",
      group: "college_liberals",
      inc: 5,
    });

    const addr = captured.insertedAddress as {
      demographicEffect: { turnoutDelta: number; turnoutDeltasByState?: Record<string, number> };
    };
    expect(addr.demographicEffect.turnoutDelta).toBe(5);
    expect(addr.demographicEffect.turnoutDeltasByState).toBeUndefined();
  });
});
