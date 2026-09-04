import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

/**
 * `mode` drives the NPP foreign-policy rollout, `nppGoverned` lists countries
 * with a formed NPP-headed government (the roll `ballotVotingMembers` widens by
 * on a majority ballot).
 */
const stubDb = (mode = "off", nppGoverned: string[] = []) =>
  ({
    collection: (name?: string) => ({
      findOne: async () => ({
        _id: "current",
        preset: "1953-default",
        nppForeignPolicyMode: mode,
      }),
      find: () => ({
        toArray: async () =>
          name === "governmentFormations"
            ? nppGoverned.map((countryId) => ({ _id: countryId, countryId }))
            : [],
      }),
    }),
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
const admitMember = vi.fn();
vi.mock("@/lib/internationalOrganizations/joinApplication", () => ({
  admitMember: (...args: unknown[]) => admitMember(...args),
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

const PROPOSAL_ID = new ObjectId("507f1f77bcf86cd7994390b1");

/** Runs the phase with one pending admission for FR carrying `votes`. */
async function runProposal(
  votes: { countryId: string; vote: "yes" | "no" | "abstain" }[],
  db: Db = stubDb()
) {
  const collections = await import("@/lib/db/collections");
  const empty = () => ({
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  });

  vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue(empty() as never);
  vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue(empty() as never);
  vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue(
    empty() as never
  );
  vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
    updateOne: vi.fn(),
  } as never);

  const proposalUpdate = vi.fn();
  vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
    find: vi
      .fn()
      .mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: PROPOSAL_ID,
            organizationId: "NATO",
            proposingCountryId: "FR",
            status: "pending",
            closesOnTurn: 10,
            votes,
          },
        ]),
      })
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: proposalUpdate,
  } as never);

  await processInternationalOrganizationsTurn(db, 10);

  const status = proposalUpdate.mock.calls[0]?.[1]?.$set?.status as string | undefined;
  return { admitted: admitMember.mock.calls.length > 0, status };
}

describe("membership proposal resolution", () => {
  beforeEach(async () => {
    admitMember.mockClear();
    roster = ["US", "UK"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing() as never);
  });

  it("admits the applicant when every voting member votes yes", async () => {
    const { admitted, status } = await runProposal([
      { countryId: "US", vote: "yes" },
      { countryId: "UK", vote: "yes" },
    ]);
    expect(admitted).toBe(true);
    expect(status).toBe("approved");
  });

  it("rejects the applicant when a voting member never votes", async () => {
    const { admitted, status } = await runProposal([{ countryId: "US", vote: "yes" }]);
    expect(admitted).toBe(false);
    expect(status).toBe("rejected");
  });

  it("rejects the applicant when a voting member abstains", async () => {
    const { admitted, status } = await runProposal([
      { countryId: "US", vote: "yes" },
      { countryId: "UK", vote: "abstain" },
    ]);
    expect(admitted).toBe(false);
    expect(status).toBe("rejected");
  });

  it("does not count a silenced member against the applicant", async () => {
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("UK") as never);
    const { admitted, status } = await runProposal([{ countryId: "US", vote: "yes" }]);
    expect(admitted).toBe(true);
    expect(status).toBe("approved");
  });

  it("does not seat an NPP-governed member on an admission ballot in active mode", async () => {
    // Ticket #1257. An NPP government plans once every six turns and casts one
    // ranked action, so over a 24-turn ballot it has four contested chances to
    // vote and routinely spends all four elsewhere. On a MAJORITY ballot that
    // silence merely costs a yes; under unanimity it is a permanent veto, and it
    // made every Warsaw Pact admission unwinnable — China closed 5-of-7 and
    // North Korea 2-of-7 with not one "no" cast against either.
    roster = ["US", "UK", "PL"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("PL") as never);
    const { admitted, status } = await runProposal(
      [
        { countryId: "US", vote: "yes" },
        { countryId: "UK", vote: "yes" },
      ],
      stubDb("active", ["PL"])
    );
    expect(admitted).toBe(true);
    expect(status).toBe("approved");
  });
});
