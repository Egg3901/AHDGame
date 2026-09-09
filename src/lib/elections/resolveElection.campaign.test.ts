import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeElection, makeCandidate } from "@/lib/test-utils/factories";
import { getGameTime } from "@/lib/time/gameTime";
import { loadRegionalCampaignCells } from "@/lib/campaignTargeting/audience";
import { _enrichElection } from "./enrichElection";
import { resolveElections } from "./resolveElection";
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/campaignTargeting/audience", () => ({ loadRegionalCampaignCells: vi.fn() }));
vi.mock("./enrichElection", () => ({
  _enrichElection: vi.fn(async () => ({})),
  fetchDepsForElection: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGameTime).mockResolvedValue({ currentTurn: 10, effectiveNow: new Date(0) } as never);
});

it.each(["summary", "full"] as const)(
  "loads advertised regions once in a %s list and supplies every row's audience",
  async (view) => {
    const db = createMockDb();
    const elections = ["CA", "NY", "CA"].map((state) =>
      makeElection({
        state,
        campaignRulesVersion: 1,
        status: "active",
        primaryEndTurn: 30,
        electionType: "house",
      })
    );
    const candidates = elections.map((election) =>
      makeCandidate({
        electionId: election._id,
        targetedAds: [
          {
            stateId: election.state,
            dimension: "race",
            bucket: "white",
            exposure: 1,
            lastPurchaseTurn: 10,
            throughTurn: 10,
          },
        ],
      })
    );
    db.collection("electionCandidates").find.mockReturnValue({ toArray: async () => candidates });
    const states = [
      { _id: "CA", countryId: "US" },
      { _id: "NY", countryId: "US" },
    ];
    db.collection("states").find.mockReturnValue({ toArray: async () => states });
    const cells = new Map([
      ["US:CA", []],
      ["US:NY", []],
    ]);
    vi.mocked(loadRegionalCampaignCells).mockResolvedValue(cells);
    await resolveElections(db as unknown as Db, elections, { view, userId: null });
    expect(loadRegionalCampaignCells).toHaveBeenCalledExactlyOnceWith(db, states, new Set());
    expect(db.collection("states").find).toHaveBeenCalledOnce();
    expect(_enrichElection).toHaveBeenCalledTimes(3);
    for (const [election, deps] of vi.mocked(_enrichElection).mock.calls)
      expect(deps.campaignCells).toBe(cells.get(`US:${election.state}`));
  }
);

it("adds no campaign reads for a list of legacy or unadvertised races", async () => {
  const db = createMockDb();
  await resolveElections(db as unknown as Db, [makeElection()], { view: "summary", userId: null });
  expect(loadRegionalCampaignCells).not.toHaveBeenCalled();
  expect(vi.mocked(_enrichElection).mock.calls[0][1].campaignCells).toBeNull();
});
