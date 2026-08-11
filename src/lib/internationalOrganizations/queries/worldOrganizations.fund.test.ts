import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationSummaries: vi.fn(),
  ensureFoundingMembershipsAndLeadership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(200) }));
// Only the US votes. FR is a full member with a real economy and no vote — the
// exact shape the dues/tribute split exists to handle.
vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: vi.fn().mockResolvedValue({
    US: { enabledForPlayers: true },
    FR: { enabledForPlayers: false },
  }),
}));

const { loadOrganizationSummaries } = await import("@/lib/internationalOrganizations/service");
const { loadWorldOrganizationsView } = await import("./worldOrganizations");

function db(states: { countryId: string; gdp?: number; population: number }[], preset: string): Db {
  const statesCursor = { project: () => statesCursor, toArray: async () => states };
  const emptyCursor = { project: () => emptyCursor, toArray: async () => [] };
  return {
    collection: (name: string) => ({
      find: () => (name === "states" ? statesCursor : emptyCursor),
      findOne: async () => (name === "gameState" ? { _id: "current", preset } : null),
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

const load = async (preset: string, usGdp = 20_000_000, frGdp = 2_000_000) => {
  vi.mocked(loadOrganizationSummaries).mockResolvedValue([nato(["US", "FR"])] as never);
  const view = await loadWorldOrganizationsView(
    db(
      [
        { countryId: "US", gdp: usGdp, population: 335 },
        { countryId: "FR", gdp: frGdp, population: 68 },
      ],
      preset
    )
  );
  return view.organizations[0]!.fund;
};

describe("fund income splits the way the charge does", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bills dues to voters only, and tribute to everyone else", async () => {
    // `orgMembership` is explicit that dues and tribute PARTITION the roll:
    // nobody is billed both, nobody is billed neither. The projection used to
    // sum every priced member into the dues line, which billed France at the
    // dues rate on paper while the turn phase charged it tribute.
    //
    // Asserted by moving one economy at a time rather than by comparing the two
    // lines. Raw `state.gdp` is in each country's own era units — France's 1953
    // regions are authored in old francs at 350/$ — so the two are only
    // comparable AFTER the anchor conversion, and a ratio between them says
    // nothing about who was billed.
    const base = await load("1953-default");
    expect(base.annualDuesLocal).toBeGreaterThan(0);
    expect(base.annualTributeLocal).toBeGreaterThan(0);

    const richerVoter = await load("1953-default", 40_000_000, 2_000_000);
    expect(richerVoter.annualDuesLocal).toBeCloseTo(base.annualDuesLocal * 2, -1);
    expect(richerVoter.annualTributeLocal).toBe(base.annualTributeLocal);

    const richerClient = await load("1953-default", 20_000_000, 4_000_000);
    expect(richerClient.annualTributeLocal).toBeCloseTo(base.annualTributeLocal! * 2, -1);
    expect(richerClient.annualDuesLocal).toBe(base.annualDuesLocal);
  });

  it("reports no tribute for an organisation that does not levy it", async () => {
    // Tribute is the two armed blocs' bargain and only in a 1953 world. Any
    // other org must report zero rather than a figure nobody is charged.
    const fund = await load("2019-default");
    expect(fund.tributeRateAnnual).toBe(0);
    expect(fund.annualTributeLocal).toBe(0);
    expect(fund.annualDuesLocal).toBeGreaterThan(0);
  });
});
