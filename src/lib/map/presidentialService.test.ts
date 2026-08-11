import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

function arrayCursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("computePresidentialMap", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("resolves per-candidate colors from party sequentialIds, not party-name strings", async () => {
    const coll = (name: string) =>
      db.collection(name) as unknown as ReturnType<typeof db.collection>;

    // Parties keyed by sequentialId with custom colors — candidateParties stores
    // these sequentialId strings, never "democrat"/"republican".
    coll("politicalParties").find.mockReturnValue(
      arrayCursor([
        { _id: "p3", sequentialId: 3, color: "#FF8800", countryId: "US" },
        { _id: "p7", sequentialId: 7, color: "#00AA55", countryId: "US" },
      ])
    );
    coll("states").find.mockReturnValue(arrayCursor([]));

    coll("elections").findOne.mockResolvedValue({
      _id: "pres-election",
      countryId: "US",
      state: "US",
      status: "active",
    });

    coll("electionVoteTallies").findOne.mockResolvedValue({
      electionId: "pres-election",
      totalVotes: { candA: 1000, candB: 500 },
      candidateParties: { candA: "3", candB: "7" },
      candidateNames: { candA: "Alice", candB: "Bob" },
    });

    coll("electionCandidates").find.mockReturnValue(arrayCursor([]));

    const { computePresidentialMap } = await import("./presidentialService");
    const result = await computePresidentialMap(db as unknown as Db, "US");

    expect(result.presidentialCandidateColors).toEqual({
      candA: "#FF8800",
      candB: "#00AA55",
    });
  });
});
