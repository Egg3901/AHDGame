import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSingleplayer, getDb } = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({ requireSingleplayer }));
vi.mock("@/lib/mongodb", () => ({ getDb }));

import { ALLOWED_FEATURE_FLAGS, METRIC_DEFINITION_VERSION } from "@/lib/clientStatistics";
import { GET } from "./route";

function emptyFind(docs: unknown[] = []) {
  return {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) }),
      }),
      toArray: vi.fn().mockResolvedValue(docs),
    }),
    findOne: vi.fn().mockResolvedValue(null),
    countDocuments: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  };
}

function database(
  state: Record<string, unknown> | null,
  extras: Record<string, Record<string, unknown>> = {}
) {
  const collections: Record<string, Record<string, unknown>> = {
    gameState: { findOne: vi.fn().mockResolvedValue(state) },
    politicalParties: { countDocuments: vi.fn().mockResolvedValue(7) },
    corporations: { countDocuments: vi.fn().mockResolvedValue(8) },
    npps: { countDocuments: vi.fn().mockResolvedValue(9) },
    corporateSectors: {
      aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ total: 10 }]) }),
    },
    electedOfficials: {
      aggregate: vi
        .fn()
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ total: 5, npp: 2 }]) }),
    },
    economicVitalSigns: { findOne: vi.fn().mockResolvedValue(null) },
    states: emptyFind(),
    macroMetrics: emptyFind(),
    countryState: emptyFind(),
    federalBudget: emptyFind(),
    governmentApprovals: emptyFind(),
    elections: { aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) },
    governmentFormations: { countDocuments: vi.fn().mockResolvedValue(0) },
    parliamentSeatsHistory: emptyFind(),
    countryLeaderStates: emptyFind(),
    ...extras,
  };
  return { collection: (name: string) => collections[name] ?? emptyFind() };
}

describe("GET /api/singleplayer/statistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSingleplayer.mockReturnValue(null);
  });

  it("enforces the local-only guard before reading the database", async () => {
    const denied = new Response(JSON.stringify({ error: "local only" }), { status: 403 });
    requireSingleplayer.mockReturnValue(denied);

    const response = await GET(new Request("http://example.com/api/singleplayer/statistics"));

    expect(response).toBe(denied);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns every allowlisted flag, using stored config when state fields are absent", async () => {
    const state: Record<string, unknown> = {
      _id: "current",
      preset: "1953-default",
      currentTurn: 14,
      nppAutonomyLevel: "v4",
      singleplayerConfig: {
        mode: "normal",
        difficulty: "normal",
        featureFlags: { autoSectorSeedEnabled: true },
      },
      forexEnabled: false,
    };
    getDb.mockResolvedValue(database(state));

    const payload = await (
      await GET(new Request("http://127.0.0.1:3111/api/singleplayer/statistics"))
    ).json();

    expect(Object.keys(payload.setup.featureFlags).sort()).toEqual(
      [...ALLOWED_FEATURE_FLAGS].sort()
    );
    expect(payload.setup.featureFlags.forexEnabled).toBe(false);
    expect(payload.setup.featureFlags.autoSectorSeedEnabled).toBe(true);
    expect(payload.setup.featureFlags.rpgStatsEnabled).toBe(false);
    expect(payload.metricDefinitionVersion).toBe(METRIC_DEFINITION_VERSION);
  });

  it("contains aggregate setup and metrics only, with no identifiers", async () => {
    getDb.mockResolvedValue(
      database({
        _id: "current",
        preset: "2023-default",
        currentTurn: 3,
        nppAutonomyLevel: "off",
        singleplayerConfig: { mode: "worldsim", difficulty: "easy", featureFlags: {} },
      })
    );

    const payload = await (
      await GET(new Request("http://127.0.0.1:3111/api/singleplayer/statistics"))
    ).json();
    const serialized = JSON.stringify(payload);

    expect(payload.metrics).toMatchObject({ partyCount: 7, corporationCount: 8, nppCount: 9 });
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("characterId");
    expect(serialized).not.toContain("displayName");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("partyName");
  });

  it("emits GDP, population, politics, and election aggregates without entity names", async () => {
    getDb.mockResolvedValue(
      database(
        {
          _id: "current",
          preset: "2019-default",
          currentTurn: 24,
          nppAutonomyLevel: "v5",
          singleplayerConfig: { mode: "normal", difficulty: "normal", featureFlags: {} },
        },
        {
          states: emptyFind([
            { _id: "CA", gdp: 1000, population: 10_000_000 },
            { _id: "NY", gdp: 500, population: 5_000_000 },
          ]),
          macroMetrics: emptyFind([
            {
              _id: "CA",
              economic: { gdpGrowth: { value: 2 }, unemploymentRate: { value: 4 } },
              population: { populationGrowth: { value: 0.5 } },
            },
            {
              _id: "NY",
              economic: { gdpGrowth: { value: 4 }, unemploymentRate: { value: 6 } },
              population: { populationGrowth: { value: 1.5 } },
            },
          ]),
          countryState: emptyFind([
            { _id: "US", governmentType: "presidential", rulingPartyId: 1 },
            { _id: "RU", governmentType: "onePartyState", rulingPartyId: 2 },
            { _id: "UK", governmentType: "parliamentaryMonarchy", rulingPartyId: null },
          ]),
          federalBudget: emptyFind([
            { economicFactors: { inflationRate: 2 } },
            { economicFactors: { inflationRate: 4 } },
          ]),
          governmentApprovals: emptyFind([{ approvalRating: 40 }, { approvalRating: 60 }]),
          elections: {
            aggregate: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                { _id: "active", count: 3 },
                { _id: "completed", count: 11 },
                { _id: "secret-status", count: 9 },
              ]),
            }),
          },
          governmentFormations: { countDocuments: vi.fn().mockResolvedValue(4) },
          parliamentSeatsHistory: emptyFind([
            { turn: 24, seats: 100 },
            { turn: 24, seats: 50 },
            { turn: 23, seats: 999 },
          ]),
          countryLeaderStates: emptyFind([{ popularLegitimacy: 70 }, { popularLegitimacy: 50 }]),
        }
      )
    );

    const payload = await (
      await GET(new Request("http://127.0.0.1:3111/api/singleplayer/statistics"))
    ).json();
    const serialized = JSON.stringify(payload);

    expect(payload.metrics.gdpTotal).toBe(1_500_000_000);
    expect(payload.metrics.totalPopulation).toBe(15_000_000);
    expect(payload.metrics.gdpPerCapita).toBe(100);
    expect(payload.metrics.gdpGrowthPercent).toBeCloseTo(8 / 3);
    expect(payload.metrics.unemploymentRatePercent).toBeCloseTo(14 / 3);
    expect(payload.metrics.populationGrowthPercent).toBeCloseTo(5 / 6);
    expect(payload.metrics.inflationRatePercent).toBe(3);
    expect(payload.metrics.democracyCountryCount).toBe(2);
    expect(payload.metrics.autocracyCountryCount).toBe(1);
    expect(payload.metrics.executiveControlSharePercent).toBeCloseTo(200 / 3);
    expect(payload.metrics.governmentApprovalPercent).toBe(50);
    expect(payload.metrics.electionCountActive).toBe(3);
    expect(payload.metrics.electionCountCompleted).toBe(11);
    expect(payload.metrics.electionCountUpcoming).toBeUndefined();
    expect(payload.metrics).not.toHaveProperty("secret-status");
    expect(payload.metrics.governmentFormationCount).toBe(4);
    expect(payload.metrics.legislativeSeatTotal).toBe(150);
    expect(payload.metrics.averageStability).toBe(60);
    expect(payload.metrics.minStability).toBe(50);
    expect(payload.metrics.maxStability).toBe(70);
    expect(serialized).not.toContain("CA");
    expect(serialized).not.toContain("secret-status");
    expect(serialized).not.toContain("Democratic");
  });

  it("omits missing macro metrics from older local worlds instead of fabricating them", async () => {
    getDb.mockResolvedValue(
      database({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
        nppAutonomyLevel: "v4",
        singleplayerConfig: { mode: "normal", difficulty: "normal", featureFlags: {} },
      })
    );

    const payload = await (
      await GET(new Request("http://127.0.0.1:3111/api/singleplayer/statistics"))
    ).json();

    expect(payload.metrics.gdpTotal).toBeUndefined();
    expect(payload.metrics.gdpGrowthPercent).toBeUndefined();
    expect(payload.metrics.governmentApprovalPercent).toBeUndefined();
    expect(payload.metrics.nppCount).toBe(9);
  });
});
