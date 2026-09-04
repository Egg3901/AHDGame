import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  PRIMARY_CAMPAIGN_TICK_CAP,
  PRIMARY_HOME_SURGE_COST_ACTIONS,
  PRIMARY_HOME_SURGE_COST_FUNDS,
  PRIMARY_HOME_SURGE_PCT,
} from "@/lib/electionEngine/constants";

vi.mock("@/lib/electionEngine", () => ({ fetchEnrichedCandidates: vi.fn() }));
vi.mock("@/lib/demographics/categoryCatalog", () => ({ loadDemographicCategories: vi.fn() }));
vi.mock("@/lib/primaryRegionalBonusLoader", () => ({ loadRegionalBonusMaps: vi.fn() }));
vi.mock("@/lib/primaryProjection", () => ({ projectPrimaryByState: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/currency/characterFunds", () => ({
  getHomeCurrency: vi.fn().mockReturnValue("USD"),
  loadCharacterFxRate: vi.fn(),
}));

/**
 * Equality that treats ObjectId and its string form as the same value, so a
 * stub filter can be written with whichever the caller happens to hold.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, want]) => {
    const have = doc[key];
    if (want && typeof want === "object" && "$in" in (want as Record<string, unknown>)) {
      const list = (want as { $in: unknown[] }).$in;
      return list.some((v) => sameValue(have, v));
    }
    return sameValue(have, want);
  });
}

type Rows = Record<string, Record<string, unknown>[]>;

/** Collection-name-dispatching stub with just the cursor surface the builder uses. */
function stubDb(rows: Rows = {}): Db {
  const get = (name: string) => rows[name] ?? [];
  return {
    collection: (name: string) => {
      const cursor = {
        toArray: async () => get(name),
        project: () => cursor,
        sort: () => cursor,
        limit: () => cursor,
      };
      return {
        find: (filter?: Record<string, unknown>) => ({
          ...cursor,
          toArray: async () => (filter ? get(name).filter((d) => matches(d, filter)) : get(name)),
          project: () => ({
            toArray: async () => (filter ? get(name).filter((d) => matches(d, filter)) : get(name)),
          }),
        }),
        findOne: async (filter?: Record<string, unknown>) =>
          (filter ? get(name).find((d) => matches(d, filter)) : get(name)[0]) ?? null,
      };
    },
  } as unknown as Db;
}

const ELECTION_ID = new ObjectId();
const ELECTION = {
  _id: ELECTION_ID,
  electionType: "president",
  countryId: "US",
  status: "active",
  primaryEndTurn: 41,
  endTurn: 53,
} as never;

const DEM = {
  _id: new ObjectId(),
  countryId: "US",
  sequentialId: 1,
  abbreviation: "DEM",
  name: "Democratic Party",
  color: "#2563eb",
  economicPosition: -2,
  socialPosition: -2,
};

/** A filed, player-held candidate in party 1. */
function candidateRow(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    electionId: ELECTION_ID,
    party: "1",
    characterId: new ObjectId(),
    characterName: "Filer",
    status: "active",
    isNPP: false,
    support: 10,
    ...over,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();

  const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
  vi.mocked(fetchEnrichedCandidates).mockResolvedValue([] as never);

  const { loadDemographicCategories } = await import("@/lib/demographics/categoryCatalog");
  vi.mocked(loadDemographicCategories).mockResolvedValue([] as never);

  const { loadRegionalBonusMaps } = await import("@/lib/primaryRegionalBonusLoader");
  vi.mocked(loadRegionalBonusMaps).mockResolvedValue({
    stateOrgByStateAndCandidate: {},
    homeStateByCandidate: {},
  } as never);

  const { projectPrimaryByState } = await import("@/lib/primaryProjection");
  vi.mocked(projectPrimaryByState).mockReturnValue({ byState: {}, stateWinners: {} } as never);

  const { isForexEnabled } = await import("@/lib/currency/featureFlag");
  vi.mocked(isForexEnabled).mockResolvedValue(true);

  const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
  vi.mocked(loadCharacterFxRate).mockResolvedValue({ rate: 1, ok: true });
});

async function build(rows: Rows, partyId: string, viewer: unknown = null) {
  const { buildPrimaryPartyDetail } = await import("./primaryPartyDetail");
  return buildPrimaryPartyDetail(stubDb(rows), {
    election: ELECTION,
    partyId,
    viewer: viewer as never,
  });
}

describe("buildPrimaryPartyDetail", () => {
  it("returns null for a party that does not exist", async () => {
    const detail = await build({ politicalParties: [DEM] }, "9");
    expect(detail).toBeNull();
  });

  it("returns null for a race that is not a US presidential primary", async () => {
    const { buildPrimaryPartyDetail } = await import("./primaryPartyDetail");
    const detail = await buildPrimaryPartyDetail(stubDb({ politicalParties: [DEM] }), {
      election: { ...(ELECTION as object), countryId: "FR" } as never,
      partyId: "1",
      viewer: null,
    });
    expect(detail).toBeNull();
  });

  it("still returns a detail when nobody has filed, rather than 404ing the party", async () => {
    // The deep-dive page deliberately renders an empty roster with a "no
    // candidates have filed yet" call to action; returning null here would
    // regress that into a 404.
    const detail = await build({ politicalParties: [DEM], electionCandidates: [] }, "1");
    expect(detail).not.toBeNull();
    expect(detail?.candidates).toEqual([]);
    expect(detail?.byState).toEqual({});
  });

  it("resolves a party by abbreviation as well as by sequential id", async () => {
    const detail = await build({ politicalParties: [DEM] }, "DEM");
    expect(detail?.partyId).toBe("1");
  });

  it("reports an empty projection rather than inventing one", async () => {
    const detail = await build(
      { politicalParties: [DEM], electionCandidates: [candidateRow({ isNPP: true })] },
      "1"
    );
    expect(detail?.byState).toEqual({});
    expect(detail?.votedStateIds).toEqual([]);
  });

  it("takes voted states from the wave history, not from awarded delegates", async () => {
    // primaryDelegatesByState is keyed by what a wave AWARDED this party, so a
    // state that voted but awarded this party nothing would read as unvoted.
    const detail = await build(
      {
        politicalParties: [DEM],
        electionCandidates: [candidateRow()],
        electionVoteTallies: [
          {
            electionId: ELECTION_ID,
            primaryWaveHistory: [{ statesVoted: ["IA", "NH"] }, { statesVoted: ["SC"] }],
            primaryDelegatesByState: { "1": { IA: { x: 3 } } },
          },
        ],
      },
      "1"
    );
    expect(detail?.votedStateIds.sort()).toEqual(["IA", "NH", "SC"]);
  });

  it("shows what happened in a voted state and what is projected everywhere else", async () => {
    const filed = candidateRow();
    const cid = filed._id.toString();
    const { projectPrimaryByState } = await import("@/lib/primaryProjection");
    vi.mocked(projectPrimaryByState).mockReturnValue({
      byState: { IA: { [cid]: 999 }, NH: { [cid]: 120 } },
      stateWinners: { IA: cid, NH: cid },
    } as never);

    const detail = await build(
      {
        politicalParties: [DEM],
        electionCandidates: [filed],
        electionVoteTallies: [
          {
            electionId: ELECTION_ID,
            primaryWaveHistory: [{ statesVoted: ["IA"] }],
            primaryStateVotes: { "1": { IA: { [cid]: 4200 } } },
          },
        ],
      },
      "1"
    );

    // Iowa voted, so it reports the count, not the forecast it superseded.
    expect(detail?.byState.IA).toEqual({ [cid]: 4200 });
    expect(detail?.byState.NH).toEqual({ [cid]: 120 });
  });

  it("drops tally rows for candidates no longer in the race", async () => {
    const filed = candidateRow();
    const cid = filed._id.toString();
    const withdrawn = new ObjectId().toString();
    const detail = await build(
      {
        politicalParties: [DEM],
        electionCandidates: [filed],
        electionVoteTallies: [
          {
            electionId: ELECTION_ID,
            primaryWaveHistory: [{ statesVoted: ["IA"] }],
            primaryStateVotes: { "1": { IA: { [cid]: 4200, [withdrawn]: 1800 } } },
          },
        ],
      },
      "1"
    );
    expect(Object.keys(detail!.byState.IA)).toEqual([cid]);
  });

  it("names every state so the picker can be searched by name", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const detail = await build(
      {
        politicalParties: [DEM],
        electionCandidates: [candidateRow({ characterId: charId })],
        characters: [
          { _id: charId, userId, name: "Filer", homeState: "IA", countryId: "US", actions: 25 },
        ],
        states: [{ _id: "IA", name: "Iowa" }],
      },
      "1",
      { userId: userId.toString(), activeCharacterId: charId.toString() }
    );

    expect(detail?.stateNameById.IA).toBe("Iowa");
    expect(detail?.viewerCampaign?.states.find((s) => s.id === "IA")?.name).toBe("Iowa");
  });

  describe("the viewer's own campaign", () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    const rows = () => ({
      politicalParties: [DEM],
      electionCandidates: [
        candidateRow({
          characterId: charId,
          primaryCampaignState: "IA",
          primaryCampaignTicks: 3,
          primarySurgeUsed: false,
        }),
      ],
      characters: [
        {
          _id: charId,
          userId,
          name: "Filer",
          homeState: "IA",
          countryId: "US",
          actions: 25,
          funds: 90_000,
          currencyBalances: { campaign: 250_000 },
        },
      ],
      states: [{ _id: "IA", name: "Iowa" }],
    });
    const viewer = { userId: userId.toString(), activeCharacterId: charId.toString() };

    it("carries where they are camped and for how long", async () => {
      const detail = await build(rows(), "1", viewer);
      expect(detail?.viewerCampaign?.currentCampaignState).toBe("IA");
      expect(detail?.viewerCampaign?.currentTicks).toBe(3);
      expect(detail?.viewerCampaign?.tickCap).toBe(PRIMARY_CAMPAIGN_TICK_CAP);
      expect(detail?.viewerCampaign?.homeState).toBe("IA");
      expect(detail?.viewerCampaign?.surgeUsed).toBe(false);
    });

    it("quotes the surge price the action actually charges", async () => {
      const detail = await build(rows(), "1", viewer);
      expect(detail?.viewerCampaign?.surgeCostFunds).toBe(PRIMARY_HOME_SURGE_COST_FUNDS);
      expect(detail?.viewerCampaign?.surgeCostActions).toBe(PRIMARY_HOME_SURGE_COST_ACTIONS);
      expect(detail?.viewerCampaign?.surgeBoost).toBe(PRIMARY_HOME_SURGE_PCT);
    });

    it("reports price and balance in the same currency the route charges in", async () => {
      // The route gates on currencyBalances.campaign against a price converted
      // at the character's fx rate. Reporting the anchor price against `funds`
      // would let the button enable on a balance the route then rejects.
      const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
      vi.mocked(loadCharacterFxRate).mockResolvedValue({ rate: 2, ok: true });

      const detail = await build(rows(), "1", viewer);
      expect(detail?.viewerCampaign?.playerFunds).toBe(250_000);
      expect(detail?.viewerCampaign?.surgeCostFunds).toBe(PRIMARY_HOME_SURGE_COST_FUNDS * 2);
    });

    it("is null for a viewer with no candidate in this party", async () => {
      const detail = await build(rows(), "1", {
        userId: new ObjectId().toString(),
        activeCharacterId: new ObjectId().toString(),
      });
      expect(detail).not.toBeNull();
      expect(detail?.viewerCampaign).toBeNull();
    });

    it("falls back to the user's character when the active profile is malformed", async () => {
      // Stale session data must not turn a read into a 500 inside ObjectId; the
      // viewer still gets their own campaign back.
      const detail = await build(rows(), "1", {
        userId: userId.toString(),
        activeCharacterId: "not-an-object-id",
      });
      expect(detail?.viewerCampaign?.currentCampaignState).toBe("IA");
    });

    it("is null for a signed-out viewer", async () => {
      const detail = await build(rows(), "1", null);
      expect(detail?.viewerCampaign).toBeNull();
    });
  });
});
