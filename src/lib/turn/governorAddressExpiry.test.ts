import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processGovernorAddressExpiry } from "./governorAddressExpiry";

interface MockAddress {
  _id: ObjectId;
  countryId: string;
  stateId: string;
  targetDemographicGroupId?: string;
  approvalEffect: { amount: number; expiresAtTurn: number; expired?: boolean };
  demographicEffect: {
    turnoutDelta?: number;
    turnoutDeltasByState?: Record<string, number>;
    expiresAtTurn: number;
    expired?: boolean;
  };
}

interface MockTurnout {
  _id: string;
  modifiers: { voterGroups: Record<string, number> };
}

function makeMockDb(seed: { candidates: MockAddress[]; turnoutDocs: MockTurnout[] }) {
  const captured = {
    addressUpdates: [] as Array<{ id: ObjectId; set: Record<string, unknown> }>,
    bulkOps: [] as Array<{ stateId: string; setKey: string; setVal: unknown }>,
    singleUpdates: [] as Array<{ stateId: string; setKey: string; setVal: unknown }>,
  };

  const collections = {
    governorAddresses: {
      find: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue(seed.candidates),
      })),
      updateOne: vi.fn(
        async (filter: { _id: ObjectId }, update: { $set: Record<string, unknown> }) => {
          captured.addressUpdates.push({ id: filter._id, set: update.$set });
          return { modifiedCount: 1 };
        }
      ),
    },
    stateDemographicTurnout: {
      find: vi.fn(({ _id }: { _id: { $in: string[] } }) => ({
        toArray: vi.fn().mockResolvedValue(seed.turnoutDocs.filter((d) => _id.$in.includes(d._id))),
      })),
      findOne: vi.fn(async (filter: { _id: string }) => {
        return seed.turnoutDocs.find((d) => d._id === filter._id) ?? null;
      }),
      bulkWrite: vi.fn(
        async (
          ops: Array<{
            updateOne: {
              filter: { _id: string };
              update: { $set: Record<string, unknown> };
            };
          }>
        ) => {
          for (const op of ops) {
            for (const [key, val] of Object.entries(op.updateOne.update.$set)) {
              if (key === "lastUpdated") continue;
              captured.bulkOps.push({
                stateId: op.updateOne.filter._id,
                setKey: key,
                setVal: val,
              });
            }
          }
          return { modifiedCount: ops.length };
        }
      ),
      updateOne: vi.fn(
        async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
          for (const [key, val] of Object.entries(update.$set)) {
            if (key === "lastUpdated") continue;
            captured.singleUpdates.push({
              stateId: filter._id,
              setKey: key,
              setVal: val,
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

describe("processGovernorAddressExpiry — turnout revert", () => {
  it("reverts per-state map for national addresses, clamped to -20", async () => {
    const addrId = new ObjectId();
    const { db, captured } = makeMockDb({
      candidates: [
        {
          _id: addrId,
          countryId: "US",
          stateId: "federal",
          targetDemographicGroupId: "college_liberals",
          approvalEffect: { amount: 3, expiresAtTurn: 50, expired: true },
          demographicEffect: {
            turnoutDelta: 12,
            turnoutDeltasByState: { CA: 2, TX: 5, NY: 5 },
            expiresAtTurn: 50,
          },
        },
      ],
      turnoutDocs: [
        // CA was at +18 after the address; reverting -2 → +16.
        { _id: "CA", modifiers: { voterGroups: { college_liberals: 18 } } },
        // TX at +5 → 0.
        { _id: "TX", modifiers: { voterGroups: { college_liberals: 5 } } },
        // NY at +5 → 0.
        { _id: "NY", modifiers: { voterGroups: { college_liberals: 5 } } },
      ],
    });

    const result = await processGovernorAddressExpiry(db, 100);
    expect(result.demographicExpired).toBe(1);
    expect(result.turnoutReverted).toBe(3);

    const byState = new Map(captured.bulkOps.map((op) => [op.stateId, op.setVal]));
    expect(byState.get("CA")).toBe(16);
    expect(byState.get("TX")).toBe(0);
    expect(byState.get("NY")).toBe(0);

    // Single-state path NOT taken when the per-state map is present.
    expect(captured.singleUpdates).toHaveLength(0);
  });

  it("falls back to scalar turnoutDelta for state-scope addresses", async () => {
    const addrId = new ObjectId();
    const { db, captured } = makeMockDb({
      candidates: [
        {
          _id: addrId,
          countryId: "US",
          stateId: "AZ",
          targetDemographicGroupId: "college_liberals",
          approvalEffect: { amount: 3, expiresAtTurn: 50, expired: true },
          demographicEffect: {
            turnoutDelta: 5,
            expiresAtTurn: 50,
          },
        },
      ],
      turnoutDocs: [{ _id: "AZ", modifiers: { voterGroups: { college_liberals: 5 } } }],
    });

    const result = await processGovernorAddressExpiry(db, 100);
    expect(result.turnoutReverted).toBe(1);
    expect(captured.singleUpdates).toHaveLength(1);
    expect(captured.singleUpdates[0].stateId).toBe("AZ");
    expect(captured.singleUpdates[0].setVal).toBe(0);
    expect(captured.bulkOps).toHaveLength(0);
  });

  it("skips revert when neither scalar nor map is recorded (legacy row)", async () => {
    const addrId = new ObjectId();
    const { db, captured } = makeMockDb({
      candidates: [
        {
          _id: addrId,
          countryId: "US",
          stateId: "AZ",
          approvalEffect: { amount: 3, expiresAtTurn: 50, expired: true },
          demographicEffect: { expiresAtTurn: 50 },
        },
      ],
      turnoutDocs: [],
    });

    const result = await processGovernorAddressExpiry(db, 100);
    expect(result.turnoutReverted).toBe(0);
    expect(captured.bulkOps).toHaveLength(0);
    expect(captured.singleUpdates).toHaveLength(0);
  });
});
