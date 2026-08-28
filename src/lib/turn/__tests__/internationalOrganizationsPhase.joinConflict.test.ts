import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";

let policyMode: "shadow" | "active" = "shadow";
const nppHeadId = new ObjectId();
const stubDb = () =>
  ({
    collection: (name: string) => {
      if (name === "gameState") {
        return {
          findOne: async () => ({
            _id: "current",
            preset: "1953-default",
            nppForeignPolicyMode: policyMode,
          }),
        };
      }
      if (name === "governmentFormations") {
        const formation = {
          _id: "FR",
          countryId: "FR",
          status: "formed",
          pmNppId: nppHeadId,
        };
        return {
          find: () => ({ toArray: async () => [formation] }),
          findOne: async ({ _id }: { _id: string }) => (_id === "FR" ? formation : null),
        };
      }
      if (name === "npps") {
        return {
          findOne: async () => ({ _id: nppHeadId, name: "French NPP Premier", party: "1" }),
        };
      }
      return { findOne: async () => ({ _id: "current", preset: "1953-default" }) };
    },
  }) as unknown as Db;

const buildJoinConflictBill = vi.fn().mockResolvedValue(new ObjectId());
let conflict: ConflictDoc | null = null;
let roster: string[] = [];
const { headlessCountries } = vi.hoisted(() => ({ headlessCountries: new Set<string>() }));

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
vi.mock("@/lib/db/collections/conflicts", () => ({ getConflict: vi.fn(async () => conflict) }));
vi.mock("@/lib/internationalOrganizations/commands/buildJoinConflictBill", () => ({
  buildJoinConflictBill: (...args: unknown[]) => buildJoinConflictBill(...args),
}));
vi.mock("@/lib/internationalOrganizations/reconcileAutonomousWarEntry", () => ({
  reconcileAutonomousWarEntryBills: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(async () => new ObjectId()),
  getHeadOfGovernmentCharacter: vi.fn(async (_db: unknown, countryId: string) =>
    headlessCountries.has(countryId)
      ? null
      : {
          _id: new ObjectId(),
          name: "Head of Government",
        }
  ),
}));

const { processInternationalOrganizationsTurn } =
  await import("../internationalOrganizationsPhase");

const KOREA: ConflictDoc = {
  _id: "korea-1953",
  conflictId: 7,
  name: "Korean War",
  status: "active",
  sideA: { label: "United Nations Command", countries: ["KR"] },
  sideB: { label: "Korean People's Army", countries: ["KP"] },
} as unknown as ConflictDoc;

/** Every country is player-enabled except the ones named. */
function accessSilencing(...silent: string[]) {
  return new Proxy({} as Record<string, { enabledForPlayers: boolean }>, {
    get: (_t, key) =>
      typeof key === "string" && key !== "then" && !silent.includes(key)
        ? { enabledForPlayers: true }
        : undefined,
  });
}

async function runPhase() {
  const collections = await import("@/lib/db/collections");
  const empty = () => ({
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  });

  vi.mocked(collections.getOrganizationProposalsCollection).mockResolvedValue({
    ...empty(),
    updateOne: vi.fn(),
  } as never);
  vi.mocked(collections.getOrganizationMembershipsCollection).mockResolvedValue({
    ...empty(),
    updateOne: vi.fn(),
  } as never);
  vi.mocked(collections.getOrganizationLeadershipElectionsCollection).mockResolvedValue({
    ...empty(),
    updateOne: vi.fn(),
  } as never);
  vi.mocked(collections.getOrganizationLeadershipCollection).mockResolvedValue({
    updateOne: vi.fn(),
  } as never);
  vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
    find: vi
      .fn()
      .mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId("507f1f77bcf86cd799439091"),
            organizationId: "NATO",
            type: "join_conflict",
            joinConflictTheaterId: "korea-1953",
            joinConflictSide: "A",
            parties: [],
            proposingCountryId: "US",
            proposedByCharacterId: new ObjectId("507f1f77bcf86cd799439092"),
            status: "pending",
            closesOnTurn: 10,
            // Unanimous among the voting members, so the resolution passes.
            votes: roster.map((countryId) => ({ countryId, vote: "yes" })),
          },
        ]),
      })
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  } as never);

  return processInternationalOrganizationsTurn(stubDb(), 10);
}

const billedCountries = () =>
  buildJoinConflictBill.mock.calls.map((c) => (c[0] as { countryId: string }).countryId);

describe("join_conflict enactment", () => {
  beforeEach(async () => {
    buildJoinConflictBill.mockClear();
    conflict = KOREA;
    roster = ["US", "UK"];
    policyMode = "shadow";
    headlessCountries.clear();
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing() as never);
    const service = await import("@/lib/internationalOrganizations/service");
    vi.mocked(service.recordOrgHistoryEvent).mockClear();
  });

  it("spawns a bill for the United States", async () => {
    // ⚠️ The discriminating case. COUNTRY_BILL_PHASES has no US key, so a bare
    // table lookup skips the feature's most important belligerent — and the
    // France assertion below passes anyway.
    await runPhase();
    expect(billedCountries()).toContain("US");
  });

  it("spawns one bill per player-enabled member with a lifecycle", async () => {
    roster = ["US", "UK"];
    await runPhase();
    expect(billedCountries().sort()).toEqual(["UK", "US"]);
  });

  it("spawns NO bill for a member that is not player-enabled", async () => {
    // Effects reach every modelled member, but only voting members are asked to
    // legislate — a client state has no legislature to put this to.
    roster = ["US", "UK"];
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("UK") as never);

    await runPhase();
    expect(billedCountries()).toEqual(["US"]);
  });

  it("lets a formed autonomous government vote and ratify war entry in active mode", async () => {
    policyMode = "active";
    roster = ["US", "FR"];
    headlessCountries.add("FR");
    const access = await import("@/lib/countryAccess");
    vi.mocked(access.getAllCountryAccess).mockResolvedValue(accessSilencing("FR") as never);

    await runPhase();

    expect(billedCountries()).toEqual(["US", "FR"]);
    const france = buildJoinConflictBill.mock.calls.find(
      (call) => (call[0] as { countryId: string }).countryId === "FR"
    )?.[0] as {
      sponsor: { characterId: ObjectId; characterName: string; party?: string; isNpp: boolean };
    };
    expect(france.sponsor).toEqual({
      characterId: nppHeadId,
      characterName: "French NPP Premier",
      party: "1",
      isNpp: true,
    });
  });

  it("spawns a bill for France now that its national lifecycle is available", async () => {
    roster = ["US", "FR"];
    await runPhase();
    expect(billedCountries()).toEqual(["US", "FR"]);
  });

  it("skips a member already fighting on the chosen side", async () => {
    conflict = {
      ...KOREA,
      sideA: { label: "United Nations Command", countries: ["KR", "UK"] },
    } as ConflictDoc;
    roster = ["US", "UK"];

    await runPhase();
    expect(billedCountries()).toEqual(["US"]);
  });

  it("skips and logs a member fighting on the OPPOSING side", async () => {
    // A bloc resolution never switches a country's side mid-war.
    conflict = {
      ...KOREA,
      sideB: { label: "Korean People's Army", countries: ["KP", "UK"] },
    } as ConflictDoc;
    roster = ["US", "UK"];

    await runPhase();
    expect(billedCountries()).toEqual(["US"]);

    const service = await import("@/lib/internationalOrganizations/service");
    const logged = vi
      .mocked(service.recordOrgHistoryEvent)
      .mock.calls.some((c) => String(c[3]).includes("other side"));
    expect(logged).toBe(true);
  });

  it("is a no-op when the conflict resolved during the voting window", async () => {
    conflict = { ...KOREA, status: "resolved" } as ConflictDoc;
    await runPhase();
    expect(buildJoinConflictBill).not.toHaveBeenCalled();
  });

  it("is a no-op when the conflict has vanished entirely", async () => {
    conflict = null;
    await runPhase();
    expect(buildJoinConflictBill).not.toHaveBeenCalled();
  });
});
