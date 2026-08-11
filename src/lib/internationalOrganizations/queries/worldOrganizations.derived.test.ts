import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationSummaries: vi.fn(),
  ensureFoundingMembershipsAndLeadership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(200) }));

const { loadOrganizationSummaries } = await import("@/lib/internationalOrganizations/service");
const { loadWorldOrganizationsView } = await import("./worldOrganizations");

/** db whose `states` collection returns the seeded rows; other collections empty. */
function dbWithStates(states: { countryId: string; gdp?: number; population: number }[]): Db {
  const statesCursor = { project: () => statesCursor, toArray: async () => states };
  const emptyCursor = { project: () => emptyCursor, toArray: async () => [] };
  return {
    collection: (name: string) => ({
      find: () => (name === "states" ? statesCursor : emptyCursor),
      // Two things read this doc: the world preset, so GDP normalizes at the
      // era's rate (refs #3778) — these fixtures are modern-era — and the
      // alignment feature gate, whose absence reads as off, fail-closed.
      findOne: async () =>
        name === "gameState" ? { _id: "current", preset: "2019-default" } : null,
    }),
  } as unknown as Db;
}

function summary(id: string, isCustom: boolean, memberIds: string[]) {
  return {
    id,
    def: {
      id,
      name: id,
      shortName: id,
      isCustom,
      foundingMembers: [],
      leadership: {},
      charter: "",
      category: "political",
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
  };
}

describe("loadWorldOrganizationsView enrichment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attaches identity + GDP-share derived metrics to each org", async () => {
    vi.mocked(loadOrganizationSummaries).mockResolvedValue([
      summary("UN", false, ["US", "IE"]),
    ] as never);

    const db = dbWithStates([
      { countryId: "US", gdp: 27_000_000, population: 335 },
      { countryId: "IE", gdp: 550_000, population: 5 },
    ]);

    const view = await loadWorldOrganizationsView(db);
    const un = view.organizations[0];

    expect(un.identity.accent).toBe("#5b92e5");
    const total = un.derived.members.reduce((s, m) => s + m.contributionPct, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(un.derived.worldEconomySharePct).toBeGreaterThanOrEqual(0);
    expect(un.derived.worldEconomySharePct).toBeLessThanOrEqual(100);
    const us = un.derived.members.find((m) => m.countryId === "US")!;
    expect(us.influenceIndex).toBe(100);
  });
});
