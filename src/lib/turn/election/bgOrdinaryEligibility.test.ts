import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "@/lib/countries/bg/rules/assemblyTransition";
import { readBgOrdinaryEligibleParties } from "./bgOrdinaryEligibility";

describe("Bulgaria 1991 national threshold read", () => {
  it("combines all five regional tallies before declaring eligible parties", async () => {
    const db = createMockDb();
    const elections = Object.entries(BG_ORDINARY_ASSEMBLY_SEATS).map(([state, totalSeats]) => ({
      _id: new ObjectId(),
      state,
      totalSeats,
      status: "completed",
    }));
    db.collection("elections").find.mockReturnValue({
      toArray: async () => elections,
    });
    db.collection("electionVoteTallies").find.mockReturnValue({
      toArray: async () =>
        elections.map((election, index) => ({
          electionId: election._id,
          totalVotes: { a: index === 0 ? 3 : 40, b: index === 0 ? 20 : 0, c: 100 },
          candidateParties: { a: "A", b: "B", c: "C" },
          turnSnapshots: [],
        })),
    });
    const eligible = await readBgOrdinaryEligibleParties(db as unknown as Db);
    expect([...eligible!].sort()).toEqual(["A", "C"]);
    expect(db.collectionMocks.elections.find).toHaveBeenCalledWith({
      countryId: "BG",
      electionType: "nationalAssembly",
      cycle: 1,
    });
  });
});
