/**
 * Unit tests for presidential election engine.
 * Tests constants, initPresidentVoteTally structure, and electoral unit logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("presidential election engine", () => {
  describe("INDEPENDENT_VOTE_PENALTY", () => {
    it("is 0.3 (70% reduction for independents)", async () => {
      const { INDEPENDENT_VOTE_PENALTY } = await import("./presidentialElectionEngine");
      expect(INDEPENDENT_VOTE_PENALTY).toBe(0.3);
    });
  });

  describe("initPresidentVoteTally", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("creates tally with per-unit structure for all electoral units", async () => {
      const replaceOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          replaceOne,
          findOne: vi.fn().mockResolvedValue(null),
          // loadApportionment (P1d-2) reads states.find; [] → seed fallback
          find: () => ({ toArray: async () => [] }),
        }),
      } as never);

      const { initPresidentVoteTally } = await import("./presidentialElectionEngine");
      const electionId = new ObjectId();
      const candidateData = [
        { _id: new ObjectId(), characterName: "Alice", party: "democrat" },
        { _id: new ObjectId(), characterName: "Bob", party: "republican" },
      ];
      const candidates = candidateData as never[];

      await initPresidentVoteTally(electionId, candidates);

      expect(replaceOne).toHaveBeenCalledTimes(1);
      const [filter, doc] = replaceOne.mock.calls[0];
      expect(filter).toEqual({ electionId });
      expect(doc.state).toBe("US");
      expect(doc.finalized).toBe(false);
      expect(doc.totalVotes).toBeDefined();
      expect(doc.candidateNames).toBeDefined();
      expect(doc.candidateParties).toBeDefined();
      expect(doc.totalVotesByUnit).toBeDefined();

      for (const unit of ELECTORAL_VOTE_UNITS) {
        expect(doc.totalVotesByUnit[unit.unitId]).toBeDefined();
        for (const c of candidateData) {
          expect(doc.totalVotesByUnit[unit.unitId][c._id.toString()]).toBe(0);
        }
      }
      expect(Object.keys(doc.totalVotesByUnit)).toHaveLength(ELECTORAL_VOTE_UNITS.length);
    });

    // Regression test for #2829: non-US presidential tallies must be seeded
    // from the election country's own region docs, not US apportionment units.
    it("seeds only the election country's region keys for non-US elections", async () => {
      const mockDb = createMockDb();
      const electionId = new ObjectId();
      const ngZones = ["NG-NC", "NG-NE", "NG-NW", "NG-SE", "NG-SS", "NG-SW"];

      mockDb.collection("elections");
      mockDb.collectionMocks["elections"]!.findOne = vi
        .fn()
        .mockResolvedValue({ _id: electionId, countryId: "NG" });
      mockDb.collection("states");
      mockDb.collectionMocks["states"]!.find = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(ngZones.map((id) => ({ _id: id }))),
      });

      const { initPresidentVoteTally } = await import("./presidentialElectionEngine");
      const candidateData = [
        { _id: new ObjectId(), characterName: "Ada", party: "apc" },
        { _id: new ObjectId(), characterName: "Bello", party: "pdp" },
      ];

      await initPresidentVoteTally(
        electionId,
        candidateData as never[],
        undefined,
        mockDb as never
      );

      const replaceOne = mockDb.collectionMocks["electionVoteTallies"]!.replaceOne;
      expect(replaceOne).toHaveBeenCalledTimes(1);
      const doc = replaceOne.mock.calls[0]![1] as {
        totalVotesByUnit: Record<string, Record<string, number>>;
      };

      // Exactly the country's own regions — no phantom US electoral units.
      expect(Object.keys(doc.totalVotesByUnit).sort()).toEqual(ngZones);
      for (const unit of ELECTORAL_VOTE_UNITS) {
        expect(doc.totalVotesByUnit).not.toHaveProperty(unit.unitId);
      }
      for (const zone of ngZones) {
        for (const c of candidateData) {
          expect(doc.totalVotesByUnit[zone]![c._id.toString()]).toBe(0);
        }
      }

      // Region lookup must be scoped to the election's country.
      expect(mockDb.collectionMocks["states"]!.find).toHaveBeenCalledWith(
        { countryId: "NG" },
        expect.anything()
      );
    });

    it("includes primaryResults when provided", async () => {
      const replaceOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          replaceOne,
          findOne: vi.fn().mockResolvedValue(null),
          // loadApportionment (P1d-2) reads states.find; [] → seed fallback
          find: () => ({ toArray: async () => [] }),
        }),
      } as never);

      const { initPresidentVoteTally } = await import("./presidentialElectionEngine");
      const electionId = new ObjectId();
      const candidates = [
        { _id: new ObjectId(), characterName: "Alice", party: "democrat" },
      ] as never[];
      const primaryResults = {
        byParty: {
          democrat: [
            {
              candidateId: "c1",
              characterName: "Alice",
              party: "democrat",
              primaryScore: 60,
              sharePct: 60,
              won: true,
            },
          ],
        },
        recordedAt: new Date(),
      };

      await initPresidentVoteTally(electionId, candidates, primaryResults);

      const [, doc] = replaceOne.mock.calls[0];
      expect(doc.primaryResults).toEqual(primaryResults);
    });

    it("omits primaryResults when not provided", async () => {
      const replaceOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          replaceOne,
          findOne: vi.fn().mockResolvedValue(null),
          // loadApportionment (P1d-2) reads states.find; [] → seed fallback
          find: () => ({ toArray: async () => [] }),
        }),
      } as never);

      const { initPresidentVoteTally } = await import("./presidentialElectionEngine");
      const electionId = new ObjectId();
      const candidates = [
        { _id: new ObjectId(), characterName: "Alice", party: "democrat" },
      ] as never[];

      await initPresidentVoteTally(electionId, candidates);

      const [, doc] = replaceOne.mock.calls[0];
      expect(doc.primaryResults).toBeUndefined();
    });

    it("uses the provided db override instead of opening a fresh connection", async () => {
      const mockDb = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockImplementation(() => {
          throw new Error("getDb should not be used when dbOverride is provided");
        }),
      } as never);

      const { initPresidentVoteTally } = await import("./presidentialElectionEngine");
      const electionId = new ObjectId();
      const candidates = [
        { _id: new ObjectId(), characterName: "Alice", party: "democrat" },
      ] as never[];

      await initPresidentVoteTally(electionId, candidates, undefined, mockDb as never);

      expect(getDb).not.toHaveBeenCalled();
      expect(mockDb.collectionMocks["electionVoteTallies"]!.replaceOne).toHaveBeenCalledTimes(1);
    });
  });
});
