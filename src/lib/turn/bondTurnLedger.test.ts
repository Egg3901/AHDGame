import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { BOND_HISTORY_INTEREST_INDEX_KEY, loadPriorBondInterest } from "./bondTurnLedger";

const byId = (rows: Array<{ _id: ObjectId; maxInterest: number }>) =>
  Object.fromEntries(rows.map((row) => [row._id.toHexString(), row.maxInterest]));

function historyWorld() {
  const memory = createInMemoryDb();
  const ids = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
  // Out of order on purpose, with a dip (an older heal) and a bond with no history.
  memory.seed("bondHistory", [
    { bondId: ids[0], turn: 3, totalInterestPaid: 30.25 },
    { bondId: ids[1], turn: 1, totalInterestPaid: 5 },
    { bondId: ids[0], turn: 1, totalInterestPaid: 10.5 },
    { bondId: ids[0], turn: 4, totalInterestPaid: 29 },
    { bondId: ids[1], turn: 2, totalInterestPaid: 12.75 },
    { bondId: ids[2], turn: 9, totalInterestPaid: 0 },
    { bondId: new ObjectId(), turn: 9, totalInterestPaid: 1e9 },
  ]);
  return { memory, ids };
}

describe("loadPriorBondInterest", () => {
  it("returns the same per-bond maximum as the $max pipeline it replaces", async () => {
    const { memory, ids } = historyWorld();
    const db = memory as unknown as Db;
    const legacy = await db
      .collection("bondHistory")
      .aggregate<{ _id: ObjectId; maxInterest: number }>([
        { $match: { bondId: { $in: ids } } },
        { $group: { _id: "$bondId", maxInterest: { $max: "$totalInterestPaid" } } },
      ])
      .toArray();

    const rows = await loadPriorBondInterest(db, ids);

    expect(byId(rows)).toEqual(byId(legacy));
    expect(byId(rows)).toEqual({
      [ids[0]!.toHexString()]: 30.25,
      [ids[1]!.toHexString()]: 12.75,
      [ids[2]!.toHexString()]: 0,
    });
  });

  it("asks for the per-bond maximum through the index, sorted on its key", async () => {
    const { memory, ids } = historyWorld();
    const col = memory.collection("bondHistory");
    const aggregate = vi.spyOn(col, "aggregate");

    await loadPriorBondInterest(memory as unknown as Db, ids);

    expect(aggregate).toHaveBeenCalledTimes(1);
    const [pipeline, options] = aggregate.mock.calls[0] as unknown as [
      Array<Record<string, unknown>>,
      { hint?: unknown },
    ];
    expect(pipeline[1]).toEqual({ $sort: BOND_HISTORY_INTEREST_INDEX_KEY });
    expect(options.hint).toEqual(BOND_HISTORY_INTEREST_INDEX_KEY);
  });

  it("falls back to the $max pipeline when the index is not installed yet", async () => {
    const { memory, ids } = historyWorld();
    const col = memory.collection("bondHistory");
    const real = col.aggregate.bind(col);
    const aggregate = vi.spyOn(col, "aggregate").mockImplementationOnce(
      () =>
        ({
          toArray: async () => {
            throw Object.assign(
              new Error("hint provided does not correspond to an existing index"),
              {
                codeName: "BadValue",
                code: 2,
              }
            );
          },
        }) as never
    );
    aggregate.mockImplementation((pipeline) => real(pipeline));

    const rows = await loadPriorBondInterest(memory as unknown as Db, ids);

    expect(aggregate).toHaveBeenCalledTimes(2);
    expect((aggregate.mock.calls[1]![0] as unknown[])[1]).toEqual({
      $group: { _id: "$bondId", maxInterest: { $max: "$totalInterestPaid" } },
    });
    expect(byId(rows)[ids[0]!.toHexString()]).toBe(30.25);
  });

  it("does not hide other failures behind the fallback", async () => {
    const { memory, ids } = historyWorld();
    const col = memory.collection("bondHistory");
    vi.spyOn(col, "aggregate").mockImplementation(
      () =>
        ({
          toArray: async () => {
            throw Object.assign(new Error("socket closed"), { codeName: "HostUnreachable" });
          },
        }) as never
    );

    await expect(loadPriorBondInterest(memory as unknown as Db, ids)).rejects.toThrow(
      "socket closed"
    );
  });
});
