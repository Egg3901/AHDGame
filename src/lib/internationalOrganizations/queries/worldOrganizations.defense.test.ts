import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationSummaries: vi.fn(),
  ensureFoundingMembershipsAndLeadership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(200) }));
vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: vi.fn().mockResolvedValue({
    US: { enabledForPlayers: true },
  }),
}));

const { loadOrganizationSummaries } = await import("@/lib/internationalOrganizations/service");
const { loadWorldOrganizationsView } = await import("./worldOrganizations");

function cursor<T>(rows: T[]) {
  const c = { project: () => c, toArray: async () => rows };
  return c;
}

function db(opts: {
  states: { countryId: string; gdp?: number; population: number }[];
  budgets: {
    countryId: string;
    gdp?: number;
    spending?: { byCategory?: Record<string, number> };
    baselineSpendingByCategory?: Record<string, number>;
  }[];
  macros: { entityId: string; sectors?: Record<string, { capacity?: number }> }[];
}): Db {
  const empty = cursor([]);
  return {
    collection: (name: string) => ({
      find: () => {
        if (name === "states") return cursor(opts.states);
        if (name === "federalBudget") return cursor(opts.budgets);
        if (name === "macroCountries") return cursor(opts.macros);
        return empty;
      },
      findOne: async () =>
        name === "gameState" ? { _id: "current", preset: "1953-default" } : null,
    }),
  } as unknown as Db;
}

const nato = (memberIds: string[]) => ({
  id: "NATO",
  def: {
    id: "NATO",
    name: "NATO",
    shortName: "NATO",
    isCustom: false,
    foundingMembers: ["US"],
    leadership: {},
    charter: "",
    category: "security",
  },
  members: memberIds.map((countryId) => ({
    countryId,
    countryName: countryId,
    flagEmoji: "🏳️",
    status: "founding",
    joinedTurn: 0,
  })),
  pendingMembershipProposals: [],
  pendingLegislation: [],
  activeLegislation: [],
  pendingWithdrawalMeasures: [],
  leadership: null,
  pendingLeadershipElections: [],
});

describe("defense pledge percents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rates playable members from the federal defense line and macros from sector share", async () => {
    vi.mocked(loadOrganizationSummaries).mockResolvedValue([nato(["US", "JO", "CA"])] as never);

    const view = await loadWorldOrganizationsView(
      db({
        states: [{ countryId: "US", gdp: 10_000, population: 160 }],
        budgets: [
          {
            countryId: "US",
            gdp: 1_000_000,
            spending: { byCategory: { defense: 40_000 } },
          },
        ],
        macros: [
          {
            entityId: "JO",
            sectors: { agriculture: { capacity: 75 }, defense: { capacity: 25 } },
          },
        ],
      })
    );

    const pct = view.organizations[0]!.defensePctByCountry;
    expect(pct.US).toBeCloseTo(4);
    expect(pct.JO).toBeCloseTo(25);
    expect(pct.CA).toBeUndefined();
  });

  it("falls back to baseline defense spending when the enacted line is empty", async () => {
    vi.mocked(loadOrganizationSummaries).mockResolvedValue([nato(["US"])] as never);

    const view = await loadWorldOrganizationsView(
      db({
        states: [{ countryId: "US", gdp: 10_000, population: 160 }],
        budgets: [
          {
            countryId: "US",
            gdp: 1_000_000,
            spending: { byCategory: { defense: 0 } },
            baselineSpendingByCategory: { defense: 50_000 },
          },
        ],
        macros: [],
      })
    );

    expect(view.organizations[0]!.defensePctByCountry.US).toBeCloseTo(5);
  });
});
