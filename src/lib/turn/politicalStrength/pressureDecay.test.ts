import { beforeEach, describe, expect, it } from "vitest";
import { processPressureDecay } from "./pressureDecay";
import { PRESSURE_DECAY_PER_TURN } from "./strengthConstants";

interface FakeRow {
  _id: string;
  countryId: "US";
  partyId: string;
  stateId: string;
  value: number;
  lastUpdatedTurn: number;
}

function makeFakeDb(rows: FakeRow[]) {
  const ops: Array<{ _id: string; value: number; turn: number }> = [];
  return {
    rows,
    ops,
    collection<T>(name: string) {
      if (name !== "partyStrengthPressure") {
        throw new Error(`unexpected collection: ${name}`);
      }
      return {
        find: (filter: Record<string, unknown>) => ({
          toArray: async () => {
            const minVal = (filter as { value?: { $gt?: number } }).value?.$gt ?? -Infinity;
            return rows.filter((r) => r.value > minVal);
          },
        }),
        bulkWrite: async (
          operations: Array<{
            updateOne: {
              filter: { _id: string };
              update: { $set: { value: number; lastUpdatedTurn: number } };
            };
          }>
        ) => {
          for (const op of operations) {
            const idx = rows.findIndex((r) => r._id === op.updateOne.filter._id);
            if (idx >= 0) {
              rows[idx].value = op.updateOne.update.$set.value;
              rows[idx].lastUpdatedTurn = op.updateOne.update.$set.lastUpdatedTurn;
              ops.push({
                _id: op.updateOne.filter._id,
                value: op.updateOne.update.$set.value,
                turn: op.updateOne.update.$set.lastUpdatedTurn,
              });
            }
          }
          return { modifiedCount: operations.length };
        },
      } as unknown as ReturnType<T extends never ? never : never>;
    },
  };
}

describe("processPressureDecay", () => {
  let db: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    db = makeFakeDb([
      { _id: "a", countryId: "US", partyId: "1", stateId: "CA", value: 5, lastUpdatedTurn: 99 },
      { _id: "b", countryId: "US", partyId: "1", stateId: "TX", value: 2, lastUpdatedTurn: 99 },
      { _id: "c", countryId: "US", partyId: "1", stateId: "FL", value: 0, lastUpdatedTurn: 99 },
      { _id: "d", countryId: "US", partyId: "2", stateId: "CA", value: 8, lastUpdatedTurn: 99 },
    ]);
  });

  it("subtracts decay per turn, floored at 0", async () => {
    const result = await processPressureDecay(100, new Date(), db as unknown as never);
    expect(db.rows.find((r) => r._id === "a")?.value).toBe(5 - PRESSURE_DECAY_PER_TURN);
    expect(db.rows.find((r) => r._id === "b")?.value).toBe(0); // 2 - 3 floored
    expect(db.rows.find((r) => r._id === "d")?.value).toBe(8 - PRESSURE_DECAY_PER_TURN);
    expect(result.rowsScanned).toBe(3); // 3 rows have value > 0
    expect(result.rowsDecayed).toBe(3);
    expect(result.rowsAtFloor).toBe(1); // row 'b' hit the floor
  });

  it("skips rows already at 0", async () => {
    const result = await processPressureDecay(100, new Date(), db as unknown as never);
    expect(db.rows.find((r) => r._id === "c")?.value).toBe(0);
    // Row c was not in the scanned set because it was filtered out by find({value: $gt 0})
    expect(result.rowsScanned).toBe(3);
  });

  it("returns 0 ops when no rows have positive value", async () => {
    db = makeFakeDb([
      { _id: "x", countryId: "US", partyId: "1", stateId: "CA", value: 0, lastUpdatedTurn: 99 },
    ]);
    const result = await processPressureDecay(100, new Date(), db as unknown as never);
    expect(result.rowsScanned).toBe(0);
    expect(result.rowsDecayed).toBe(0);
  });
});
