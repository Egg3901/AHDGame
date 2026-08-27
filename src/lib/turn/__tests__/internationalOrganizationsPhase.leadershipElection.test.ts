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
vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: vi.fn(async () => roster),
  loadOrganizationDef: vi.fn(),
  recordOrgHistoryEvent: vi.fn(),
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

/** Every country is player-enabled except the ones named. */
function accessSilencing(...silent: string[]) {
  return new Proxy({} as Record<string, { enabledForPlayers: boolean }>, {
    get: (_t, key) =>
      typeof key === "string" && key !== "then" && !silent.includes(key)
        ? { enabledForPlayers: true }
        : undefined,
  });
}

const ELECTION_ID = new ObjectId("507f1f77bcf86cd7994390a1");

/** Runs the phase with one pending chair election carrying `votes`. */
async function runElection(votes: { countryId: string; vote: "yes" | "no" | "abstain" }[]) {
  const collections = await import("@/lib/db/collections");
  const empty = () => ({
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  });

  vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue(empty() as never);
  vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue(empty() as never);
  vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue(empty() as never);

  const leadershipUpdate = vi.fn();
  vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
    updateOne: leadershipUpdate,
  } as never);

  const electionUpdate = vi.fn();
  vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: ELECTION_ID,
          organizationId: "NATO",
          candidateCharacterId: new ObjectId("507f1f77bcf86cd7994390a2"),
          candidateCharacterName: "Candidate",
          candidateCountryId: "US",
          nominatedByCharacterName: "Nominator",
          status: "pending",
          closesOnTurn: 10,
          votes,
        },
      ]),
    }),
    updateOne: electionUpdate,
  } as never);

  await processInternationalOrganizationsTurn(stubDb(), 10);

  const status = electionUpdate.mock.calls[0]?.[1]?.$set?.status as string | undefined;
  return { seated: leadershipUpdate.mock.calls.length > 0, status };
}

describe("leadership election resolution", () => {
  beforeEach(async () => {
    roster = ["US", "UK"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing() as never);
  });

  it("seats the candidate when a majority of the voting roll votes yes", async () => {
    const { seated, status } = await runElection([
      { countryId: "US", vote: "yes" },
      { countryId: "UK", vote: "yes" },
    ]);
    expect(seated).toBe(true);
    expect(status).toBe("elected");
  });

  it("rejects the candidate when a member of the roll never votes", async () => {
    const { seated, status } = await runElection([{ countryId: "US", vote: "yes" }]);
    expect(seated).toBe(false);
    expect(status).toBe("rejected");
  });

  it("rejects the candidate when a member of the roll abstains", async () => {
    const { seated, status } = await runElection([
      { countryId: "US", vote: "yes" },
      { countryId: "UK", vote: "abstain" },
    ]);
    expect(seated).toBe(false);
    expect(status).toBe("rejected");
  });

  it("ignores a silenced member, so the remaining voters can still elect", async () => {
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("UK") as never);
    const { seated, status } = await runElection([{ countryId: "US", vote: "yes" }]);
    expect(seated).toBe(true);
    expect(status).toBe("elected");
  });
});
