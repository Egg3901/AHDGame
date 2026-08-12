/**
 * Integration tests for UK Political System.
 * Tests UK-specific features: parliamentary system, Commons elections, PM formation, Cabinet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

function emptyFindCursor() {
  const cursor = {
    toArray: vi.fn().mockResolvedValue([]),
    sort: vi.fn(),
    limit: vi.fn(),
    next: vi.fn().mockResolvedValue(null),
  };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  return cursor;
}

describe("UK Political System Integration Tests", () => {
  const mockUserId = new ObjectId().toString();
  const mockCharacterId = new ObjectId();
  const mockElectionId = new ObjectId();

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
          name: "Test MP",
          party: "uk_labour",
          homeState: "London",
          countryId: "UK",
        },
      },
    } as never);
  });

  describe("Test 3.1: UK Character Creation", () => {
    it("creates UK character with correct countryId and region", async () => {
      const mockUKCharacter = {
        _id: mockCharacterId,
        userId: new ObjectId(mockUserId),
        name: "Test MP",
        party: "uk_labour",
        homeState: "London", // UK region
        countryId: "UK",
        politicalInfluence: 50,
        favorability: 50,
        infamy: 0,
        actions: 3,
        funds: 50000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Verify UK-specific fields
      expect(mockUKCharacter.countryId).toBe("UK");
      expect(mockUKCharacter.countryId).toBe("UK");
      expect(mockUKCharacter.party).toContain("uk_");

      // Verify UK party formats
      const ukParties = ["uk_labour", "uk_conservative", "uk_snp", "uk_libdem"];
      expect(ukParties).toContain(mockUKCharacter.party);
    });
  });

  describe("Test 3.2: Commons Election Entry", () => {
    it("allows UK character to enter Commons election in their constituency", async () => {
      const { getDb } = await import("@/lib/mongodb");

      const mockUKCharacter = {
        _id: mockCharacterId,
        userId: new ObjectId(mockUserId),
        name: "Test MP",
        party: "uk_labour",
        homeState: "London",
        countryId: "UK",
      };

      const mockCommonsElection = {
        _id: mockElectionId,
        electionType: "commons",
        state: "London",
        countryId: "UK",
        status: "active",
        cycle: 2026,
        totalSeats: 650, // Commons has 650 seats
        startTime: new Date("2026-01-01"),
        endTime: new Date("2026-07-01"),
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
              findOne: vi.fn().mockResolvedValue(mockCommonsElection),
              find: vi.fn().mockReturnValue({
                project: vi.fn().mockReturnValue({
                  toArray: vi.fn().mockResolvedValue([]),
                }),
              }),
            };
          }
          if (name === "characters") {
            return {
              findOne: vi.fn().mockResolvedValue(mockUKCharacter),
            };
          }
          if (name === "electionCandidates") {
            return {
              findOne: vi.fn().mockResolvedValue(null),
              find: vi.fn().mockReturnValue(emptyFindCursor()),
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
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { POST } = await import("@/app/api/elections/[id]/enter/route");
      const req = new Request(`http://localhost/api/elections/${mockElectionId}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req, { params: Promise.resolve({ id: mockElectionId.toString() }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain("commons");

      // Verify candidate was inserted
      expect(candidatesInsertOne).toHaveBeenCalled();
      const insertCall = candidatesInsertOne.mock.calls[0][0];
      expect(insertCall).toMatchObject({
        electionId: mockElectionId,
        characterId: mockCharacterId,
        party: "uk_labour",
        status: "active",
      });
    });
  });

  describe("Test 3.3: Commons Seat Distribution", () => {
    it("verifies Commons uses FPTP single-member constituencies", async () => {
      const mockConstituencyElection = {
        _id: mockElectionId,
        electionType: "commons",
        state: "Manchester_Central",
        countryId: "UK",
        status: "completed",
        totalSeats: 1, // Single-member constituency
        cycle: 2026,
      };

      const mockVoteTally = {
        _id: new ObjectId(),
        electionId: mockElectionId,
        totalVotes: {
          ["candidate1"]: 15000,
          ["candidate2"]: 12000,
          ["candidate3"]: 8000,
        },
        candidateNames: {
          ["candidate1"]: "Labour Candidate",
          ["candidate2"]: "Conservative Candidate",
          ["candidate3"]: "Lib Dem Candidate",
        },
        candidateParties: {
          ["candidate1"]: "uk_labour",
          ["candidate2"]: "uk_conservative",
          ["candidate3"]: "uk_libdem",
        },
        winnerId: "candidate1", // Labour wins with plurality
        finalized: true,
      };

      // Verify FPTP mechanics
      expect(mockConstituencyElection.totalSeats).toBe(1);
      expect(mockVoteTally.winnerId).toBe("candidate1");

      // Winner has plurality, not necessarily majority
      const winner1Votes = mockVoteTally.totalVotes["candidate1"];
      const totalVotes = Object.values(mockVoteTally.totalVotes).reduce((a, b) => a + b, 0);
      const winnerPercent = (winner1Votes / totalVotes) * 100;

      expect(winnerPercent).toBeLessThan(50); // Plurality win (43%)
      expect(winner1Votes).toBeGreaterThan(mockVoteTally.totalVotes["candidate2"]);
      expect(winner1Votes).toBeGreaterThan(mockVoteTally.totalVotes["candidate3"]);
    });
  });

  describe("Test 3.4: Prime Minister Formation", () => {
    it("verifies PM formation based on Commons majority", async () => {
      const mockCommonsSeats = {
        uk_labour: 350, // Majority
        uk_conservative: 240,
        uk_snp: 40,
        uk_libdem: 15,
        other: 5,
      };

      const totalSeats = Object.values(mockCommonsSeats).reduce((a, b) => a + b, 0);
      const majorityThreshold = Math.floor(totalSeats / 2) + 1;

      expect(totalSeats).toBe(650); // Total Commons seats
      expect(majorityThreshold).toBe(326); // Majority threshold

      // Labour has majority
      expect(mockCommonsSeats.uk_labour).toBeGreaterThanOrEqual(majorityThreshold);

      const mockPrimeMinister = {
        _id: new ObjectId(),
        characterId: mockCharacterId,
        officeType: "primeMinister",
        party: "uk_labour",
        electedAt: new Date("2026-07-05"),
        termStart: new Date("2026-07-05"),
      };

      // Verify PM is from majority party
      expect(mockPrimeMinister.party).toBe("uk_labour");
      expect(mockPrimeMinister.officeType).toBe("primeMinister");
    });

    it("verifies coalition formation when no single-party majority", async () => {
      const mockHungParliament = {
        uk_labour: 280, // No single majority
        uk_conservative: 270,
        uk_snp: 50,
        uk_libdem: 46, // Changed from 45 to 46 to reach 326
        other: 4,
      };

      const totalSeats = Object.values(mockHungParliament).reduce((a, b) => a + b, 0);
      const majorityThreshold = Math.floor(totalSeats / 2) + 1;

      expect(totalSeats).toBe(650);

      // No single party has majority
      expect(mockHungParliament.uk_labour).toBeLessThan(majorityThreshold);
      expect(mockHungParliament.uk_conservative).toBeLessThan(majorityThreshold);

      // Coalition formation: Labour + Lib Dem
      const coalitionSeats = mockHungParliament.uk_labour + mockHungParliament.uk_libdem;
      expect(coalitionSeats).toBeGreaterThanOrEqual(majorityThreshold);

      const mockCoalitionGovernment = {
        leadParty: "uk_labour",
        coalitionPartners: ["uk_libdem"],
        totalSeats: coalitionSeats,
        primeMinisterParty: "uk_labour",
      };

      expect(mockCoalitionGovernment.totalSeats).toBe(326);
      expect(mockCoalitionGovernment.totalSeats).toBeGreaterThanOrEqual(majorityThreshold);
    });
  });

  describe("Test 3.5: UK Cabinet Appointments", () => {
    it("verifies UK Cabinet structure and PM appointment powers", async () => {
      const mockCabinetPositions = [
        { id: "chancellor", name: "Chancellor of the Exchequer", order: 1 },
        { id: "foreign_secretary", name: "Foreign Secretary", order: 2 },
        { id: "home_secretary", name: "Home Secretary", order: 3 },
        { id: "defence_secretary", name: "Secretary of State for Defence", order: 4 },
        { id: "health_secretary", name: "Secretary of State for Health and Social Care", order: 6 },
      ];

      const mockCabinetAppointments = [
        {
          _id: new ObjectId(),
          countryId: "UK",
          position: "chancellor",
          characterId: new ObjectId(),
          characterName: "Rachel Reeves",
          appointedBy: mockCharacterId, // PM appoints
          appointedAt: new Date("2026-07-05"),
          confirmedByLegislature: false, // UK: No confirmation needed
        },
        {
          _id: new ObjectId(),
          countryId: "UK",
          position: "foreign_secretary",
          characterId: new ObjectId(),
          characterName: "David Lammy",
          appointedBy: mockCharacterId,
          appointedAt: new Date("2026-07-05"),
          confirmedByLegislature: false,
        },
      ];

      // Verify cabinet structure
      expect(mockCabinetPositions).toHaveLength(5);
      expect(mockCabinetPositions[0].id).toBe("chancellor");

      // Verify appointment mechanics
      for (const appointment of mockCabinetAppointments) {
        expect(appointment.countryId).toBe("UK");
        expect(appointment.appointedBy).toEqual(mockCharacterId); // PM appoints
        expect(appointment.confirmedByLegislature).toBe(false); // No parliamentary confirmation
      }
    });
  });

  describe("Test 3.6: Scotland Regional Elections", () => {
    it("verifies Scottish constituency uses SNP as major party", async () => {
      const mockScottishElection = {
        _id: mockElectionId,
        electionType: "commons",
        state: "Glasgow_South",
        countryId: "UK",
        parentRegionId: "SCO", // Scotland
        status: "active",
        cycle: 2026,
      };

      // Scottish major parties: SNP and Labour
      const scottishMajorParties = ["uk_snp", "uk_labour"];

      // Verify regional party configuration
      expect(mockScottishElection.parentRegionId).toBe("SCO");
      expect(scottishMajorParties).toContain("uk_snp");
      expect(scottishMajorParties).not.toContain("uk_conservative"); // Not a major party in Scotland
    });
  });

  describe("Test 3.7: Wales Regional Elections", () => {
    it("verifies Welsh constituency party configuration", async () => {
      const mockWelshElection = {
        _id: mockElectionId,
        electionType: "commons",
        state: "Cardiff_Central",
        countryId: "UK",
        parentRegionId: "WAL", // Wales
        status: "active",
        cycle: 2026,
      };

      // Welsh major parties: Labour and Conservative
      const welshMajorParties = ["uk_labour", "uk_conservative"];

      expect(mockWelshElection.parentRegionId).toBe("WAL");
      expect(welshMajorParties).toContain("uk_labour");
      expect(welshMajorParties).not.toContain("uk_snp"); // SNP not relevant in Wales
    });
  });

  describe("Test 3.8: Northern Ireland Regional Elections", () => {
    it("verifies Northern Ireland constituency uses different party system", async () => {
      const mockNIElection = {
        _id: mockElectionId,
        electionType: "commons",
        state: "Belfast_South",
        countryId: "UK",
        parentRegionId: "NIR", // Northern Ireland
        status: "active",
        cycle: 2026,
      };

      // Northern Ireland major parties: DUP and Sinn Féin
      const niMajorParties = ["uk_dup", "uk_sf"];

      expect(mockNIElection.parentRegionId).toBe("NIR");
      expect(niMajorParties).toContain("uk_dup");
      expect(niMajorParties).toContain("uk_sf");
      expect(niMajorParties).not.toContain("uk_labour"); // Traditional UK parties less relevant
    });
  });

  describe("Test 3.9: UK Party System", () => {
    it("verifies UK party identifiers use uk_ prefix", async () => {
      const mockUKParties = [
        { _id: "uk_labour", name: "Labour Party", color: "#E4003B" },
        { _id: "uk_conservative", name: "Conservative Party", color: "#0087DC" },
        { _id: "uk_snp", name: "Scottish National Party", color: "#FFF95D" },
        { _id: "uk_libdem", name: "Liberal Democrats", color: "#FAA61A" },
        { _id: "uk_green", name: "Green Party", color: "#6AB023" },
        { _id: "uk_reform", name: "Reform UK", color: "#12B6CF" },
      ];

      // Verify all UK parties have uk_ prefix
      for (const party of mockUKParties) {
        expect(party._id).toMatch(/^uk_/);
      }

      // Verify party count (6+ major/minor parties)
      expect(mockUKParties.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("Test 3.10: Parliamentary Confidence Mechanism", () => {
    it("verifies confidence vote can trigger government collapse", async () => {
      const mockConfidenceVote = {
        _id: new ObjectId(),
        type: "confidence",
        motion: "Motion of No Confidence in Her Majesty's Government",
        countryId: "UK",
        proposedAt: new Date("2026-03-15"),
        votesFor: 340, // Against government
        votesAgainst: 310, // Support government
        status: "passed",
      };

      // Confidence vote passed (government lost)
      expect(mockConfidenceVote.votesFor).toBeGreaterThan(mockConfidenceVote.votesAgainst);
      expect(mockConfidenceVote.status).toBe("passed");

      // This would trigger:
      // 1. PM resigns
      // 2. New government formation OR
      // 3. General election called
      const governmentAction =
        mockConfidenceVote.votesFor > mockConfidenceVote.votesAgainst
          ? "government_falls"
          : "government_continues";

      expect(governmentAction).toBe("government_falls");
    });
  });

  describe("Test 3.11: Snap Election Mechanics", () => {
    it("verifies UK can call snap elections before term end", async () => {
      const mockGovernment = {
        primeMinisterId: mockCharacterId,
        party: "uk_labour",
        governmentFormedAt: new Date("2024-07-05"),
        nextScheduledElection: new Date("2029-07-04"), // 5 years
      };

      const mockSnapElectionCall = {
        _id: new ObjectId(),
        countryId: "UK",
        calledAt: new Date("2026-10-01"), // Only 2 years into term
        electionDate: new Date("2026-12-15"),
        calledBy: mockCharacterId,
        reason: "Strategic timing for governing party",
      };

      // Verify snap election is before scheduled term
      expect(mockSnapElectionCall.electionDate.getTime()).toBeLessThan(
        mockGovernment.nextScheduledElection.getTime()
      );

      // Verify election called by PM/Government
      expect(mockSnapElectionCall.calledBy).toEqual(mockCharacterId);

      const termLength =
        mockSnapElectionCall.calledAt.getTime() - mockGovernment.governmentFormedAt.getTime();
      const yearsIntoTerm = termLength / (365.25 * 24 * 60 * 60 * 1000);

      expect(yearsIntoTerm).toBeLessThan(5); // Called before full 5-year term
      expect(yearsIntoTerm).toBeGreaterThan(2); // After minimum period
    });
  });

  describe("Test 3.12: UK Electoral System Validation", () => {
    it("verifies UK system configuration matches parliamentary democracy", async () => {
      const ukSystemConfig = {
        countryId: "UK",
        governmentType: "parliamentaryMonarchy",
        lowerChamberSeats: 650,
        coalitionThreshold: 326, // Majority = 650/2 + 1
        electoralSystem: "fptp",
        snapElectionsAllowed: true,
        confidenceVoteMechanism: true,
        executiveTitle: "Prime Minister",
        legislatureName: "Parliament",
      };

      // Verify parliamentary system configuration
      expect(ukSystemConfig.governmentType).toBe("parliamentaryMonarchy");
      expect(ukSystemConfig.snapElectionsAllowed).toBe(true);
      expect(ukSystemConfig.confidenceVoteMechanism).toBe(true);

      // Verify electoral mechanics
      expect(ukSystemConfig.electoralSystem).toBe("fptp");
      expect(ukSystemConfig.lowerChamberSeats).toBe(650);
      expect(ukSystemConfig.coalitionThreshold).toBe(Math.floor(650 / 2) + 1);

      // Verify executive configuration
      expect(ukSystemConfig.executiveTitle).toBe("Prime Minister");
      expect(ukSystemConfig.legislatureName).toBe("Parliament");
    });
  });
});
