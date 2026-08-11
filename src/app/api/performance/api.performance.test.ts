/**
 * API performance tests for intensive endpoints.
 * Measures handler execution time with mocked DB returning realistic data volumes.
 * Run with: npm run test -- src/app/api/performance/api.performance.test.ts
 *
 * Thresholds are tuned for CI; local runs may vary. Increase thresholds if tests
 * flake on slower machines.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const NATIONAL_METRICS_THRESHOLD_MS = 500;
const MAP_OVERVIEW_THRESHOLD_MS = 400;
const ELECTIONS_LIST_THRESHOLD_MS = 500;
const POLITICIANS_THRESHOLD_MS = 300;
const CONGRESS_MEMBERS_THRESHOLD_MS = 300;
const ELECTION_DETAIL_THRESHOLD_MS = 400;

// ─── Mock data factories ────────────────────────────────────────────────────

function makeStates(
  count: number,
  overrides?: Partial<{ countryId: string; houseDistricts: number }>
) {
  const ids = [
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
  ];
  return ids.slice(0, count).map((id, i) => ({
    _id: id,
    name: `State ${id}`,
    population: 1_000_000 + i * 500_000,
    houseDistricts: 1 + (i % 10),
    ...overrides,
  }));
}

function makeMetricCategory(metricCount: number) {
  const cat: Record<string, { value: number }> = {};
  for (let i = 0; i < metricCount; i++) {
    cat[`metric_${i}`] = { value: 50 + Math.random() * 50 };
  }
  return cat;
}

function makeStateMetrics(count: number) {
  const ids = [
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
  ];
  const categories = [
    "economic",
    "education",
    "healthcare",
    "infrastructure",
    "publicSafety",
    "environment",
    "social",
    "governance",
    "population",
    "mediaInformation",
  ];
  return ids.slice(0, count).map((id) => {
    const doc: Record<string, unknown> = { _id: id };
    for (const cat of categories) {
      doc[cat] = makeMetricCategory(5);
    }
    return doc;
  });
}

function makeMapOverviewMocks() {
  const stateIds = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA"];
  const parties = [
    { _id: "democrat", countryId: "US", name: "Democrat", color: "#3B82F6" },
    { _id: "republican", countryId: "US", name: "Republican", color: "#EF4444" },
  ];
  const statePartyOrgs = stateIds.flatMap((stateId) =>
    parties.map((p) => ({ stateId, partyId: p._id, organization: Math.floor(Math.random() * 100) }))
  );
  const electedOfficials = stateIds.flatMap((stateId, i) => [
    {
      state: stateId,
      officeType: "senate",
      senateClass: 1,
      party: parties[i % 2]._id,
      characterName: "Sen 1",
    },
    {
      state: stateId,
      officeType: "senate",
      senateClass: 2,
      party: parties[(i + 1) % 2]._id,
      characterName: "Sen 2",
    },
  ]);
  const houseReps = stateIds.flatMap((stateId, i) =>
    Array.from({ length: 3 }, (_, j) => ({
      state: stateId,
      officeType: "house",
      district: j + 1,
      party: parties[(i + j) % 2]._id,
      characterName: "Rep",
      seatsHeld: 1,
    }))
  );
  const states = makeStates(10);
  const metrics = makeStateMetrics(10);
  const demographics = stateIds.map((id) => ({
    _id: id,
    economicLean: (Math.random() - 0.5) * 2,
    socialLean: (Math.random() - 0.5) * 2,
  }));
  const demographicCategories = [{ _id: "cat1", countryId: "US", name: "Cat1", weight: 1 }];

  return {
    politicalParties: {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(parties) }),
    },
    statePartyOrg: {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(statePartyOrgs) }),
    },
    electedOfficials: {
      find: vi.fn().mockImplementation((q: { officeType?: string; countryId?: string }) => {
        const arr =
          q?.officeType === "senate"
            ? electedOfficials
            : q?.officeType === "house"
              ? houseReps
              : q?.officeType === "governor"
                ? []
                : [];
        const cursor = {
          toArray: vi.fn().mockResolvedValue(arr),
          sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(arr) }),
        };
        return cursor;
      }),
    },
    macroMetrics: {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(metrics) }),
    },
    states: { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }) },
    stateDemographics: {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(demographics) }),
    },
    demographicCategories: {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(demographicCategories) }),
    },
    elections: { findOne: vi.fn().mockResolvedValue(null) },
  };
}

// ─── National Metrics ───────────────────────────────────────────────────────

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/stateTickRates", () => ({
  computeAllNationalMetricTickRates: vi.fn().mockResolvedValue({}),
}));

describe("API Performance: National Metrics", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const states = makeStates(50);
    const metrics = makeStateMetrics(50);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "states")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }) };
        if (name === "macroMetrics")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(metrics) }) };
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    } as never);
  });

  it("completes within threshold with 50 states and full metrics", async () => {
    const { GET } = await import("@/app/api/country/[code]/metrics/route");
    const start = performance.now();
    const res = await GET(new Request("http://localhost/api/country/us/metrics"), {
      params: Promise.resolve({ code: "us" }),
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(NATIONAL_METRICS_THRESHOLD_MS);
  });
});

// ─── Map Overview ───────────────────────────────────────────────────────────

describe("API Performance: Map Overview", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const mocks = makeMapOverviewMocks();
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        const key = name === "politicalParties" ? "politicalParties" : name;
        return (
          (mocks as Record<string, unknown>)[key] ?? {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            // e.g. presidentialService reads gameState via findOne({_id:"current"}).
            findOne: vi.fn().mockResolvedValue(null),
          }
        );
      }),
    } as never);
  });

  it("completes within threshold with full map data", async () => {
    const { GET } = await import("@/app/api/map/overview/route");
    const mockRequest = new Request("http://localhost:3000/api/map/overview?countryId=US");
    const start = performance.now();
    const res = await GET(mockRequest);
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(MAP_OVERVIEW_THRESHOLD_MS);
  });
});

// ─── Elections List ──────────────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null), set: vi.fn() }),
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, jwtVerify: vi.fn().mockRejectedValue(new Error("No token")) };
});

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn().mockResolvedValue(null),
  getAuthUserWithCharacter: vi.fn().mockResolvedValue(null),
}));

describe("API Performance: Elections List", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const elections = Array.from({ length: 30 }, (_, i) => ({
      _id: `election_${i}`,
      state: "CA",
      countryId: "US",
      electionType: "senate",
      status: "active",
      cycle: 1,
    }));
    const candidates = elections.flatMap((e) =>
      Array.from({ length: 5 }, (_, j) => ({
        electionId: e._id,
        characterId: `char_${j}`,
        isNPP: j % 2 === 0,
      }))
    );
    const chars = [...new Set(candidates.filter((c) => !c.isNPP).map((c) => c.characterId))].map(
      (id) => ({ _id: id, avatarUrl: null })
    );
    const mockSort = vi.fn().mockReturnValue({
      skip: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(elections),
        }),
      }),
    });
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections")
          return {
            countDocuments: vi.fn().mockResolvedValue(elections.length),
            find: vi.fn().mockReturnValue({ sort: mockSort }),
          };
        if (name === "electionCandidates")
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(candidates) }),
          };
        if (name === "characters")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(chars) }) };
        if (name === "npps")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        if (name === "politicalParties")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        if (name === "nppEndorsements")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        if (name === "electionVoteTallies")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        if (name === "primarySnapshots")
          return { aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        if (name === "gameState")
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "current",
              isActive: true,
              currentTurn: 1,
              lastTurnProcessed: new Date(),
            }),
          };
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    } as never);
  });

  it("completes within threshold with 30 elections and candidates", async () => {
    const { GET } = await import("@/app/api/elections/route");
    const start = performance.now();
    const res = await GET(new Request("http://localhost/api/elections?country=US"));
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(ELECTIONS_LIST_THRESHOLD_MS);
  });
});

// ─── Politicians ────────────────────────────────────────────────────────────

describe("API Performance: Politicians", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const chars = Array.from({ length: 100 }, (_, i) => ({
      _id: `char_${i}`,
      name: `Politician ${i}`,
      party: "democrat",
      homeState: "CA",
      currentOffice: null,
      politicalInfluence: 50,
      avatarUrl: null,
      userId: `user_${i}`,
    }));
    const users = chars.map((c) => ({ _id: c.userId, isBanned: false }));
    const npps = Array.from({ length: 50 }, (_, i) => ({
      _id: `npp_${i}`,
      name: `NPP ${i}`,
      party: "republican",
      homeState: "TX",
      currentOffice: null,
      politicalInfluence: 40,
      retiredAt: null,
    }));
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "characters")
          return {
            find: vi.fn().mockReturnValue({
              sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(chars) }),
            }),
            aggregate: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(chars),
            }),
          };
        if (name === "users")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(users) }) };
        if (name === "npps")
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(npps) }),
              }),
            }),
          };
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    } as never);
  });

  it("completes within threshold with 100 characters and 50 NPPs", async () => {
    const { GET } = await import("@/app/api/country/[code]/politicians/route");
    const start = performance.now();
    const res = await GET(new Request("http://localhost/api/country/us/politicians"), {
      params: Promise.resolve({ code: "us" }),
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(POLITICIANS_THRESHOLD_MS);
  });
});

// ─── Congress Members ───────────────────────────────────────────────────────

describe("API Performance: Congress Members", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const officials = Array.from({ length: 135 }, (_, i) => ({
      _id: `off_${i}`,
      officeType: "senate",
      state: ["CA", "TX", "NY", "FL"][i % 4],
      senateClass: (i % 3) + 1,
      characterId: i < 100 ? `char_${i}` : null,
      nppId: i >= 100 ? `npp_${i}` : null,
      characterName: "Senator",
      party: "democrat",
      seatsHeld: 1,
    }));
    const parties = [
      { _id: "democrat", countryId: "US", name: "Democratic Party", color: "#3B82F6" },
    ];
    const chars = officials
      .filter((o) => o.characterId)
      .map((o) => ({ _id: o.characterId, avatarUrl: null }));
    const npps = officials.filter((o) => o.nppId).map((o) => ({ _id: o.nppId, avatarUrl: null }));
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "electedOfficials")
          return {
            find: vi.fn().mockReturnValue({
              sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(officials) }),
            }),
          };
        if (name === "politicalParties")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(parties) }) };
        if (name === "characters")
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(chars) }),
            findOne: vi.fn().mockResolvedValue(null),
          };
        if (name === "npps")
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(npps) }),
            findOne: vi.fn().mockResolvedValue(null),
          };
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }),
    } as never);
  });

  it("completes within threshold with 135 senate officials", async () => {
    const { GET } = await import("@/app/api/country/[code]/congress/members/route");
    const start = performance.now();
    const res = await GET(
      new Request("http://localhost/api/country/us/congress/members?chamber=senate"),
      { params: Promise.resolve({ code: "us" }) }
    );
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(CONGRESS_MEMBERS_THRESHOLD_MS);
  });
});

// ─── Election Detail ────────────────────────────────────────────────────────

describe("API Performance: Election Detail", () => {
  const electionId = "507f1f77bcf86cd799439011";

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const { ObjectId } = await import("mongodb");
    const eid = new ObjectId(electionId);
    const election = {
      _id: eid,
      countryId: "US",
      state: "CA",
      electionType: "senate",
      status: "active",
      cycle: 1,
    };
    const candidates = Array.from({ length: 10 }, (_, i) => {
      // characterId is required on every row; NPP rows store the NPP's own
      // _id there (see electionEntry insert path / getEndorsementTargetId).
      const identityId = new ObjectId();
      return {
        _id: new ObjectId(),
        electionId: eid,
        characterId: identityId,
        nppId: i >= 5 ? identityId : null,
        isNPP: i >= 5,
        status: "active",
        party: i < 5 ? "democrat" : "republican",
        characterName: i < 5 ? "Candidate" : "NPP Candidate",
      };
    });
    const chars = candidates
      .filter((c) => !c.isNPP)
      .map((c) => ({
        _id: c.characterId,
        name: "C",
        party: "democrat",
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 0,
      }));
    const npps = candidates
      .filter((c) => c.isNPP)
      .map((c) => ({
        _id: c.nppId,
        name: "NPP",
        party: "republican",
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 0,
      }));
    const parties = [
      {
        _id: "democrat",
        countryId: "US",
        name: "Democrat",
        economicPosition: 0,
        socialPosition: 0,
        color: "#3B82F6",
      },
    ];
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections")
          return {
            findOne: vi.fn().mockResolvedValue(election),
            // Route also calls elections.find(...).sort(...).project(...).toArray() for adjacent elections.
            // Phase B follow-up adds elections.find(...).sort(...).toArray() (no project) via
            // `getIncumbentSeatShareByParty` to look up the prior-cycle tally — supply both terminations
            // so either chain returns the same empty list.
            find: vi.fn().mockReturnValue({
              sort: vi.fn().mockReturnValue({
                project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        if (name === "gameState")
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "current",
              isActive: true,
              lastTurnProcessed: new Date(),
              currentTurn: 1,
            }),
          };
        if (name === "electionCandidates")
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(candidates) }),
          };
        if (name === "characters")
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(chars) }),
            findOne: vi.fn().mockResolvedValue(null),
          };
        if (name === "npps")
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(npps) }),
            findOne: vi.fn().mockResolvedValue(null),
          };
        if (name === "politicalParties")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(parties) }) };
        if (name === "nppEndorsements")
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        if (name === "primarySnapshots")
          return {
            find: vi.fn().mockReturnValue({
              sort: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
              }),
            }),
          };
        if (name === "electionVoteTallies")
          return {
            findOne: vi.fn().mockResolvedValue(null),
            replaceOne: vi.fn().mockResolvedValue({ acknowledged: true }),
          };
        return {
          findOne: vi.fn().mockResolvedValue(null),
          // Phase B follow-up's `getFundsByPartyForElection` calls
          // `campaigns.find().project().toArray()`. Generic default mock
          // supports both `.find().toArray()` and `.find().project().toArray()`.
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          }),
        };
      }),
    } as never);
  });

  it("completes within threshold with 10 candidates", async () => {
    const { GET } = await import("@/app/api/elections/route");
    const start = performance.now();
    const res = await GET(new Request(`http://localhost/api/elections?id=${electionId}`));
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(ELECTION_DETAIL_THRESHOLD_MS);
  });
});
