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

const FTA_ID = new ObjectId("507f1f77bcf86cd7994390c1");

/** Runs the phase with one expired FTA between `parties` carrying `votes`. */
async function runFta(
  parties: string[],
  votes: { countryId: string; vote: "yes" | "no" | "abstain" }[],
  db: Db
) {
  const collections = await import("@/lib/db/collections");
  const empty = () => ({
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  });
  vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue(empty() as never);
  vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue(empty() as never);
  vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue(
    empty() as never
  );
  vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
    updateOne: vi.fn(),
  } as never);

  const legislationUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
    find: vi
      .fn()
      .mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: FTA_ID,
            organizationId: "COMECON",
            type: "free_trade_agreement",
            parties,
            proposingCountryId: parties[0],
            status: "pending",
            closesOnTurn: 10,
            votes,
          },
        ]),
      })
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: legislationUpdate,
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  } as never);

  await processInternationalOrganizationsTurn(db, 10);
  return legislationUpdate.mock.calls[0]?.[1]?.$set?.status as string | undefined;
}

/**
 * An FTA is the one unanimous ballot whose voters are its own PARTIES, each
 * deciding its own agreement rather than consenting to someone else's. So it
 * keeps the wider roll that admissions and war entry are narrowed away from
 * (ticket #1257) — narrow it the same way and an agreement between two modelled
 * neighbours has no voters at all and can never ratify, which is what Comecon
 * was carrying two of.
 */
describe("free trade agreement roll", () => {
  beforeEach(async () => {
    roster = ["RU", "HU", "CS"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing() as never);
  });

  it("ratifies an agreement between two members their own governments run", async () => {
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("HU", "CS") as never);

    const status = await runFta(
      ["HU", "CS"],
      [
        { countryId: "HU", vote: "yes" },
        { countryId: "CS", vote: "yes" },
      ],
      stubDb("active", ["HU", "CS"])
    );

    expect(status).toBe("active");
  });

  it("still refuses one when a party its government runs has not voted", async () => {
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("HU", "CS") as never);

    const status = await runFta(
      ["HU", "CS"],
      [{ countryId: "HU", vote: "yes" }],
      stubDb("active", ["HU", "CS"])
    );

    expect(status).toBe("rejected");
  });

  it("drops a party that holds no ballot of any kind rather than waiting on it", async () => {
    // A macro-tier party is bound by the agreement but has no government to cast
    // a ballot, so it must not be able to deadlock the ratification.
    roster = ["RU", "HU", "JO"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("HU", "JO") as never);

    const status = await runFta(
      ["HU", "JO"],
      [{ countryId: "HU", vote: "yes" }],
      stubDb("active", ["HU"])
    );

    expect(status).toBe("active");
  });
});
