import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processInternationalOrganizationsTurn } from "./internationalOrganizationsPhase";

/**
 * The phase reads the world preset (one `gameState` findOne) so agency costs
 * and dues convert at the ERA's GDP→₳ rate rather than the base config's
 * (refs #3778). Everything else in this suite is mocked at the collections
 * layer, so the db stub only has to answer that one read.
 */
const stubDb = () =>
  ({
    collection: () => ({ findOne: async () => ({ _id: "current", preset: "2019-default" }) }),
  }) as unknown as Db;

vi.mock("@/lib/db/collections", () => ({
  getOrganizationLeadershipCollection: vi.fn(),
  getOrganizationLeadershipElectionsCollection: vi.fn(),
  getOrganizationLegislationCollection: vi.fn(),
  getOrganizationMembershipsCollection: vi.fn(),
  getOrganizationProposalsCollection: vi.fn(),
  getOrganizationFundsCollection: vi.fn(),
}));

vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: vi.fn(),
  loadOrganizationDef: vi.fn(),
  recordOrgHistoryEvent: vi.fn(),
}));

// This suite tests the resolvers; autonomous voting (SP4) has its own suite.
// Stub it to a no-op so it doesn't consume the getMembers mock queue.
vi.mock("@/lib/nppAutonomy/autonomousOrgVoting", () => ({
  castAutonomousOrgVotes: vi.fn().mockResolvedValue(0),
}));

// Auto-founding has its own suite (internationalOrganizationsPhase.founding.test.ts).
// Return a legacy context (null year) so foundDueOrganizations no-ops against
// the bare `stubDb()` fixtures these tests use.
vi.mock("@/lib/internationalOrganizations/founding", () => ({
  loadOrgFoundingContext: vi.fn().mockResolvedValue({ liveYear: null, preset: "2019-default" }),
}));

vi.mock("@/lib/countryAccess", () => ({ getAllCountryAccess: vi.fn() }));
// The dues sweep resolves the world preset to decide whether an organisation
// levies tribute; these cases hand in a bare `{}` for the db.
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldPreset: vi.fn().mockResolvedValue("1953-default"),
  getGdpAnchorRate: vi.fn().mockReturnValue(1),
}));

// The two money paths are asserted through their own modules; the phase's
// contract here is which members it hands to which of them.
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

vi.mock("@/lib/internationalOrganizations/aid", () => ({
  payOrganizationAid: vi.fn().mockResolvedValue(false),
}));

// Admission writes memberships and clears withdrawal tombstones across three
// collections; the resolver's contract here is that it calls it, not how it writes.
vi.mock("@/lib/internationalOrganizations/joinApplication", () => ({
  admitMember: vi.fn(),
  resolveJoinApplication: vi.fn(),
}));

/**
 * Access table where every country is player-enabled except the ones named.
 * A proxy rather than a literal so the existing cases keep the voter sets they
 * were written against without listing every id they touch; `then` is excluded
 * so the record stays a plain value when a mock resolves it.
 */
function accessSilencing(...silent: string[]) {
  return new Proxy({} as Record<string, { enabledForPlayers: boolean }>, {
    get: (_target, key) =>
      typeof key === "string" && key !== "then" && !silent.includes(key)
        ? { enabledForPlayers: true }
        : undefined,
  });
}

/**
 * Empty stubs for every collection a test isn't exercising, so a case can set up
 * only the one resolver it cares about.
 */
function stubQuietCollections(
  collections: typeof import("@/lib/db/collections"),
  opts: { skipProposals?: boolean; skipElections?: boolean; skipLeadership?: boolean } = {}
) {
  const empty = () => ({
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  });
  if (!opts.skipProposals) {
    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      ...empty(),
      updateOne: vi.fn(),
    } as never);
  }
  vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
    ...empty(),
    updateOne: vi.fn(),
  } as never);
  vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
    ...empty(),
    updateOne: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  } as never);
  if (!opts.skipElections) {
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      ...empty(),
      updateOne: vi.fn(),
    } as never);
  }
  if (!opts.skipLeadership) {
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      ...empty(),
      updateOne: vi.fn(),
      findOne: vi.fn().mockResolvedValue(null),
    } as never);
  }
  vi.mocked(collections.getOrganizationFundsCollection).mockResolvedValue({
    ...empty(),
    updateOne: vi.fn(),
    findOne: vi.fn().mockResolvedValue(null),
  } as never);
}

describe("internationalOrganizationsPhase", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getAllCountryAccess } = await import("@/lib/countryAccess");
    // clearAllMocks drops the queued value but keeps implementations, so the
    // default has to be re-asserted here or it leaks from the previous test.
    vi.mocked(getAllCountryAccess).mockResolvedValue(accessSilencing() as never);
  });

  it("uses the latest vote per country when resolving proposals, legislation, and leadership elections", async () => {
    const proposalUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const legislationUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const electionUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const leadershipUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");

    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId("507f1f77bcf86cd799439081"),
            organizationId: "eu",
            proposingCountryId: "DE",
            status: "pending",
            closesOnTurn: 10,
            votes: [
              { countryId: "US", vote: "yes" },
              { countryId: "US", vote: "no" },
            ],
          },
        ]),
      }),
      updateOne: proposalUpdateOne,
    } as never);

    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      // The dues sweep lists all memberships; none here → no dues charged.
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);

    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      // First find() resolves expired pending legislation; the second (the
      // sanctions auto-expiry sweep) finds nothing.
      find: vi
        .fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId("507f1f77bcf86cd799439082"),
              organizationId: "eu",
              type: "free_trade_agreement",
              parties: ["US", "UK"],
              status: "pending",
              closesOnTurn: 10,
              votes: [
                { countryId: "US", vote: "yes" },
                { countryId: "US", vote: "no" },
                { countryId: "UK", vote: "yes" },
              ],
            },
          ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: legislationUpdateOne,
    } as never);

    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId("507f1f77bcf86cd799439083"),
            organizationId: "eu",
            candidateCharacterId: new ObjectId("507f1f77bcf86cd799439084"),
            candidateCharacterName: "Candidate",
            candidateCountryId: "US",
            status: "pending",
            closesOnTurn: 10,
            votes: [
              { countryId: "US", vote: "yes" },
              { countryId: "US", vote: "yes" },
              { countryId: "UK", vote: "no" },
            ],
          },
        ]),
      }),
      updateOne: electionUpdateOne,
    } as never);

    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: leadershipUpdateOne,
    } as never);

    // One roster for every resolver rather than a call-ordered queue: the
    // resolvers each load the roll a different number of times now that the
    // voting roll is derived from it, and this test is about vote de-duplication,
    // not about who is on which roll.
    vi.mocked(service.getMembers).mockResolvedValue(["US", "UK"]);
    vi.mocked(service.loadOrganizationDef).mockResolvedValue({
      leadership: { title: "Secretary-General", termTurns: 96 },
    } as never);

    const db = stubDb();
    const result = await processInternationalOrganizationsTurn(db, 10);

    expect(result).toEqual({
      organizationsFounded: 0,
      proposalsResolved: 1,
      legislationResolved: 1,
      electionsResolved: 1,
      sanctionsExpired: 0,
      directivesExpired: 0,
      jointStatementsExpired: 0,
      agencyFundingExpired: 0,
      duesCharged: 0,
      tributeCharged: 0,
      autonomousVotesCast: 0,
    });
    expect(proposalUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "rejected",
        }),
      })
    );
    expect(legislationUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "rejected",
        }),
      })
    );
    expect(leadershipUpdateOne).not.toHaveBeenCalled();
    expect(electionUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "rejected",
        }),
      })
    );
  });

  it("activates a passed directive with an expiry stamp + history note", async () => {
    const legislationUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");

    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      // call 1: pending resolve (the directive); calls 2 & 3: sanctions + directive expiry sweeps.
      find: vi
        .fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId("507f1f77bcf86cd799439091"),
              organizationId: "EU",
              type: "directive",
              directiveKey: "productivity_compact",
              parties: [],
              proposingCountryId: "DE",
              proposedByCharacterId: new ObjectId("507f1f77bcf86cd799439092"),
              status: "pending",
              closesOnTurn: 10,
              votes: [
                { countryId: "DE", vote: "yes" },
                { countryId: "IE", vote: "yes" },
              ],
            },
          ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: legislationUpdateOne,
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);
    vi.mocked(service.getMembers).mockResolvedValue(["DE", "IE"]);

    const result = await processInternationalOrganizationsTurn(stubDb(), 10);

    expect(result.legislationResolved).toBe(1);
    expect(legislationUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "active",
          directiveExpiresOnTurn: 106, // 10 + DIRECTIVE_DURATION_TURNS (96)
        }),
      })
    );
    expect(service.recordOrgHistoryEvent).toHaveBeenCalledWith(
      expect.anything(),
      "DE",
      10,
      expect.stringContaining("Productivity Compact"),
      expect.anything()
    );
  });

  it("auto-terminates directives whose term has elapsed", async () => {
    const legislationUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const collections = await import("@/lib/db/collections");

    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      // call 1: pending resolve → none; call 2: sanctions expiry → none;
      // call 3: directive expiry → one expired directive; call 4: joint-statement
      // expiry → none.
      find: vi
        .fn()
        .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({
          toArray: vi
            .fn()
            .mockResolvedValue([
              { _id: new ObjectId("507f1f77bcf86cd799439093"), directiveExpiresOnTurn: 5 },
            ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
      updateMany: legislationUpdateMany,
    } as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);

    const result = await processInternationalOrganizationsTurn(stubDb(), 10);

    expect(result.directivesExpired).toBe(1);
    expect(legislationUpdateMany).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ status: "terminated" }) })
    );
  });

  it("activates a passed joint statement with an expiry stamp + subject history note", async () => {
    const legislationUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");

    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      // call 1: pending resolve (the statement); calls 2-4: expiry sweeps → none.
      find: vi
        .fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId("507f1f77bcf86cd7994390b1"),
              organizationId: "UN",
              type: "joint_statement",
              jointStatementSubjectCountryId: "BR",
              jointStatementStance: "condemn",
              parties: [],
              proposingCountryId: "US",
              proposedByCharacterId: new ObjectId("507f1f77bcf86cd7994390b2"),
              status: "pending",
              closesOnTurn: 10,
              votes: [
                { countryId: "US", vote: "yes" },
                { countryId: "UK", vote: "yes" },
              ],
            },
          ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: legislationUpdateOne,
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);
    // UN founding members carry the veto; "US"/"UK" both vote yes (no veto fired).
    vi.mocked(service.getMembers).mockResolvedValue(["US", "UK"]);

    const result = await processInternationalOrganizationsTurn(stubDb(), 10);

    expect(result.legislationResolved).toBe(1);
    expect(legislationUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "active",
          jointStatementExpiresOnTurn: 34, // 10 + JOINT_STATEMENT_DURATION_TURNS (24)
        }),
      })
    );
    expect(service.recordOrgHistoryEvent).toHaveBeenCalledWith(
      expect.anything(),
      "BR",
      10,
      expect.stringContaining("condemned"),
      expect.anything()
    );
  });

  it("records an underfunded aid package for a non-country member without crashing", async () => {
    const legislationUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");
    const { getAllCountryAccess } = await import("@/lib/countryAccess");

    vi.mocked(getAllCountryAccess).mockResolvedValue(accessSilencing("JO") as never);
    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      find: vi
        .fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId("507f1f77bcf86cd7994390e1"),
              organizationId: "UN",
              type: "aid_package",
              aidRecipientCountryId: "JO",
              aidAmount: 1_000,
              parties: [],
              proposingCountryId: "US",
              proposedByCharacterId: new ObjectId("507f1f77bcf86cd7994390e2"),
              status: "pending",
              closesOnTurn: 10,
              votes: [{ countryId: "US", vote: "yes" }],
            },
          ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: legislationUpdateOne,
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);
    vi.mocked(service.getMembers).mockResolvedValue(["US", "JO"]);

    const result = await processInternationalOrganizationsTurn(stubDb(), 10);

    expect(result.legislationResolved).toBe(1);
    expect(service.recordOrgHistoryEvent).toHaveBeenCalledWith(
      expect.anything(),
      "JO",
      10,
      "UN aid to JO could not be disbursed — the fund was short.",
      expect.anything()
    );
  });

  it("funds a passed agency programme when the fund covers it", async () => {
    const legislationUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const fundUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 }); // fund covers cost
    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");

    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(collections.getOrganizationFundsCollection).mockResolvedValue({
      updateOne: fundUpdateOne,
    } as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      find: vi
        .fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId("507f1f77bcf86cd7994390c1"),
              organizationId: "UN",
              type: "fund_agency",
              agencyKey: "humanitarian_relief",
              parties: [],
              proposingCountryId: "US",
              proposedByCharacterId: new ObjectId("507f1f77bcf86cd7994390c2"),
              status: "pending",
              closesOnTurn: 10,
              votes: [
                { countryId: "US", vote: "yes" },
                { countryId: "UK", vote: "yes" },
              ],
            },
          ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: legislationUpdateOne,
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);
    vi.mocked(service.getMembers).mockResolvedValue(["US", "UK"]);

    const result = await processInternationalOrganizationsTurn(stubDb(), 10);

    expect(result.legislationResolved).toBe(1);
    // Active + expiry stamped at passage.
    expect(legislationUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "active",
          agencyExpiresOnTurn: 58, // 10 + AGENCY_FUNDING_DURATION_TURNS (48)
        }),
      })
    );
    // Cost drawn from the fund (guarded $gte update).
    expect(fundUpdateOne).toHaveBeenCalled();
    expect(service.recordOrgHistoryEvent).toHaveBeenCalledWith(
      expect.anything(),
      "US",
      10,
      expect.stringContaining("funded"),
      expect.anything()
    );
  });

  it("terminates a passed agency programme the fund can't cover", async () => {
    const legislationUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const fundUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 0 }); // underfunded
    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");

    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(collections.getOrganizationFundsCollection).mockResolvedValue({
      updateOne: fundUpdateOne,
    } as never);
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      find: vi
        .fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: new ObjectId("507f1f77bcf86cd7994390d1"),
              organizationId: "UN",
              type: "fund_agency",
              agencyKey: "humanitarian_relief",
              parties: [],
              proposingCountryId: "US",
              proposedByCharacterId: new ObjectId("507f1f77bcf86cd7994390d2"),
              status: "pending",
              closesOnTurn: 10,
              votes: [{ countryId: "US", vote: "yes" }],
            },
          ]),
        })
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: legislationUpdateOne,
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      updateOne: vi.fn(),
    } as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: vi.fn(),
    } as never);
    vi.mocked(service.getMembers).mockResolvedValue(["US"]);

    await processInternationalOrganizationsTurn(stubDb(), 10);

    // Passage set it active, then the underfunded effect flipped it to terminated.
    expect(legislationUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ status: "terminated" }) })
    );
    expect(service.recordOrgHistoryEvent).toHaveBeenCalledWith(
      expect.anything(),
      "US",
      10,
      expect.stringContaining("could not fund"),
      expect.anything()
    );
  });
  it("admits over a non-voting member's silence", async () => {
    // JO is a member but not player-enabled, so it holds no vote to withhold.
    // Before the voting roll existed its silence sank every admission.
    const proposalUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");
    const join = await import("@/lib/internationalOrganizations/joinApplication");
    const { getAllCountryAccess } = await import("@/lib/countryAccess");

    vi.mocked(getAllCountryAccess).mockResolvedValue(accessSilencing("JO") as never);
    vi.mocked(service.getMembers).mockResolvedValue(["US", "JO"]);

    vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId("507f1f77bcf86cd7994390a1"),
            organizationId: "nato",
            proposingCountryId: "FR",
            status: "pending",
            closesOnTurn: 10,
            votes: [{ countryId: "US", vote: "yes" }],
          },
        ]),
      }),
      updateOne: proposalUpdateOne,
    } as never);
    stubQuietCollections(collections, { skipProposals: true });

    const result = await processInternationalOrganizationsTurn({} as Db, 10);

    expect(result.proposalsResolved).toBe(1);
    expect(join.admitMember).toHaveBeenCalledWith(expect.anything(), "nato", "FR", 10);
    expect(proposalUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ status: "approved" }) })
    );
  });

  it("ignores a non-voting member's ballot in a leadership election", async () => {
    // A 1-1 tie would leave the seat unchanged; JO's "no" is not a vote at all,
    // so the election reads 1-0 and elects.
    const leadershipUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const electionUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const collections = await import("@/lib/db/collections");
    const service = await import("@/lib/internationalOrganizations/service");
    const { getAllCountryAccess } = await import("@/lib/countryAccess");

    vi.mocked(getAllCountryAccess).mockResolvedValue(accessSilencing("JO") as never);
    vi.mocked(service.getMembers).mockResolvedValue(["US", "JO"]);
    vi.mocked(service.loadOrganizationDef).mockResolvedValue({
      leadership: { title: "Secretary-General", termTurns: 96 },
    } as never);

    vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId("507f1f77bcf86cd7994390a2"),
            organizationId: "nato",
            status: "pending",
            closesOnTurn: 10,
            candidateCharacterId: "c1",
            candidateCharacterName: "Candidate",
            candidateCountryId: "US",
            votes: [
              { countryId: "US", vote: "yes" },
              { countryId: "JO", vote: "no" },
            ],
          },
        ]),
      }),
      updateOne: electionUpdateOne,
    } as never);
    vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
      updateOne: leadershipUpdateOne,
    } as never);
    stubQuietCollections(collections, { skipElections: true, skipLeadership: true });

    const result = await processInternationalOrganizationsTurn({} as Db, 10);

    expect(result.electionsResolved).toBe(1);
    expect(electionUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ status: "elected" }) })
    );
  });
  it("bills voting members dues and leaves everyone else to tribute", async () => {
    const collections = await import("@/lib/db/collections");
    const fund = await import("@/lib/internationalOrganizations/organizationFund");
    const tribute = await import("@/lib/internationalOrganizations/tribute");
    const { getAllCountryAccess } = await import("@/lib/countryAccess");

    vi.mocked(getAllCountryAccess).mockResolvedValue(accessSilencing("JO", "TR") as never);
    vi.mocked(fund.chargeOrganizationDues).mockResolvedValue(0);
    vi.mocked(tribute.chargeOrganizationTribute).mockResolvedValue({
      collectedLocal: 0,
      payers: 0,
      minted: 0,
    });

    stubQuietCollections(collections);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { organizationId: "NATO", countryId: "US" },
          { organizationId: "NATO", countryId: "TR" },
          { organizationId: "NATO", countryId: "JO" },
        ]),
      }),
    } as never);

    await processInternationalOrganizationsTurn({} as Db, 10);

    // Dues see only the enabled member — TR and JO are never in this list.
    expect(fund.chargeOrganizationDues).toHaveBeenCalledWith(expect.anything(), "NATO", [
      expect.objectContaining({ countryId: "US" }),
    ]);
    // Tribute is asked for the same org exactly once, and picks its own payers
    // from the access table it is handed.
    expect(tribute.chargeOrganizationTribute).toHaveBeenCalledTimes(1);
    expect(tribute.chargeOrganizationTribute).toHaveBeenCalledWith(
      expect.anything(),
      "NATO",
      expect.anything()
    );
  });

  it("still collects tribute from an organisation whose members all lack a vote", async () => {
    // Without this the sweep would skip the org entirely for having no dues
    // payers, and a bloc of pure client states would fund nothing.
    const collections = await import("@/lib/db/collections");
    const fund = await import("@/lib/internationalOrganizations/organizationFund");
    const tribute = await import("@/lib/internationalOrganizations/tribute");
    const { getAllCountryAccess } = await import("@/lib/countryAccess");

    vi.mocked(getAllCountryAccess).mockResolvedValue(accessSilencing("JO") as never);
    vi.mocked(fund.chargeOrganizationDues).mockResolvedValue(0);
    vi.mocked(tribute.chargeOrganizationTribute).mockResolvedValue({
      collectedLocal: 500,
      payers: 1,
      minted: 500,
    });

    stubQuietCollections(collections);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ organizationId: "NATO", countryId: "JO" }]),
      }),
    } as never);

    const result = await processInternationalOrganizationsTurn({} as Db, 10);

    expect(fund.chargeOrganizationDues).not.toHaveBeenCalled();
    expect(result.tributeCharged).toBe(1);
    expect(result.duesCharged).toBe(0);
  });

  /**
   * Ticket #1156. Tribute exists only for the two armed blocs, so in every
   * other organisation the non-voting members were assessed nothing at all and
   * sat on the roll for free. Players saw them as members who never pay dues.
   */
  it("bills a non-voting member dues when its organisation levies no tribute", async () => {
    const collections = await import("@/lib/db/collections");
    const fund = await import("@/lib/internationalOrganizations/organizationFund");
    const tribute = await import("@/lib/internationalOrganizations/tribute");
    const { getAllCountryAccess } = await import("@/lib/countryAccess");

    vi.mocked(getAllCountryAccess).mockResolvedValue(accessSilencing("JO") as never);
    vi.mocked(fund.chargeOrganizationDues).mockResolvedValue(0);
    vi.mocked(tribute.chargeOrganizationTribute).mockResolvedValue({
      collectedLocal: 0,
      payers: 0,
      minted: 0,
    });

    stubQuietCollections(collections);
    vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { organizationId: "UN", countryId: "US" },
          { organizationId: "UN", countryId: "JO" },
        ]),
      }),
    } as never);

    await processInternationalOrganizationsTurn({} as Db, 10);

    // The UN levies no tribute, so BOTH members are assessed dues.
    expect(fund.chargeOrganizationDues).toHaveBeenCalledWith(
      expect.anything(),
      "UN",
      expect.arrayContaining([
        expect.objectContaining({ countryId: "US" }),
        expect.objectContaining({ countryId: "JO" }),
      ])
    );
  });
});
