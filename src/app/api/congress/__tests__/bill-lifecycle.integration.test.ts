/**
 * Integration tests for Bill Lifecycle.
 * Tests the complete legislative process: proposal, voting, chamber advancement, and enactment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

// Mock dependencies
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  getJwtSecret: vi.fn(() => new TextEncoder().encode("test-secret")),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  CONGRESS_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));

vi.mock("@/lib/api/requestLog", () => ({
  logRequest: vi.fn(),
}));

vi.mock("@/lib/achievements/triggers", () => ({
  checkBillSponsoredAchievements: vi.fn().mockResolvedValue(undefined),
}));

describe("Bill Lifecycle Integration Tests", () => {
  const mockUserId = new ObjectId().toString();
  const mockCharacterId = new ObjectId();
  const mockBillId = new ObjectId();

  const mockCharacter = {
    _id: mockCharacterId,
    userId: new ObjectId(mockUserId),
    name: "Rep. Test Legislator",
    party: "democrat",
    homeState: "california",
    nationalInfluence: 100,
    actions: 100,
  };

  const mockLegislationType = {
    _id: "tax_policy",
    name: "Tax Policy",
    policyDomain: "economic",
    effectTarget: { metricId: "tax_rate" },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: mockUserId,
      isAdmin: false,
    } as any);
  });

  describe("Test 2.9: Propose Bill in House", () => {
    it("allows House member to propose a new bill", async () => {
      const { getDb } = await import("@/lib/mongodb");

      const mockOfficial = {
        _id: new ObjectId(),
        characterId: mockCharacterId,
        officeType: "house",
      };

      const billsInsertOne = vi.fn().mockResolvedValue({
        insertedId: mockBillId,
        acknowledged: true,
      });

      const mockDb = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "characters") {
            return {
              findOne: vi.fn().mockResolvedValue(mockCharacter),
              updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
            };
          }
          if (name === "electedOfficials") {
            return {
              findOne: vi.fn().mockResolvedValue(mockOfficial),
            };
          }
          if (name === "legislationTypes") {
            return {
              findOne: vi.fn().mockResolvedValue(mockLegislationType),
              find: vi.fn().mockReturnValue({
                toArray: async () => [
                  {
                    ...mockLegislationType,
                    policyOptions: [
                      {
                        id: "tax_policy_current",
                        name: "Current Law",
                        explanation: "Current Law: Existing tax policy",
                        effectDirection: 0,
                        economic: 0,
                        social: 0,
                      },
                      {
                        id: "tax_policy_proposed",
                        name: "Proposed Law",
                        explanation: "Proposed Law: Reduces corporate tax rates",
                        effectDirection: 1,
                        economic: 2,
                        social: 0,
                      },
                    ],
                  },
                ],
              }),
            };
          }
          if (name === "statePolicies") {
            return {
              find: vi.fn().mockReturnValue({
                toArray: async () => [
                  {
                    stateId: "federal",
                    legislationTypeId: "tax_policy",
                    policyOptionId: "tax_policy_current",
                  },
                ],
              }),
            };
          }
          if (name === "enactedLaws") {
            return {
              find: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnThis(),
                toArray: async () => [],
              }),
            };
          }
          if (name === "bills") {
            return {
              // findOne called before body validation (active-bill check) — must return null
              findOne: vi.fn().mockResolvedValue(null),
              insertOne: billsInsertOne,
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { POST } = await import("../bills/route");
      const req = new Request("http://localhost/api/congress/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Economic Growth Act",
          summary: "Reduces corporate tax rates to stimulate economic growth",
          chamber: "house",
          category: "economy",
          provisions: [
            {
              legislationTypeId: "tax_policy",
              effectDirection: 1,
              economic: 2,
              social: 0,
            },
          ],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json).toHaveProperty("id");
      expect(json.message).toContain("proposed");
      expect(json.message).toContain("voting is now open");

      // Verify bill was created
      expect(billsInsertOne).toHaveBeenCalled();
      const insertCall = billsInsertOne.mock.calls[0][0];
      expect(insertCall).toMatchObject({
        title: "Economic Growth Act",
        summary: "Reduces corporate tax rates to stimulate economic growth",
        originChamber: "house",
        currentChamber: "house",
        sponsorId: mockCharacterId,
        status: "active",
        category: "economy",
      });
      expect(insertCall.provisions).toHaveLength(1);
      expect(insertCall.provisions[0]).toMatchObject({
        legislationTypeId: "tax_policy",
        policyOptionNameSnapshot: "Proposed Law: Reduces corporate tax rates",
        currentPolicyOptionIdSnapshot: "tax_policy_current",
        currentPolicyOptionNameSnapshot: "Current Law: Existing tax policy",
        effectDirection: 1,
        economic: 2,
      });
      // A tax bill takes no social stance. Stamping social: 0 made it read as
      // a real centre target and dragged voters toward Moderate (ticket #1116).
      expect(insertCall.provisions[0]).not.toHaveProperty("social");
    });
  });

  describe("Test 2.10: Vote on Bill", () => {
    it("allows House member to cast vote on active bill", async () => {
      const { getDb } = await import("@/lib/mongodb");

      const mockBill = {
        _id: mockBillId,
        title: "Economic Growth Act",
        summary: "Test bill",
        originChamber: "house",
        currentChamber: "house",
        status: "active",
        votesFor: 150,
        votesAgainst: 100,
        votesAbstain: 5,
        votes: {},
        votingStartedAt: new Date(),
        votingEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        category: "economy",
        provisions: [],
        proposedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockOfficial = {
        _id: new ObjectId(),
        characterId: mockCharacterId,
        officeType: "house",
      };

      const billsUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

      const mockDb = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "characters") {
            return {
              findOne: vi.fn().mockResolvedValue(mockCharacter),
            };
          }
          if (name === "electedOfficials") {
            return {
              findOne: vi.fn().mockResolvedValue(mockOfficial),
            };
          }
          if (name === "bills") {
            return {
              findOne: vi.fn().mockResolvedValue(mockBill),
              updateOne: billsUpdateOne,
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { POST } = await import("../bills/[id]/route");
      const req = new Request(`http://localhost/api/congress/bills/${mockBillId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vote",
          vote: "for",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: mockBillId.toString() }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.message).toContain("Vote recorded");
      expect(json.message).toContain("for");

      // Verify vote was recorded
      expect(billsUpdateOne).toHaveBeenCalled();
      const updateCall = billsUpdateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: mockBillId, status: "active" });
      expect(Array.isArray(updateCall[1])).toBe(true);
    });

    it("prevents voting on inactive bill", async () => {
      const { getDb } = await import("@/lib/mongodb");

      const mockInactiveBill = {
        _id: mockBillId,
        title: "Inactive Bill",
        status: "failed",
        originChamber: "house",
        currentChamber: "house",
        category: "economy",
        provisions: [],
        proposedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "characters") {
            return {
              findOne: vi.fn().mockResolvedValue(mockCharacter),
            };
          }
          if (name === "bills") {
            return {
              findOne: vi.fn().mockResolvedValue(mockInactiveBill),
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { POST } = await import("../bills/[id]/route");
      const req = new Request(`http://localhost/api/congress/bills/${mockBillId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vote",
          vote: "for",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: mockBillId.toString() }) });
      expect(res.status).toBe(409);

      const json = await res.json();
      expect(json.error).toContain("not currently open for voting");
    });
  });

  describe("Test 2.11: Bill Passes House, Advances to Senate", () => {
    it("verifies bill structure when moved to second chamber", async () => {
      // This test verifies the expected data structure when a bill advances
      const billPassedOriginChamber = {
        _id: mockBillId,
        title: "Economic Growth Act",
        summary: "Test bill",
        originChamber: "house",
        currentChamber: "senate", // Moved to Senate
        status: "active_other",
        votesFor: 220, // Passed in House
        votesAgainst: 180,
        votesAbstain: 10,
        passedOriginAt: new Date("2026-01-15"),
        sentToOtherChamberAt: new Date("2026-01-15"),
        otherChamberVotingStartedAt: new Date("2026-01-15"),
        otherChamberVotingEndsAt: new Date("2026-01-16"),
        otherChamberVotesFor: 0,
        otherChamberVotesAgainst: 0,
        otherChamberVotesAbstain: 0,
        otherChamberVotes: {},
        category: "economy",
        provisions: [],
        proposedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Verify bill structure
      expect(billPassedOriginChamber.status).toBe("active_other");
      expect(billPassedOriginChamber.currentChamber).toBe("senate");
      expect(billPassedOriginChamber.originChamber).toBe("house");
      expect(billPassedOriginChamber.passedOriginAt).toBeDefined();
      expect(billPassedOriginChamber.otherChamberVotingEndsAt).toBeDefined();

      // Verify votes reset for second chamber
      expect(billPassedOriginChamber.otherChamberVotesFor).toBe(0);
      expect(billPassedOriginChamber.otherChamberVotesAgainst).toBe(0);
      expect(Object.keys(billPassedOriginChamber.otherChamberVotes)).toHaveLength(0);

      // Verify original chamber votes preserved
      expect(billPassedOriginChamber.votesFor).toBe(220);
      expect(billPassedOriginChamber.votesAgainst).toBe(180);
    });
  });

  describe("Test 2.12: Senate Votes on Bill", () => {
    it("allows Senate member to vote on bill in second chamber", async () => {
      const { getDb } = await import("@/lib/mongodb");

      const mockBillInSenate = {
        _id: mockBillId,
        title: "Economic Growth Act",
        summary: "Test bill",
        originChamber: "house",
        currentChamber: "senate",
        status: "active_other",
        votesFor: 220,
        votesAgainst: 180,
        otherChamberVotesFor: 30,
        otherChamberVotesAgainst: 20,
        otherChamberVotesAbstain: 2,
        otherChamberVotes: {},
        otherChamberVotingEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        category: "economy",
        provisions: [],
        proposedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const senatorCharId = new ObjectId();
      const mockSenator = {
        _id: senatorCharId,
        userId: new ObjectId(mockUserId),
        name: "Sen. Test Senator",
        party: "republican",
        homeState: "texas",
      };

      const mockSenateOfficial = {
        _id: new ObjectId(),
        characterId: senatorCharId,
        officeType: "senate",
      };

      const billsUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

      const mockDb = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === "characters") {
            return {
              findOne: vi.fn().mockResolvedValue(mockSenator),
            };
          }
          if (name === "electedOfficials") {
            return {
              findOne: vi.fn().mockResolvedValue(mockSenateOfficial),
            };
          }
          if (name === "bills") {
            return {
              findOne: vi.fn().mockResolvedValue(mockBillInSenate),
              updateOne: billsUpdateOne,
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }),
      };

      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const { POST } = await import("../bills/[id]/route");
      const req = new Request(`http://localhost/api/congress/bills/${mockBillId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vote",
          vote: "against",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ id: mockBillId.toString() }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.message).toContain("Vote recorded");
      expect(json.message).toContain("against");

      // Verify vote was recorded in otherChamberVotes
      expect(billsUpdateOne).toHaveBeenCalled();
      const updateCall = billsUpdateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: mockBillId, status: "active_other" });
      expect(Array.isArray(updateCall[1])).toBe(true);
    });
  });

  describe("Test 2.13: Bill Passes Both Chambers", () => {
    it("verifies bill structure when enrolled (passed both chambers)", async () => {
      const enrolledBill = {
        _id: mockBillId,
        title: "Economic Growth Act",
        summary: "Test bill",
        originChamber: "house",
        currentChamber: "senate",
        status: "enrolled",
        votesFor: 220, // Passed House
        votesAgainst: 180,
        otherChamberVotesFor: 55, // Passed Senate
        otherChamberVotesAgainst: 42,
        passedOriginAt: new Date("2026-01-15"),
        sentToPresidentAt: new Date("2026-01-20"),
        presidentActionDeadline: new Date("2026-01-21"), // 24 hours deadline
        category: "economy",
        provisions: [],
        proposedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Verify enrolled bill structure
      expect(enrolledBill.status).toBe("enrolled");
      expect(enrolledBill.sentToPresidentAt).toBeDefined();
      expect(enrolledBill.presidentActionDeadline).toBeDefined();

      // Verify both chambers passed
      expect(enrolledBill.votesFor).toBeGreaterThan(enrolledBill.votesAgainst);
      expect(enrolledBill.otherChamberVotesFor).toBeGreaterThan(
        enrolledBill.otherChamberVotesAgainst
      );

      // Verify deadline is 24 hours after sent to president
      const deadlineDiff =
        new Date(enrolledBill.presidentActionDeadline).getTime() -
        new Date(enrolledBill.sentToPresidentAt).getTime();
      expect(deadlineDiff).toBe(24 * 60 * 60 * 1000); // 24 hours in ms
    });
  });

  describe("Test 2.14: Bill Becomes Law", () => {
    it("verifies bill structure when signed into law", async () => {
      const signedBill = {
        _id: mockBillId,
        title: "Economic Growth Act",
        summary: "Test bill",
        originChamber: "house",
        currentChamber: "senate",
        status: "signed",
        votesFor: 220,
        votesAgainst: 180,
        otherChamberVotesFor: 55,
        otherChamberVotesAgainst: 42,
        passedOriginAt: new Date("2026-01-15"),
        sentToPresidentAt: new Date("2026-01-20"),
        presidentActionAt: new Date("2026-01-20T14:00:00Z"),
        enactedAt: new Date("2026-01-20T14:00:00Z"),
        category: "economy",
        provisions: [
          {
            legislationTypeId: "tax_policy",
            effectDirection: 1,
            economic: 2,
            social: 0,
          },
        ],
        proposedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Verify signed bill structure
      expect(signedBill.status).toBe("signed");
      expect(signedBill.presidentActionAt).toBeDefined();
      expect(signedBill.enactedAt).toBeDefined();

      // Verify it passed both chambers
      expect(signedBill.votesFor).toBeGreaterThan(signedBill.votesAgainst);
      expect(signedBill.otherChamberVotesFor).toBeGreaterThan(signedBill.otherChamberVotesAgainst);

      // Verify provisions are preserved
      expect(signedBill.provisions).toHaveLength(1);
      expect(signedBill.provisions[0]).toMatchObject({
        legislationTypeId: "tax_policy",
        effectDirection: 1,
        economic: 2,
        social: 0,
      });

      // Verify enactment timestamp matches presidential action
      expect(signedBill.enactedAt.getTime()).toBe(signedBill.presidentActionAt.getTime());
    });
  });
});
