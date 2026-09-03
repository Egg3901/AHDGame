import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getFundsByPartyForElection } from "./fundsByParty";

function stubDb(rows: Array<Record<string, unknown>>) {
  return {
    collection: vi.fn().mockReturnValue({
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  } as unknown as Db;
}

describe("getFundsByPartyForElection", () => {
  it("sums carried stock plus the live accumulator per party (ticket #1261)", async () => {
    const db = stubDb([
      { party: "dem", spendStock: 40_000, spendThisTurn: 10_000 },
      { party: "dem", spendStock: 5_000 },
      { party: "rep", spendThisTurn: 1_000 },
    ]);
    const funds = await getFundsByPartyForElection(new ObjectId(), db);
    expect(funds.get("dem")).toBe(55_000);
    expect(funds.get("rep")).toBe(1_000);
  });

  it("treats missing fields as zero and omits zero-spend parties", async () => {
    const db = stubDb([{ party: "dem" }, { party: "rep", spendStock: 0, spendThisTurn: 0 }]);
    const funds = await getFundsByPartyForElection(new ObjectId(), db);
    expect(funds.size).toBe(0);
  });

  it("returns an empty map when the race has no campaigns", async () => {
    const funds = await getFundsByPartyForElection(new ObjectId(), stubDb([]));
    expect(funds.size).toBe(0);
  });
});
