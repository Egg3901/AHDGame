import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

/**
 * Ticket-1257 regression: countries applying to join the Warsaw Pact never
 * actually joined. In active foreign-policy mode the resolver counts modelled
 * members with formed NPP governments as voters (policyVotingMembers), but the
 * active-mode planner takes ONE action per six-hour Tier-1 slot — a pending
 * membership vote can be starved out of every 24-turn window — and an
 * alignment-accession applicant that is a macro entity (North Korea, North
 * Vietnam, Iran) never enters the planner's opinion set at all, so nobody ever
 * casts its ballot. One silent voter then vetoes every admission forever, and
 * the alignment loop re-files the application the moment it expires.
 *
 * The close-time ballot fills that silence: as a proposal's window closes, an
 * autonomy-active member of the voting roll that has not yet cast casts the
 * cooperative ballot. Player-enabled members are still never voted for — a
 * human's withheld vote stays a nay.
 */

const stubDb = () =>
  ({
    collection: (name: string) => {
      if (name === "governmentFormations") {
        return {
          find: () => ({
            toArray: async () =>
              [...nppHeaded].map((countryId) => ({
                _id: countryId,
                countryId,
                status: "formed",
                pmNppId: nppHeadId,
              })),
          }),
          findOne: async ({ _id }: { _id: string }) =>
            nppHeaded.has(_id)
              ? { _id, countryId: _id, status: "formed", pmNppId: nppHeadId }
              : null,
        };
      }
      if (name === "npps") {
        return {
          findOne: async () => ({ _id: nppHeadId, name: "Governing NPP" }),
        };
      }
      return {
        findOne: async () => ({
          _id: "current",
          preset: "1953-default",
          nppForeignPolicyMode: "active",
        }),
      };
    },
  }) as unknown as Db;

let roster: string[] = [];
const nppHeadId = new ObjectId("507f1f77bcf86cd799439093");
const nppHeaded = new Set<string>();

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
vi.mock("@/lib/nppAutonomy/featureFlag", () => ({
  isNppAutonomyActive: vi.fn(async (_db: unknown, countryId: string) => nppHeaded.has(countryId)),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(async () => new ObjectId()),
  getHeadOfGovernmentCharacter: vi.fn(async () => null),
}));

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

/**
 * Runs the phase with one pending admission for `applicant` at its close turn.
 * `nppGoverned` names the members whose government is a formed NPP (so the
 * roll adds them in active mode and the close-time ballot speaks for them);
 * every other member is player-enabled.
 */
async function runProposal(params: {
  applicant: string;
  roster: string[];
  nppGoverned: string[];
  votes: { countryId: string; vote: "yes" | "no" | "abstain" }[];
}) {
  roster = params.roster;
  nppHeaded.clear();
  for (const c of params.nppGoverned) nppHeaded.add(c);

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

  // updateOne serves both the resolver's status writes and the close-time
  // vote upserts; a real Mongo updateOne reports what it matched.
  const proposalUpdate = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const proposalDoc = {
    _id: PROPOSAL_ID,
    organizationId: "WARSAW_PACT",
    proposingCountryId: params.applicant,
    status: "pending",
    closesOnTurn: 10,
    votes: params.votes,
  };
  const proposalsCol = {
    find: vi
      .fn()
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([proposalDoc]) })
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: proposalUpdate,
  };
  vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue(
    proposalsCol as never
  );

  await processInternationalOrganizationsTurn(stubDb(), 10);

  // The close-time ballot upserts land on updateOne before the status write,
  // so find the resolver's terminal write rather than assuming call order.
  const statusCall = proposalUpdate.mock.calls.find(
    (call) => (call[1] as { $set?: { status?: string } } | undefined)?.$set?.status != null
  );
  const status = statusCall?.[1]?.$set?.status as string | undefined;
  return { admitted: admitMember.mock.calls.length > 0, status };
}

describe("membership proposal resolution with silent autonomous voters (ticket-1257)", () => {
  beforeEach(async () => {
    admitMember.mockClear();
    roster = ["RU", "DD"];
    nppHeaded.clear();
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing() as never);
  });

  it("admits when a formed-NPP member that never voted is filled in at close", async () => {
    // The live shape of the bug: RU (player) voted yes, PL (formed NPP gov,
    // not open to players) never reached the vote in its Tier-1 slots. The
    // close-time ballot speaks for PL, unanimity is met, and the applicant
    // joins instead of cycling forever.
    const { admitted, status } = await runProposal({
      applicant: "CN",
      roster: ["RU", "PL"],
      nppGoverned: ["PL"],
      votes: [{ countryId: "RU", vote: "yes" }],
    });
    expect(admitted).toBe(true);
    expect(status).toBe("approved");
  });

  it("admits a macro-entity applicant whose ballot can never enter the planner", async () => {
    // North Korea / North Vietnam / Iran are world entities: no country config,
    // no foreign-affairs seat, so the planner generates no opinion for them and
    // no vote candidate — ever. Only the close-time ballot can cast PL's.
    const { admitted, status } = await runProposal({
      applicant: "NVN",
      roster: ["RU", "PL"],
      nppGoverned: ["PL"],
      votes: [{ countryId: "RU", vote: "yes" }],
    });
    expect(admitted).toBe(true);
    expect(status).toBe("approved");
  });

  it("still rejects when the silent member is a player country", async () => {
    // A player-enabled member's silence is its own decision. The safety net
    // never speaks for a human, so unanimity fails as before.
    const { admitted, status } = await runProposal({
      applicant: "CN",
      roster: ["RU", "PL"],
      nppGoverned: [],
      votes: [{ countryId: "RU", vote: "yes" }],
    });
    expect(admitted).toBe(false);
    expect(status).toBe("rejected");
  });

  it("never casts the applicant's own ballot", async () => {
    // An autonomy-active APPLICANT must not vote on its own accession: the
    // unanimous consent it needs is other members'. PL is both the applicant
    // and on the modelled roll (before the proposer filter), so this pins the
    // applicantOf guard: RU and BG both vote yes and carry it on their own
    // consent, while the recorded votes never include PL's.
    const { admitted, status } = await runProposal({
      applicant: "PL",
      roster: ["RU", "PL", "BG"],
      nppGoverned: ["PL", "BG"],
      votes: [{ countryId: "RU", vote: "yes" }],
    });
    expect(admitted).toBe(true);
    expect(status).toBe("approved");
  });

  it("rejects when a silent autonomous member has no government to speak for it", async () => {
    // A formed-NPP roll seat whose government doc has gone missing is a silent
    // voter again: no head to identify, no ballot. Unanimity fails.
    const { admitted, status } = await runProposal({
      applicant: "CN",
      roster: ["RU", "BG"],
      nppGoverned: [],
      votes: [{ countryId: "RU", vote: "yes" }],
    });
    expect(admitted).toBe(false);
    expect(status).toBe("rejected");
  });
});
