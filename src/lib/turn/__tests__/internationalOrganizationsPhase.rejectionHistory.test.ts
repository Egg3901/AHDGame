import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

const stubDb = () =>
  ({
    collection: () => ({ findOne: async () => ({ _id: "current", preset: "1953-default" }) }),
  }) as unknown as Db;

let roster: string[] = [];

vi.mock("@/lib/db/collections", () => ({
  getOrganizationLeadershipCollection: vi.fn(),
  getOrganizationLeadershipElectionsCollection: vi.fn(),
  getOrganizationLegislationCollection: vi.fn(),
  getOrganizationMembershipsCollection: vi.fn(),
  getOrganizationProposalsCollection: vi.fn(),
  getOrganizationFundsCollection: vi.fn(),
}));
const recordOrgHistoryEvent = vi.fn();
vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: vi.fn(async () => roster),
  loadOrganizationDef: vi.fn(),
  recordOrgHistoryEvent: (...args: unknown[]) => recordOrgHistoryEvent(...args),
}));
vi.mock("@/lib/nppAutonomy/autonomousOrgVoting", () => ({
  castAutonomousOrgVotes: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/internationalOrganizations/founding", () => ({
  loadOrgFoundingContext: vi.fn().mockResolvedValue({ liveYear: null, preset: "1953-default" }),
}));
vi.mock("@/lib/countryAccess", () => ({ getAllCountryAccess: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/organizationFund", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/internationalOrganizations/organizationFund")>()),
  chargeOrganizationDues: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/internationalOrganizations/queries/worldOrganizations", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/internationalOrganizations/queries/worldOrganizations")
  >()),
  loadUsdGdpByCountry: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/internationalOrganizations/tribute", () => ({
  chargeOrganizationTribute: vi.fn().mockResolvedValue({ collectedLocal: 0, payers: 0, minted: 0 }),
}));
vi.mock("@/lib/internationalOrganizations/joinApplication", () => ({
  admitMember: vi.fn(),
  resolveJoinApplication: vi.fn(),
}));
vi.mock("@/lib/db/collections/conflicts", () => ({ getConflict: vi.fn(async () => null) }));

const { processInternationalOrganizationsTurn } =
  await import("../internationalOrganizationsPhase");

const allEnabled = () =>
  new Proxy({} as Record<string, { enabledForPlayers: boolean }>, {
    get: (_t, key) =>
      typeof key === "string" && key !== "then" ? { enabledForPlayers: true } : undefined,
  });

const empty = () => ({
  find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  updateOne: vi.fn(),
  updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
});

/** The titles passed to recordOrgHistoryEvent this run. */
const loggedTitles = () => recordOrgHistoryEvent.mock.calls.map((c) => String(c[3]));

describe("a resolution the members did not carry", () => {
  beforeEach(async () => {
    recordOrgHistoryEvent.mockClear();
    roster = ["US", "UK"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(allEnabled() as never);
  });

  it("records the rejection on the proposing country's history", async () => {
    const collections = await import("@/lib/db/collections");
    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue(empty() as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue(empty() as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue(
      empty() as never
    );
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      find: vi
        .fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId("507f1f77bcf86cd7994390c1"),
              organizationId: "NATO",
              type: "sanctions",
              title: "Embargo on oil",
              parties: [],
              proposingCountryId: "US",
              proposedByCharacterId: new ObjectId("507f1f77bcf86cd7994390c2"),
              status: "pending",
              closesOnTurn: 10,
              // One yes against a roll of two falls short of a majority.
              votes: [{ countryId: "US", vote: "yes" }],
            },
          ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as never);

    await processInternationalOrganizationsTurn(stubDb(), 10);

    // A vote that fails silently is a vote players cannot learn from.
    expect(loggedTitles().some((t) => /Embargo on oil/.test(t) && /reject/i.test(t))).toBe(true);
  });
});

describe("a chair election the members did not carry", () => {
  beforeEach(async () => {
    recordOrgHistoryEvent.mockClear();
    roster = ["US", "UK"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(allEnabled() as never);
  });

  it("records the failed election on the candidate's country history", async () => {
    const collections = await import("@/lib/db/collections");
    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue(empty() as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue(empty() as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue(empty() as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId("507f1f77bcf86cd7994390d1"),
            organizationId: "NATO",
            candidateCharacterId: new ObjectId("507f1f77bcf86cd7994390d2"),
            candidateCharacterName: "A Candidate",
            candidateCountryId: "US",
            status: "pending",
            closesOnTurn: 10,
            votes: [{ countryId: "US", vote: "yes" }],
          },
        ]),
      }),
      updateOne: vi.fn(),
    } as never);

    await processInternationalOrganizationsTurn(stubDb(), 10);

    expect(loggedTitles().some((t) => /A Candidate/.test(t) && /not elected/i.test(t))).toBe(true);
  });
});
