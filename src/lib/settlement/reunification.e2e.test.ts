/**
 * The reunification pipeline end to end, with the real functions wired together.
 *
 * Every other test in this feature mocks its neighbours, which proves each piece
 * in isolation and proves nothing about whether they COMPOSE. The defects this
 * work exists to fix are all seam defects -- a party id reinterpreted because two
 * steps ran in the wrong order, an official stranded because the sweep that would
 * have carried them matches on a field they do not have -- so the composition is
 * the part worth asserting.
 *
 * Only the leaf side effects are stubbed: bloc membership, history writes and the
 * election spawners, which reach out to subsystems this pipeline does not own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
// Returns a promise: `installOnePartyState` chains `.catch()` onto it.
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("1953-default"),
}));
vi.mock("@/lib/world/blocMembership", () => ({ blocOrgFor: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/joinApplication", () => ({ admitMember: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/service", () => ({ isMember: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/withdrawalBills", () => ({
  removeOrganizationMembership: vi.fn(),
}));
vi.mock("@/lib/turn/regimeEscalationTurn", () => ({ ensureInitialEscalationState: vi.fn() }));
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn(),
  updateCountryState: vi.fn(),
}));
vi.mock("@/lib/db/sequentialId", () => ({
  reserveSequentialIds: vi.fn(),
  realignPartyCountersToExisting: vi.fn(),
}));
// The country merge's own region machinery is exercised by its own suite; here
// the interest is the pipeline around it.
vi.mock("@/lib/country/mergeCountry", () => ({ mergeCountry: vi.fn() }));

const CRISIS_ID = new ObjectId();
const CHAIRMAN = new ObjectId();
const SED_DOC = new ObjectId();
const CDU_DOC = new ObjectId();

function cursorOf<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    project: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}

function crisis(): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "resolved",
    outcome: "challenger",
    targetEntityId: "DE",
    challengerEntityId: "DD",
    cooldownUntilTurn: null,
  } as SettlementCrisisDoc;
}

describe("reunification pipeline, end to end", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });

    // East Germany's five parties, SED first.
    db.collection("politicalParties").find.mockImplementation((f: Record<string, unknown>) =>
      f.countryId === "DD"
        ? cursorOf([
            { _id: SED_DOC, countryId: "DD", sequentialId: 1, abbreviation: "SED" },
            { _id: CDU_DOC, countryId: "DD", sequentialId: 2, abbreviation: "CDU" },
          ])
        : cursorOf([
            { _id: SED_DOC, countryId: "DE", sequentialId: 7, abbreviation: "SED" },
            { _id: CDU_DOC, countryId: "DE", sequentialId: 8, abbreviation: "CDU" },
          ])
    );
    db.collection("politicalParties").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("politicalParties").updateMany.mockResolvedValue({ modifiedCount: 1 });

    const { reserveSequentialIds } = await import("@/lib/db/sequentialId");
    vi.mocked(reserveSequentialIds).mockResolvedValue([7, 8]);

    const { getCountryState, updateCountryState } = await import("@/lib/countryState");
    // The SED rules East Germany as sequentialId 1. Germany's own governing
    // party is ALSO "1" (the SPD) -- the collision the pipeline must not fall into.
    vi.mocked(getCountryState).mockResolvedValue({
      governmentType: "onePartyState",
      rulingPartyId: 1,
    } as never);
    vi.mocked(updateCountryState).mockResolvedValue({} as never);

    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    vi.mocked(mergeCountry).mockResolvedValue({
      ok: true,
      regionsTransferred: 6,
      regionsSkipped: 0,
      retired: true,
    });

    // A national office with no region: invisible to the per-region sweep.
    db.collection("electedOfficials").find.mockReturnValue(
      cursorOf([{ _id: CHAIRMAN, officeType: "chairmanOfStateCouncil", party: "7" }])
    );
    db.collection("electedOfficials").updateOne.mockResolvedValue({ modifiedCount: 1 });

    // Berlin fuses; both halves are German by the time it runs.
    db.collection("states").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "BEO"
        ? { _id: "BEO", countryId: "DE", population: 1200, houseDistricts: 4 }
        : { _id: "BE", countryId: "DE", population: 2200, houseDistricts: 12 }
    );
    db.collection("states").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("states").updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collection("seats").findOne.mockResolvedValue(null);
    db.collection("legislationTypes").updateMany.mockResolvedValue({ modifiedCount: 115 });

    const { blocOrgFor } = await import("@/lib/world/blocMembership");
    vi.mocked(blocOrgFor).mockImplementation((_p, bloc) =>
      bloc === "east" ? "WARSAW_PACT" : "NATO"
    );
    const { isMember } = await import("@/lib/internationalOrganizations/service");
    vi.mocked(isMember).mockResolvedValue(true);
  });

  it("completes and reports a reunification", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    expect(res).toEqual({ actuated: true, outcome: "challenger", deferred: false });
  });

  it("renumbers the eastern parties instead of colliding with the western ones", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    const moves = db.collectionMocks["politicalParties"].updateOne.mock.calls;
    const sed = moves.find((c) => String(c[0]._id) === String(SED_DOC));
    expect(sed?.[1].$set.countryId).toBe("DE");
    expect(sed?.[1].$set.sequentialId).toBe(7);
    expect(sed?.[1].$set.mergedFrom).toMatchObject({ countryId: "DD", sequentialId: 1 });
  });

  it("rules with the eastern party and bans the western ones", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    const writes = db.collectionMocks["politicalParties"].updateMany.mock.calls;
    const ruling = writes.find((c) => c[1].$set?.regimeStatus === "ruling");
    const banned = writes.find((c) => c[1].$set?.regimeStatus === "banned");
    // 7 is the SED's number after migration -- NOT 1, which is the SPD in Germany.
    expect(ruling?.[0].sequentialId).toBe(7);
    expect(banned?.[0].sequentialId.$ne).toBe(7);
  });

  it("retires the national office the region sweep cannot see", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    expect(db.collectionMocks["electedOfficials"].deleteOne).toHaveBeenCalledWith({
      _id: CHAIRMAN,
    });
  });

  it("does not schedule a post-conversion election", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    const { updateCountryState } = await import("@/lib/countryState");
    // Every other conversion route schedules one. Reunification must not: a snap
    // would dissolve the chamber this pipeline exists to preserve. If this test
    // fails because someone "fixed" the omission, read decision 4 in the spec.
    const scheduled = vi
      .mocked(updateCountryState)
      .mock.calls.some((c) => (c[2] as Record<string, unknown>)?.pendingPostConversionElection);
    expect(scheduled).toBe(false);
  });

  it("hands the eastern law catalogue to the surviving country", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    const call = db.collectionMocks["legislationTypes"].updateMany.mock.calls[0];
    expect(call?.[0]).toEqual({ countryScope: "dd" });
    expect(call?.[1].$set.countryScope).toBe("de");
  });

  it("fuses East Berlin into Berlin and removes it from the map", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    const absorb = db.collectionMocks["states"].updateOne.mock.calls.find((c) => c[0]._id === "BE");
    expect(absorb?.[1].$inc).toMatchObject({ population: 1200 });
    // Deleted rather than flagged: nothing filters `states` on a dissolved
    // marker, so a flagged region would keep being counted as its own Land.
    expect(db.collectionMocks["states"].deleteOne).toHaveBeenCalledWith({ _id: "BEO" });
  });

  it("assumes the east's treasury, bonds and national law book", async () => {
    db.collection("federalBudget").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "DD"
        ? { _id: "DD", treasuryBalance: -1000, debt: { principal: 1000 }, economicFactors: {} }
        : { _id: "DE", treasuryBalance: 5000, debt: { principal: 0 }, economicFactors: {} }
    );
    const bondId = new ObjectId();
    const lawId = new ObjectId();
    db.collection("bonds").find.mockReturnValue(
      cursorOf([
        {
          _id: bondId,
          issuerType: "sovereign",
          countryId: "DD",
          totalIssued: 500,
          publicFloat: 1,
          holders: [{ characterId: new ObjectId(), units: 2 }],
          matured: false,
        },
      ])
    );
    db.collection("enactedLaws").find.mockReturnValue(
      cursorOf([{ _id: lawId, countryId: "DD", scope: "national", annualRevenueV2: 215 }])
    );

    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);

    // Forex is off in this harness, so the scale is 1 and the signed sum is plain.
    const budgetWrites = db.collectionMocks["federalBudget"].updateOne.mock.calls;
    const deWrite = budgetWrites.find(
      (c) => c[0]._id === "DE" && c[1].$set?.treasuryBalance != null
    );
    expect(deWrite?.[1].$set.treasuryBalance).toBe(4000);
    const ddWrite = budgetWrites.find((c) => c[0]._id === "DD" && c[1].$set?.mergedInto);
    expect(ddWrite?.[1].$set.treasuryBalance).toBe(0);
    const bondWrite = db.collectionMocks["bonds"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(bondId)
    );
    expect(bondWrite?.[1].$set.countryId).toBe("DE");
    const lawWrite = db.collectionMocks["enactedLaws"].updateOne.mock.calls.find(
      (c) => String(c[0]._id) === String(lawId)
    );
    expect(lawWrite?.[1].$set.countryId).toBe("DE");
  });

  it("carries the east's military into the unified state", async () => {
    db.collection("militaryUnits").updateMany.mockResolvedValue({ modifiedCount: 11 });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    const [filter, update] = db.collectionMocks["militaryUnits"].updateMany.mock.calls[0];
    expect(filter).toEqual({ countryId: "DD" });
    expect(update.$set.countryId).toBe("DE");
  });

  it("carries the command-economy dial onto the survivor", async () => {
    const { clearStoredMarketizationLevels, getStoredMarketizationLevel } =
      await import("@/lib/constants/commandEconomy");
    clearStoredMarketizationLevels();
    db.collection("federalBudget").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "DD"
        ? { _id: "DD", treasuryBalance: 0, economicFactors: { marketizationLevel: 0 } }
        : { _id: "DE", treasuryBalance: 0, economicFactors: {} }
    );

    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);

    const regimeWrite = db.collectionMocks["federalBudget"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DE" && c[1].$set?.["economicFactors.marketizationLevel"] != null
    );
    expect(regimeWrite?.[1].$set["economicFactors.marketizationLevel"]).toBe(0);
    expect(getStoredMarketizationLevel("DE")).toBe(0);
    clearStoredMarketizationLevels();
  });

  it("opens the unified state to players when the absorbed side was playable", async () => {
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "DD",
      enabledForPlayers: true,
      status: "active",
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);

    const writes = db.collectionMocks["countryGameStates"].updateOne.mock.calls;
    const deWrite = writes.find((c) => c[0]._id === "DE");
    expect(deWrite?.[1].$set).toMatchObject({ enabledForPlayers: true, status: "active" });
    const ddWrite = writes.find((c) => c[0]._id === "DD");
    expect(ddWrite?.[1].$set.status).toBe("disabled");
  });

  it("does not open an econ-only survivor when the absorbed side was not playable", async () => {
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "DD",
      enabledForPlayers: false,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);
    const deWrite = db.collectionMocks["countryGameStates"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    );
    expect(deWrite).toBeUndefined();
  });

  it("deletes the absorbed government formation row after carrying its head", async () => {
    const pm = new ObjectId();
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "DD",
      pmCharacterId: pm,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 470);

    const carried = db.collectionMocks["governmentFormations"].updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    );
    expect(String(carried?.[1].$set.pmCharacterId)).toBe(String(pm));
    expect(db.collectionMocks["governmentFormations"].deleteOne).toHaveBeenCalledWith({
      _id: "DD",
    });
  });

  it("stops before touching the world when the party migration fails", async () => {
    const { reserveSequentialIds } = await import("@/lib/db/sequentialId");
    vi.mocked(reserveSequentialIds).mockRejectedValue(new Error("counter unavailable"));
    const { actuateSettlementOutcome } = await import("./actuate");
    await expect(actuateSettlementOutcome(db as unknown as Db, crisis(), 470)).rejects.toThrow(
      "counter unavailable"
    );
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    expect(vi.mocked(mergeCountry)).not.toHaveBeenCalled();
  });
});
