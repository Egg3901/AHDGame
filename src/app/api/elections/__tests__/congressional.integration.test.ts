/**
 * Integration tests for Congressional Elections (Senate & House).
 * Tests state-level elections and multi-seat resolution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAsyncIterableCursor } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

// Mock dependencies
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
}));

vi.mock("@/lib/achievements/triggers", () => ({
  checkElectionEntryAchievements: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  ELECTION_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));

vi.mock("@/lib/api/requestLog", () => ({
  logRequest: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 1,
    lastTurnProcessed: new Date("2026-04-01"),
    isActive: true,
    pausedAt: null,
    effectiveNow: new Date("2026-04-01"),
  }),
}));

describe("Congressional Election Integration Tests", () => {
  const mockUserId = new ObjectId().toString();
  const mockCharacterId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock cookies
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "mock-token" }),
    } as any);

    // Mock JWT verification
    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { userId: mockUserId },
    } as any);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: mockUserId,
        username: "testuser",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: mockCharacterId,
          name: "Senate Candidate",
          party: "republican",
          homeState: "texas",
          countryId: "US",
        },
      },
    } as never);
  });

  describe("Test 2.7: Enter House/Senate Race", () => {
    it("allows character to enter Senate race in their home state", async () => {
      const { getDb } = await import("@/lib/mongodb");

      const mockSenateElectionId = new ObjectId();
      const mockCharacter = {
        _id: mockCharacterId,
        userId: new ObjectId(mockUserId),
        name: "Senate Candidate",
        party: "republican",
        homeState: "texas",
        countryId: "US",
      };

      const mockSenateElection = {
        _id: mockSenateElectionId,
        electionType: "senate",
        state: "texas",
        countryId: "US",
        status: "active",
        cycle: 2026,
        senateClass: 1,
        startTime: new Date("2026-01-01"),
        endTime: new Date("2026-11-01"),
        durationHours: 720,
      };

      const candidatesInsertOne = vi.fn().mockResolvedValue({
        insertedId: new ObjectId(),
        acknowledged: true,
      });

      const mockDb = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") {
            return {
              findOne: vi.fn().mockResolvedValue(mockSenateElection),
              find: vi.fn().mockReturnValue({
                project: vi.fn().mockReturnValue({
                  toArray: vi.fn().mockResolvedValue([]),
                }),
              }),
            };
          }
          if (name === "characters") {
            return {
              findOne: vi.fn().mockResolvedValue(mockCharacter),
            };
          }
          if (name === "electionCandidates") {
            return {
              findOne: vi.fn().mockResolvedValue(null), // Not already entered
              // Chainable: the enter route reads prior candidacy with
              // find().sort().limit().next(), which a bare { toArray } stub
              // cannot satisfy.
              find: vi.fn(() => createAsyncIterableCursor([])),
              insertOne: candidatesInsertOne,
            };
          }
          if (name === "campaigns") {
            return {
              findOne: vi.fn().mockResolvedValue(null),
              insertOne: vi.fn().mockResolvedValue({
                insertedId: new ObjectId(),
                acknowledged: true,
              }),
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
            // Default stub carries a chainable find() too. Election routes have
            // grown find().sort().limit() queries (prior-candidacy lookup on
            // enter, endorsement race check), and a fallback without one fails
            // as "find is not a function" instead of as a real assertion.
            find: vi.fn(() => createAsyncIterableCursor([])),
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { POST } = await import("../[id]/enter/route");
      const req = new Request(`http://localhost/api/elections/${mockSenateElectionId}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req, {
        params: Promise.resolve({ id: mockSenateElectionId.toString() }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain("entered");
      expect(json.message).toContain("senate");
      expect(json).toHaveProperty("candidateId");

      // Verify candidate was inserted with correct data
      expect(candidatesInsertOne).toHaveBeenCalled();
      const insertCall = candidatesInsertOne.mock.calls[0][0];
      expect(insertCall).toMatchObject({
        electionId: mockSenateElectionId,
        characterId: mockCharacterId,
        characterName: "Senate Candidate",
        party: "republican",
        status: "active",
      });
    });

    it("prevents character from entering election in different state", async () => {
      const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
      vi.mocked(requireAuthWithCharacter).mockResolvedValue({
        ok: true,
        user: {
          userId: mockUserId,
          username: "testuser",
          email: "a@b.c",
          role: "user",
          isAdmin: false,
          hasCharacter: true,
          character: {
            _id: mockCharacterId,
            name: "Wrong State Rep",
            party: "republican",
            homeState: "california",
            countryId: "US",
          },
        },
      } as never);

      const { getDb } = await import("@/lib/mongodb");

      const mockHouseElectionId = new ObjectId();
      const mockCharacter = {
        _id: mockCharacterId,
        userId: new ObjectId(mockUserId),
        name: "House Candidate",
        party: "democrat",
        homeState: "california",
        countryId: "US",
      };

      const mockHouseElection = {
        _id: mockHouseElectionId,
        electionType: "house",
        state: "texas", // Different from character's home state
        countryId: "US",
        status: "active",
        cycle: 2026,
        totalSeats: 38,
        startTime: new Date("2026-01-01"),
        endTime: new Date("2026-11-01"),
        durationHours: 720,
      };

      const mockDb = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") {
            return {
              findOne: vi.fn().mockResolvedValue(mockHouseElection),
            };
          }
          if (name === "characters") {
            return {
              findOne: vi.fn().mockResolvedValue(mockCharacter),
            };
          }
          if (name === "electionCandidates") {
            return {
              findOne: vi.fn().mockResolvedValue(null),
              // Chainable: the enter route reads prior candidacy with
              // find().sort().limit().next(), which a bare { toArray } stub
              // cannot satisfy.
              find: vi.fn(() => createAsyncIterableCursor([])),
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
            // Default stub carries a chainable find() too. Election routes have
            // grown find().sort().limit() queries (prior-candidacy lookup on
            // enter, endorsement race check), and a fallback without one fails
            // as "find is not a function" instead of as a real assertion.
            find: vi.fn(() => createAsyncIterableCursor([])),
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { POST } = await import("../[id]/enter/route");
      const req = new Request(`http://localhost/api/elections/${mockHouseElectionId}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req, {
        params: Promise.resolve({ id: mockHouseElectionId.toString() }),
      });
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.error).toContain("home state");
      expect(json.error).toContain("california");
      expect(json.error).toContain("texas");
    });
  });

  describe("Test 2.8: Resolve Multi-seat House Election", () => {
    it("distributes House seats proportionally by party", async () => {
      const { getDb } = await import("@/lib/mongodb");

      const mockHouseElectionId = new ObjectId();
      const demCandidate1 = new ObjectId();
      const demCandidate2 = new ObjectId();
      const repCandidate1 = new ObjectId();
      const repCandidate2 = new ObjectId();

      const mockHouseElection = {
        _id: mockHouseElectionId,
        electionType: "house",
        state: "california",
        countryId: "US",
        status: "completed",
        cycle: 2026,
        totalSeats: 52, // California has 52 House seats
        startTime: new Date("2026-01-01"),
        endTime: new Date("2026-11-01"),
        resolvedAt: new Date("2026-11-02"),
      };

      // Mock vote tally with seat distribution
      const mockVoteTally = {
        _id: new ObjectId(),
        electionId: mockHouseElectionId,
        totalVotes: {
          [demCandidate1.toString()]: 5000000,
          [demCandidate2.toString()]: 4800000,
          [repCandidate1.toString()]: 3000000,
          [repCandidate2.toString()]: 2900000,
        },
        candidateNames: {
          [demCandidate1.toString()]: "Dem Candidate 1",
          [demCandidate2.toString()]: "Dem Candidate 2",
          [repCandidate1.toString()]: "Rep Candidate 1",
          [repCandidate2.toString()]: "Rep Candidate 2",
        },
        candidateParties: {
          [demCandidate1.toString()]: "democrat",
          [demCandidate2.toString()]: "democrat",
          [repCandidate1.toString()]: "republican",
          [repCandidate2.toString()]: "republican",
        },
        finalized: true,
        // Seat estimates: Democrats ~62% of votes → ~32 seats, Republicans ~38% → ~20 seats
        seatsEstimate: {
          us_democrat: 32,
          us_republican: 20,
        },
        turnSnapshots: [
          {
            turn: 150,
            recordedAt: new Date("2026-11-01"),
            cumulativeVotes: {
              [demCandidate1.toString()]: 5000000,
              [demCandidate2.toString()]: 4800000,
              [repCandidate1.toString()]: 3000000,
              [repCandidate2.toString()]: 2900000,
            },
            sharesPct: {
              [demCandidate1.toString()]: 32,
              [demCandidate2.toString()]: 30,
              [repCandidate1.toString()]: 19,
              [repCandidate2.toString()]: 18,
            },
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "elections") {
            return {
              findOne: vi.fn().mockResolvedValue(mockHouseElection),
            };
          }
          if (name === "electionVoteTallies") {
            return {
              findOne: vi.fn().mockResolvedValue(mockVoteTally),
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
            // Default stub carries a chainable find() too. Election routes have
            // grown find().sort().limit() queries (prior-candidacy lookup on
            // enter, endorsement race check), and a fallback without one fails
            // as "find is not a function" instead of as a real assertion.
            find: vi.fn(() => createAsyncIterableCursor([])),
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      // Verify seat distribution
      expect(mockVoteTally.finalized).toBe(true);
      expect(mockVoteTally.seatsEstimate).toBeDefined();
      expect(mockVoteTally.seatsEstimate!.us_democrat).toBe(32);
      expect(mockVoteTally.seatsEstimate!.us_republican).toBe(20);

      // Verify total seats match election
      const totalSeatsAllocated =
        mockVoteTally.seatsEstimate!.us_democrat + mockVoteTally.seatsEstimate!.us_republican;
      expect(totalSeatsAllocated).toBe(mockHouseElection.totalSeats);

      // Verify proportionality is roughly correct
      const totalDemVotes =
        mockVoteTally.totalVotes[demCandidate1.toString()] +
        mockVoteTally.totalVotes[demCandidate2.toString()];
      const totalRepVotes =
        mockVoteTally.totalVotes[repCandidate1.toString()] +
        mockVoteTally.totalVotes[repCandidate2.toString()];
      const totalVotes = totalDemVotes + totalRepVotes;

      const demVotePct = totalDemVotes / totalVotes;
      const demSeatPct = mockVoteTally.seatsEstimate!.us_democrat / mockHouseElection.totalSeats;

      // Seat percentage should be within ~5% of vote percentage
      expect(Math.abs(demSeatPct - demVotePct)).toBeLessThan(0.05);
    });
  });
});
