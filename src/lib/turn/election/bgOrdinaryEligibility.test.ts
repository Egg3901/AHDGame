import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "@/lib/countries/bg/rules/assemblyTransition";
import {
  BG_ORDINARY_PLANS_COLLECTION,
  readBgOrdinaryElectionPlan,
  type BgOrdinaryPlanRecord,
  readBgOrdinaryEligibleParties,
} from "./bgOrdinaryEligibility";

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

describe("Bulgarian immutable ordinary national count", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  function ready() {
    const db = createMockDb();
    const elections = Object.keys(BG_ORDINARY_ASSEMBLY_SEATS).map((state) => ({
      _id: new ObjectId(),
      state,
      status: "completed",
      cycle: 2,
    }));
    const nominees = elections.flatMap((election) =>
      ["A", "B"].map((party) => ({
        _id: new ObjectId(),
        electionId: election._id,
        nppId: new ObjectId(),
        isNPP: true,
        party,
        enteredAt: now,
        status: "active",
      }))
    );
    const tallies = elections.map((election) => ({
      electionId: election._id,
      finalized: false,
      totalVotes: Object.fromEntries(
        nominees
          .filter((row) => row.electionId.equals(election._id))
          .map((row) => [row._id.toHexString(), row.party === "A" ? 600 : 400])
      ),
    }));
    db.collection("elections").find.mockReturnValue({ toArray: async () => elections });
    db.collection("electionCandidates").find.mockReturnValue({ toArray: async () => nominees });
    db.collection("electionVoteTallies").find.mockReturnValue({ toArray: async () => tallies });
    db.collection("npps").find.mockReturnValue({
      toArray: async () => nominees.map((row) => ({ _id: row.nppId })),
    });
    const journal = db.collection(BG_ORDINARY_PLANS_COLLECTION);
    let receipt: BgOrdinaryPlanRecord | null = null;
    journal.findOne.mockImplementation(async () => receipt);
    journal.updateOne.mockImplementation(async (filter, update) => {
      receipt ??= { _id: filter._id, ...update.$setOnInsert };
      return { matchedCount: 1, modifiedCount: 1 };
    });
    return { db, elections, nominees, tallies, journal };
  }

  it("freezes all31 district and240 national mandates, then replays without ballot reads", async () => {
    const { db, journal, elections } = ready();
    const plan = await readBgOrdinaryElectionPlan(db as unknown as Db, 2, now);
    expect(plan?.partySeats).toEqual({ A: 144, B: 96 });
    expect(Object.keys(plan!.districtSeats)).toHaveLength(31);
    expect(journal.updateOne).toHaveBeenCalledWith(
      { _id: "BG:ordinary:2" },
      {
        $setOnInsert: expect.objectContaining({
          cycle: 2,
          electionIds: elections.map((row) => row._id.toHexString()),
        }),
      },
      { upsert: true }
    );
    db.collectionMocks.elections.find.mockClear();
    db.collectionMocks.electionCandidates.find.mockClear();
    expect(await readBgOrdinaryElectionPlan(db as unknown as Db, 2, now)).toEqual(plan);
    expect(db.collectionMocks.elections.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionCandidates.find).not.toHaveBeenCalled();
  });

  it("defers missing, live or previously settled legacy regional ballots without changing custody", async () => {
    for (const status of ["active"]) {
      const { db, elections, journal } = ready();
      elections[0].status = status;
      expect(await readBgOrdinaryElectionPlan(db as unknown as Db, 2, now)).toBeNull();
      expect(journal.updateOne).not.toHaveBeenCalled();
    }
    const settled = ready();
    for (const row of settled.elections) row.status = "resolved";
    expect(await readBgOrdinaryElectionPlan(settled.db as unknown as Db, 2, now)).toBeNull();
    expect(settled.journal.updateOne).not.toHaveBeenCalled();
    const { db, tallies, journal } = ready();
    tallies.splice(0, 1);
    expect(await readBgOrdinaryElectionPlan(db as unknown as Db, 2, now)).toBeNull();
    expect(journal.updateOne).not.toHaveBeenCalled();
  });

  it("does not replace a receipt failure with regional reallocation", async () => {
    const { db, journal } = ready();
    journal.updateOne.mockRejectedValue(new Error("receipt unavailable"));
    await expect(readBgOrdinaryElectionPlan(db as unknown as Db, 2, now)).rejects.toThrow(
      "receipt unavailable"
    );
    expect(db.collectionMocks.electedOfficials).toBeUndefined();
  });

  it("does not allocate a retired profile's list seats to invented holders", async () => {
    const { db, journal } = ready();
    db.collection("npps").find.mockReturnValue({ toArray: async () => [] });
    expect(await readBgOrdinaryElectionPlan(db as unknown as Db, 2, now)).toBeNull();
    expect(journal.updateOne).not.toHaveBeenCalled();
  });
});
