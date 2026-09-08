import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCharacter } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { getElectionOpponents } from "@/lib/actions/electionOpponents";
import { projectCampaignPoll } from "@/lib/campaignTargeting/poll";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSession: vi.fn(),
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: async () => false }));
vi.mock("@/lib/gameState", () => ({ getGameState: async () => ({ currentTurn: 10 }) }));
vi.mock("@/lib/demographics/granularPollFlag", () => ({
  isGranularPollEnabled: async () => false,
}));
vi.mock("@/lib/achievements/triggers", () => ({ checkActionAchievements: vi.fn() }));
vi.mock("@/lib/actions/electionOpponents", () => ({ getElectionOpponents: vi.fn() }));
vi.mock("@/lib/campaignTargeting/poll", () => ({ projectCampaignPoll: vi.fn() }));
vi.mock("@/lib/actions/pollCalculations", () => ({
  computePollData: async () => ({
    overallAppeal: 50,
    totalEstimatedVoters: 500,
    totalPotentialVoters: 250,
    topGroups: [],
    bottomGroups: [],
    categories: [],
  }),
}));

const request = () =>
  new NextRequest("http://localhost/api/actions/poll", {
    method: "POST",
    body: JSON.stringify({ type: "small" }),
  });

describe("commissioning a campaign-aware poll", () => {
  let db: ReturnType<typeof createMockDb>;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const character = makeCharacter({ funds: 100_000, actions: 10 });
    vi.mocked(requireHumanSession).mockResolvedValue({
      ok: true,
      user: { userId: character.userId.toString() },
    } as never);
    db.collection("characters").findOne.mockResolvedValue(character);
    db.collection("states").findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      population: 1_000_000,
    });
    db.collection("stateDemographics").findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      categoryWeights: {},
      groups: {},
    });
    vi.mocked(getElectionOpponents).mockResolvedValue({
      electionId: new ObjectId().toString(),
      electionType: "senate",
      state: "CA",
      campaignRulesVersion: 1,
      inPrimary: false,
      opponents: [],
    });
    vi.mocked(projectCampaignPoll).mockResolvedValue({
      myCandidateId: "mine",
      totalPool: 1000,
      votes: { mine: 550, rival: 450 },
      cells: [],
      bonusesByCandidate: {},
    });
  });

  it("persists the shared campaign projection when charging for a poll", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pollSnapshot.totalEstimatedVoters).toBe(1000);
    expect(body.pollSnapshot.inRaceVoteShare).toEqual({
      myVotes: 550,
      opponentVotes: { rival: 450 },
    });
    const write = db.collection("characters").updateOne.mock.calls[0];
    expect(write[1].$set.lastPoll).toEqual(expect.objectContaining({ totalEstimatedVoters: 1000 }));
    expect(write[1].$inc).toEqual({ actions: -2, funds: -25000 });
  });

  it("leaves a poll without new campaign rules on its previous calculation", async () => {
    vi.mocked(getElectionOpponents).mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).pollSnapshot.totalEstimatedVoters).toBe(500);
    expect(projectCampaignPoll).not.toHaveBeenCalled();
  });

  it("does not record a successful poll when the resource debit loses a race", async () => {
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect((await POST(request())).status).toBe(409);
    expect(db.collection("actionLogs").insertOne).not.toHaveBeenCalled();
  });
});
