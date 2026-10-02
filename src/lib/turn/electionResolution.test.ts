/**
 * Unit tests for election resolution: spawnHouseElection, House spawn after resolve.
 * Verifies House sync logic and duplicate prevention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";
import { resolveGeneralElections } from "./electionResolution";
import { DEFAULT_DURATIONS } from "./perpetualElections";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAuditBulk: vi.fn(),
}));
vi.mock("@/lib/turn/election/generalResolution", () => ({
  resolveOneGeneralElection: vi.fn(),
}));
vi.mock("@/lib/analytics/electionAnalytics", () => ({
  captureElectionResolved: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/news", () => ({
  generateElectionNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/election/electionNotifications", () => ({
  sendBatchedElectionResults: vi.fn().mockResolvedValue(undefined),
}));

describe("electionResolution", () => {
  describe("committed aggregate outcomes", () => {
    beforeEach(() => vi.clearAllMocks());

    it("checks statuses in one projected batch and excludes a claim skipped during resolution", async () => {
      const committedId = new ObjectId();
      const skippedId = new ObjectId();
      const elections = [committedId, skippedId].map((_id) => ({
        _id,
        electionType: "house",
        countryId: "US",
        state: "CA",
        status: "completed",
        totalSeats: 52,
      }));
      const electionsFind = vi
        .fn()
        .mockReturnValueOnce({ toArray: async () => elections })
        .mockReturnValueOnce({ toArray: async () => [{ _id: committedId }] });
      const db = {
        collection: (name: string) => {
          if (name === "elections") return { find: electionsFind };
          if (name === "gameState") return { findOne: async () => ({ currentTurn: 42 }) };
          return { find: () => ({ toArray: async () => [] }) };
        },
      };
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as never);
      const { resolveOneGeneralElection } = await import("@/lib/turn/election/generalResolution");
      vi.mocked(resolveOneGeneralElection).mockResolvedValue({ resolved: true, newsOutcomes: [] });
      // Keep the existing game result/count unchanged, even though one claim skipped.
      await expect(resolveGeneralElections(new Date())).resolves.toBe(2);
      expect(electionsFind).toHaveBeenCalledTimes(2);
      expect(electionsFind).toHaveBeenLastCalledWith(
        { _id: { $in: [committedId, skippedId] }, status: "resolved" },
        { projection: { _id: 1 } }
      );
      const { captureElectionResolved } = await import("@/lib/analytics/electionAnalytics");
      expect(captureElectionResolved).toHaveBeenCalledTimes(1);
      expect(captureElectionResolved).toHaveBeenCalledWith(
        expect.objectContaining({ electionId: committedId.toString(), phase: "general", turn: 42 })
      );
    });

    it("reports one available seat for a regional single-seat race with multiple candidates and no tally", async () => {
      const electionId = new ObjectId();
      const electionsFind = vi
        .fn()
        .mockReturnValueOnce({
          toArray: async () => [
            {
              _id: electionId,
              electionType: "governor",
              countryId: "US",
              state: "CA",
              status: "completed",
            },
          ],
        })
        .mockReturnValueOnce({ toArray: async () => [{ _id: electionId }] });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: (name: string) => {
          if (name === "elections") return { find: electionsFind };
          if (name === "gameState") return { findOne: async () => ({ currentTurn: 42 }) };
          if (name === "electionCandidates")
            return {
              find: () => ({
                toArray: async () => [
                  { electionId, isNPP: false },
                  { electionId, isNPP: true },
                ],
              }),
            };
          return { find: () => ({ toArray: async () => [] }) };
        },
      } as never);
      const { resolveOneGeneralElection } = await import("@/lib/turn/election/generalResolution");
      vi.mocked(resolveOneGeneralElection).mockResolvedValue({ resolved: true, newsOutcomes: [] });
      await resolveGeneralElections(new Date());
      const { captureElectionResolved } = await import("@/lib/analytics/electionAnalytics");
      expect(captureElectionResolved).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateCount: 2,
          playerCandidateCount: 1,
          seatsAvailable: 1,
        })
      );
    });

    it("contains a failed status confirmation without changing election resolution", async () => {
      const elections = [{ _id: new ObjectId(), electionType: "house", status: "completed" }];
      const electionsFind = vi
        .fn()
        .mockReturnValueOnce({ toArray: async () => elections })
        .mockReturnValueOnce({
          toArray: async () => {
            throw new Error("database unavailable");
          },
        });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: (name: string) => {
          if (name === "elections") return { find: electionsFind };
          if (name === "gameState") return { findOne: async () => ({ currentTurn: 42 }) };
          return { find: () => ({ toArray: async () => [] }) };
        },
      } as never);
      const { resolveOneGeneralElection } = await import("@/lib/turn/election/generalResolution");
      vi.mocked(resolveOneGeneralElection).mockResolvedValue({ resolved: true, newsOutcomes: [] });
      await expect(resolveGeneralElections(new Date())).resolves.toBe(1);
      const { captureElectionResolved } = await import("@/lib/analytics/electionAnalytics");
      expect(captureElectionResolved).not.toHaveBeenCalled();
    });

    it("captures a committed empty election even when its game return counts no winner", async () => {
      const election = {
        _id: new ObjectId(),
        electionType: "governor",
        countryId: "US",
        state: "CA",
        status: "completed",
      };
      const electionsFind = vi
        .fn()
        .mockReturnValueOnce({ toArray: async () => [election] })
        .mockReturnValueOnce({ toArray: async () => [{ _id: election._id }] });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue({
        collection: (name: string) => {
          if (name === "elections") return { find: electionsFind };
          if (name === "gameState") return { findOne: async () => ({ currentTurn: 42 }) };
          return { find: () => ({ toArray: async () => [] }) };
        },
      } as never);
      const { resolveOneGeneralElection } = await import("@/lib/turn/election/generalResolution");
      vi.mocked(resolveOneGeneralElection).mockResolvedValue({ resolved: false, newsOutcomes: [] });
      await expect(resolveGeneralElections(new Date())).resolves.toBe(0);
      const { captureElectionResolved } = await import("@/lib/analytics/electionAnalytics");
      expect(captureElectionResolved).toHaveBeenCalledWith(
        expect.objectContaining({ electionId: election._id.toString(), candidateCount: 0 })
      );
    });
  });

  describe("spawnHouseElection", () => {
    let mockFindOne: ReturnType<typeof vi.fn>;
    let mockInsertOne: ReturnType<typeof vi.fn>;
    let mockGameStateFindOne: ReturnType<typeof vi.fn>;

    function mountDb(currentTurn: number) {
      mockGameStateFindOne = vi.fn().mockResolvedValue({ currentTurn });
      return {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") {
            return { findOne: mockFindOne, insertOne: mockInsertOne };
          }
          if (name === "gameState") {
            return { findOne: mockGameStateFindOne };
          }
          // states: loadApportionment (P1d-2) reads houseDistricts; [] → seed fallback
          if (name === "states") {
            return { find: () => ({ toArray: async () => [] }) };
          }
          return {};
        }),
      } as never;
    }

    beforeEach(async () => {
      vi.clearAllMocks();
      mockFindOne = vi.fn().mockResolvedValue(null);
      mockInsertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });

      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(mountDb(1));
    });

    it("does not insert when active/upcoming House already exists for state", async () => {
      mockFindOne.mockResolvedValue({
        _id: new ObjectId(),
        electionType: "house",
        state: "CA",
        status: "active",
      });

      const { spawnHouseElection } = await import("./electionResolution");
      const fromElection: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "CA",
        cycle: 3,
        status: "completed",
        durationHours: 96,
        primaryDurationHours: 24,
        totalSeats: 52,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Election;

      await spawnHouseElection(mountDb(1), fromElection, new Date());

      expect(mockFindOne).toHaveBeenCalledWith({
        electionType: "house",
        state: "CA",
        status: { $in: ["active", "upcoming"] },
      });
      expect(mockInsertOne).not.toHaveBeenCalled();
    });

    it("inserts cycle N+1 anchored to canonical LARP when prev ended at its canonical endTurn", async () => {
      // House canonical: cycle 5 endTurn = 192 + 4×96 = 576.
      // If currentTurn=576 (the moment cycle 5 resolves), cycle 6's canonical startTurn
      // is 576 (zero-gap) and endTurn = 672. Spawn should be "active" with startTime ≈ now
      // and endTime = now + 96h (matching the historical rolling behavior in the normal case).
      mockFindOne.mockResolvedValue(null);

      const MS = 3_600_000;
      const { spawnHouseElection } = await import("./electionResolution");
      const now = new Date("2026-02-25T12:00:00Z");
      const fromElection: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "TX",
        cycle: 5,
        status: "completed",
        durationHours: 96,
        totalSeats: 38,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Election;

      await spawnHouseElection(mountDb(576), fromElection, now);

      expect(mockInsertOne).toHaveBeenCalledTimes(1);
      const [inserted] = mockInsertOne.mock.calls[0];
      expect(inserted.electionType).toBe("house");
      expect(inserted.state).toBe("TX");
      expect(inserted.cycle).toBe(6);
      expect(inserted.status).toBe("active");
      expect(inserted.durationHours).toBe(96);
      expect(inserted.primaryDurationHours).toBe(48);
      expect(inserted.totalSeats).toBe(38);
      expect(new Date(inserted.endTime).getTime()).toBe(now.getTime() + 96 * MS);
      expect(new Date(inserted.primaryEndTime).getTime()).toBe(now.getTime() + 48 * MS);
    });

    it("spawns cycle N+1 as 'upcoming' when the prev was admin-accelerated to resolve early", async () => {
      // Admin fast-forwarded cycle 5 to resolve at turn 100 (canonical was 576).
      // Cycle 6's canonical window (480–672) is still far in the future, so spawn as upcoming.
      mockFindOne.mockResolvedValue(null);

      const MS = 3_600_000;
      const { spawnHouseElection } = await import("./electionResolution");
      const now = new Date("2026-02-25T12:00:00Z");
      const fromElection: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "NY",
        cycle: 5,
        status: "completed",
        durationHours: 10, // admin-shortened
        totalSeats: 26,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Election;

      await spawnHouseElection(mountDb(101), fromElection, now);

      const [inserted] = mockInsertOne.mock.calls[0];
      expect(inserted.cycle).toBe(6);
      expect(inserted.status).toBe("upcoming");
      // Canonical cycle 6 endTurn = 672, startTurn = 576. wall = now + (672 − 101)h / (576 − 101)h
      expect(new Date(inserted.endTime).getTime()).toBe(now.getTime() + (672 - 101) * MS);
      expect(new Date(inserted.startTime).getTime()).toBe(now.getTime() + (576 - 101) * MS);
      // Canonical durations — not inherited from admin-shortened prev
      expect(inserted.durationHours).toBe(96);
      expect(inserted.primaryDurationHours).toBe(48);
    });

    it("uses canonical durations regardless of fromElection durationHours", async () => {
      mockFindOne.mockResolvedValue(null);

      const { spawnHouseElection } = await import("./electionResolution");
      const now = new Date();
      const fromElection: Election = {
        _id: new ObjectId(),
        electionType: "house",
        state: "WY",
        cycle: 1,
        status: "completed",
        totalSeats: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Election;

      // currentTurn=144 = canonical cycle 1 endTurn, zero-gap into cycle 2
      await spawnHouseElection(mountDb(144), fromElection, now);

      const [inserted] = mockInsertOne.mock.calls[0];
      expect(inserted.durationHours).toBe(96);
      expect(inserted.primaryDurationHours).toBe(48);
    });
  });

  describe("spawnCommonsElection — opens primary immediately", () => {
    let mockFindOne: ReturnType<typeof vi.fn>;
    let mockInsertOne: ReturnType<typeof vi.fn>;

    function mountDb(currentTurn: number) {
      return {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") return { findOne: mockFindOne, insertOne: mockInsertOne };
          if (name === "gameState") return { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
          return {};
        }),
      } as never;
    }

    beforeEach(async () => {
      vi.clearAllMocks();
      mockFindOne = vi.fn().mockResolvedValue(null);
      mockInsertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(mountDb(1));
    });

    it("spawns the next commons cycle active-now (not at the future canonical startTurn)", async () => {
      // UK commons canonical (2019-default ctx): cycle 1 endTurn = 267,
      // cycle 2 endTurn = 507, canonical startTurn = 459. Resolving cycle 1 at
      // turn 300 leaves a 159-turn dead zone before the canonical primary opens;
      // the fix opens it immediately so candidates can register now.
      const MS = 3_600_000;
      const currentTurn = 300;
      const { spawnCommonsElection } = await import("./electionResolution");
      const now = new Date("2026-02-25T12:00:00Z");
      const fromElection: Election = {
        _id: new ObjectId(),
        countryId: "UK",
        electionType: "commons",
        state: "ENG",
        cycle: 1,
        status: "completed",
        durationHours: 48,
        totalSeats: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Election;

      await spawnCommonsElection(mountDb(currentTurn), fromElection, now);

      expect(mockInsertOne).toHaveBeenCalledTimes(1);
      const [inserted] = mockInsertOne.mock.calls[0];
      expect(inserted.cycle).toBe(2);
      expect(inserted.status).toBe("active");
      expect(inserted.startTurn).toBe(currentTurn);
      expect(new Date(inserted.startTime).getTime()).toBe(now.getTime());
      // General stays anchored to the canonical real-world year.
      expect(inserted.endTurn).toBe(507);
      expect(new Date(inserted.endTime).getTime()).toBe(now.getTime() + (507 - currentTurn) * MS);
      expect(inserted.durationHours).toBe(48);
    });
  });

  describe("generalElectionResolutionOrder", () => {
    it("sorts house and senate before president", async () => {
      const { generalElectionResolutionOrder } = await import("./electionResolution");
      const elections = [
        { electionType: "president" },
        { electionType: "house" },
        { electionType: "senate" },
        { electionType: "governor" },
      ] as Election[];

      const sorted = [...elections].sort(
        (a, b) => generalElectionResolutionOrder(a) - generalElectionResolutionOrder(b)
      );

      expect(sorted.map((e) => e.electionType)).toEqual([
        "house",
        "senate",
        "governor",
        "president",
      ]);
    });
  });

  describe("resolveGeneralElections audit trail", () => {
    it("records the authoritative contingent presidential result", async () => {
      const electionId = new ObjectId();
      const presidentWinnerId = new ObjectId().toString();
      const vicePresidentWinnerId = new ObjectId().toString();
      const election = {
        _id: electionId,
        electionType: "president",
        countryId: "US",
        state: "US",
        status: "completed",
      } as Election;
      const preResolutionTally = {
        _id: electionId,
        electionId,
        finalized: false,
      };
      const contingentResult = {
        eligiblePresidentCandidateIds: [presidentWinnerId],
        eligibleVicePresidentCandidateIds: [vicePresidentWinnerId],
        houseDelegationVotes: { CA: presidentWinnerId },
        houseVoteTotals: { [presidentWinnerId]: 26 },
        senateVotes: { senator: vicePresidentWinnerId },
        senateVoteTotals: { [vicePresidentWinnerId]: 51 },
        presidentWinnerId,
        vicePresidentWinnerId,
        houseThreshold: 26,
        senateThreshold: 51,
        topElectoralVoteTotal: 258,
      };
      const finalTally = {
        ...preResolutionTally,
        finalized: true,
        resolutionMode: "contingent",
        candidateNames: { [presidentWinnerId]: "House Winner" },
        electoralVotesByCandidate: { [presidentWinnerId]: 258, runnerUp: 217, third: 64 },
        contingentResult,
      };

      const electionsFind = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([election]),
      });
      const tallyFind = vi
        .fn()
        .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([preResolutionTally]) })
        .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([finalTally]) });
      const db = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") return { find: electionsFind };
          if (name === "electionVoteTallies") return { find: tallyFind };
          if (name === "electionCandidates") {
            return { find: () => ({ toArray: vi.fn().mockResolvedValue([]) }) };
          }
          if (name === "gameState") {
            return { findOne: vi.fn().mockResolvedValue({ currentTurn: 816 }) };
          }
          return {};
        }),
      };
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as never);
      const { resolveOneGeneralElection } = await import("@/lib/turn/election/generalResolution");
      vi.mocked(resolveOneGeneralElection).mockResolvedValue({ resolved: true, newsOutcomes: [] });

      const { resolveGeneralElections } = await import("./electionResolution");
      await resolveGeneralElections(new Date("2026-09-12T12:00:00Z"));

      expect(tallyFind).toHaveBeenNthCalledWith(
        1,
        { electionId: { $in: [election._id] } },
        { projection: { turnSnapshots: { $slice: -1 } } }
      );
      const { recordAuditBulk } = await import("@/lib/audit/recordAudit");
      expect(recordAuditBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          action: "election.resolve",
          subject: expect.objectContaining({ id: electionId.toString() }),
          meta: expect.objectContaining({
            winnerId: presidentWinnerId,
            winnerName: "House Winner",
            winnerElectoralVotes: 258,
            resolutionMode: "contingent",
            electoralVotesByCandidate: finalTally.electoralVotesByCandidate,
            contingentResult,
          }),
        }),
      ]);
    });
  });

  describe("CN npcDelegate resolution metadata", () => {
    it("officeKeyForElectionType maps npcDelegate to itself (not a snap type)", async () => {
      const { officeKeyForElectionType } = await import("@/lib/utils/electionLabels");
      expect(officeKeyForElectionType("npcDelegate")).toBe("npcDelegate");
    });

    it("MULTI_SEAT_TYPES includes npcDelegate", async () => {
      const { MULTI_SEAT_TYPES } = await import("@/lib/utils/electionLabels");
      expect(MULTI_SEAT_TYPES.has("npcDelegate")).toBe(true);
    });

    it("DEFAULT_DURATIONS has npcDelegate with 48h total / 24h primary", async () => {
      expect(DEFAULT_DURATIONS.npcDelegate.durationHours).toBe(48);
      expect(DEFAULT_DURATIONS.npcDelegate.primaryDurationHours).toBe(24);
      expect(DEFAULT_DURATIONS.npcDelegate.generalDurationHours).toBe(24);
    });

    it("canonicalCycle returns 240-turn period for npcDelegate", async () => {
      const { canonicalTurnsForCycle } = await import("@/lib/elections/canonicalCycle");
      const cycle1 = canonicalTurnsForCycle({ electionType: "npcDelegate", cycle: 1 });
      expect(cycle1!.endTurn).toBe(240);
      expect(cycle1!.startTurn).toBe(1);

      const cycle2 = canonicalTurnsForCycle({ electionType: "npcDelegate", cycle: 2 });
      expect(cycle2!.endTurn).toBe(480); // 240 + 240
      expect(cycle2!.startTurn).toBe(432); // 480 - 48
    });
  });
});
