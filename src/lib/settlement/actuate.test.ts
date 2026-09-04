import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { SETTLEMENT_REOPEN_COOLDOWN_TURNS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({ recordCountryEvent: vi.fn() }));
vi.mock("@/lib/country/mergeCountry", () => ({ mergeCountry: vi.fn() }));
vi.mock("@/lib/countryState", () => ({ getCountryState: vi.fn(), updateCountryState: vi.fn() }));
vi.mock("@/lib/db/collections/countryState", () => ({ getCountryStateCollection: vi.fn() }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("1953-default"),
}));
vi.mock("@/lib/world/blocMembership", () => ({ blocOrgFor: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/joinApplication", () => ({ admitMember: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/service", () => ({ isMember: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/withdrawalBills", () => ({
  removeOrganizationMembership: vi.fn(),
}));
vi.mock("@/lib/country/mergePartiesIntoCountry", () => ({
  mergePartiesIntoCountry: vi.fn(),
}));
vi.mock("@/lib/country/mergeRegion", () => ({ mergeRegion: vi.fn() }));
vi.mock("@/lib/country/rescopeLegislationCatalogue", () => ({
  rescopeLegislationCatalogue: vi.fn(),
}));
vi.mock("@/lib/onePartyState/installOnePartyState", () => ({
  installOnePartyState: vi.fn(),
}));
vi.mock("@/lib/turn/rulingPartyConfidence", () => ({
  adjustLeaderConfidence: vi.fn(async () => undefined),
  REUNIFICATION_BUMP: 10,
}));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "resolved",
    outcome: "incumbent",
    targetEntityId: "DE",
    challengerEntityId: "DD",
    cooldownUntilTurn: null,
    ...over,
  } as SettlementCrisisDoc;
}

describe("actuateSettlementOutcome", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });

    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    vi.mocked(mergeCountry).mockResolvedValue({
      ok: true,
      regionsTransferred: 6,
      regionsSkipped: 0,
      retired: true,
    });
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({ governmentType: "onePartyState" } as never);
    const { getCountryStateCollection } = await import("@/lib/db/collections/countryState");
    vi.mocked(getCountryStateCollection).mockReturnValue({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    } as never);
    const { blocOrgFor } = await import("@/lib/world/blocMembership");
    // Pole-aware, unlike a flat return: the two alliances have to be DIFFERENT
    // organisations for the withdrawal to be exercised at all.
    vi.mocked(blocOrgFor).mockImplementation((_preset, bloc) =>
      bloc === "east" ? "WARSAW_PACT" : "NATO"
    );
    const { isMember } = await import("@/lib/internationalOrganizations/service");
    vi.mocked(isMember).mockResolvedValue(true);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    vi.mocked(removeOrganizationMembership).mockResolvedValue(undefined);

    const { mergePartiesIntoCountry } = await import("@/lib/country/mergePartiesIntoCountry");
    vi.mocked(mergePartiesIntoCountry).mockResolvedValue({
      ok: true,
      partyIdMap: { "1": "7" },
      partiesMoved: 5,
      documentsRemapped: 120,
    });
    const { mergeRegion } = await import("@/lib/country/mergeRegion");
    vi.mocked(mergeRegion).mockResolvedValue({ ok: true, retired: true, documentsMoved: 9 });
    const { rescopeLegislationCatalogue } =
      await import("@/lib/country/rescopeLegislationCatalogue");
    vi.mocked(rescopeLegislationCatalogue).mockResolvedValue({ typesRescoped: 115 });
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    vi.mocked(installOnePartyState).mockResolvedValue(undefined);
    // East Germany's ruling party is sequentialId 1, the SED.
    vi.mocked(getCountryState).mockResolvedValue({
      governmentType: "onePartyState",
      rulingPartyId: 1,
    } as never);
  });

  it("ignores a crisis that has not resolved", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ status: "open", outcome: null }),
      412
    );
    expect(res.actuated).toBe(false);
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("ignores a crisis whose consequences have fully landed", async () => {
    // COMPLETION is the marker; without this check the history entries double.
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ actuationCompletedTurn: 500 }),
      412
    );
    expect(res.actuated).toBe(false);
  });

  it("RE-ENTERS a crisis that was claimed and never finished", async () => {
    // The regression that cost a live world: the cooldown was written as the
    // claim, so a merge that died halfway looked done to every sweep and nothing
    // ever finished it. A cooldown with no completion stamp must not stop this.
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ cooldownUntilTurn: 500, actuationCompletedTurn: null }),
      412
    );
    expect(res.actuated).toBe(true);
  });

  it("claims a LEASE first and writes the cooldown only once it is done", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 412);
    const calls = prime(db, "settlementCrises").updateOne.mock.calls;

    // The claim takes the lease and states no outcome.
    const [claimFilter, claimUpdate] = calls[0];
    expect(claimFilter).toMatchObject({ actuationCompletedTurn: null });
    expect(claimUpdate.$set.actuationClaimedAt).toBeInstanceOf(Date);
    expect(claimUpdate.$set.cooldownUntilTurn).toBeUndefined();

    // The cooldown and the completion stamp land together, at the end.
    const done = calls.find((c) => c[1]?.$set?.actuationCompletedTurn != null);
    expect(done).toBeDefined();
    expect(done![1].$set.cooldownUntilTurn).toBe(412 + SETTLEMENT_REOPEN_COOLDOWN_TURNS);
    expect(done![1].$set.actuationClaimedAt).toBeNull();
  });

  it("records the close against both Germanies on a Western win", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(db as unknown as Db, crisis(), 412);
    expect(res).toEqual({ actuated: true, outcome: "incumbent", deferred: false });
    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    const countries = vi.mocked(recordCountryEvent).mock.calls.map((c) => c[1].countryId);
    expect(countries.sort()).toEqual(["DD", "DE"]);
    expect(vi.mocked(recordCountryEvent).mock.calls[0][1].title).toContain("stays sovereign");
  });

  it("absorbs the Federal Republic into the surviving GDR on a reunification win", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ outcome: "challenger" }),
      412
    );
    expect(res).toEqual({ actuated: true, outcome: "challenger", deferred: false });
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    expect(vi.mocked(mergeCountry).mock.calls[0][1]).toEqual({
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
      // The winner is the shell, so the absorbed side does not keep its trade
      // policy on a scope both states legislated.
      absorbedTariffsWin: false,
    });
  });

  it("merges INTO the winner, never into the side that lost", async () => {
    // The shell that survives is the CHALLENGER's. Merging the other way hands
    // the victor the loser's currency, government type and party statuses, and
    // needs a runtime override for each to undo — where this direction needs one
    // for the name alone, which the other direction needs too.
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    const call = vi.mocked(mergeCountry).mock.calls[0][1];
    expect(call.toCountryId).toBe("DD");
    expect(call.fromCountryId).toBe("DE");
  });

  it("calls the unified state Germany, which is neither half's own name", async () => {
    // The GDR's shell would read as "East Germany" and the Federal Republic's
    // carries the era alias "West Germany". Both name one half of a country that
    // no longer has halves.
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { updateCountryState } = await import("@/lib/countryState");
    const named = vi
      .mocked(updateCountryState)
      .mock.calls.find((c) => c[2] && "displayNameOverride" in c[2]);
    expect(named).toBeDefined();
    expect(named![1]).toBe("DD");
    expect((named![2] as { displayNameOverride?: string }).displayNameOverride).toBe("Germany");
  });

  it("gives the unified state the winner's government type and bloc", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    // The government type now arrives through the full one-party install rather
    // than a bare `governmentType` copy: that helper also sets the ruling party,
    // bans the rest, restores the vote multipliers and seeds the escalation row.
    // Copying the field alone produced a one-party state with no party.
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    expect(vi.mocked(installOnePartyState)).toHaveBeenCalledWith(
      expect.anything(),
      "DD",
      412,
      expect.objectContaining({ rulingPartyId: 1 })
    );
    // The survivor is already in the Pact on this direction, so the admission is
    // GUARDED rather than unconditional: `admitMember` only inserts, and a second
    // row makes the country's own bloc depend on Mongo's return order.
    const { isMember } = await import("@/lib/internationalOrganizations/service");
    expect(vi.mocked(isMember)).toHaveBeenCalledWith(expect.anything(), "WARSAW_PACT", "DD");
  });

  it("reports a failed merge instead of a success the map does not show", async () => {
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    vi.mocked(mergeCountry).mockResolvedValue({
      ok: false,
      error: "Region SN could not transfer (region-not-found).",
      regionsTransferred: 2,
      regionsSkipped: 0,
      retired: false,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ outcome: "challenger" }),
      412
    );
    expect(res.actuated).toBe(false);
    expect(res.error).toContain("could not transfer");
    // No triumphant history entry for a merge that did not happen.
    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    expect(vi.mocked(recordCountryEvent)).not.toHaveBeenCalled();
  });

  it("moves nobody on a Western win", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "incumbent" }), 412);
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    expect(vi.mocked(mergeCountry)).not.toHaveBeenCalled();
    const { admitMember } = await import("@/lib/internationalOrganizations/joinApplication");
    expect(vi.mocked(admitMember)).not.toHaveBeenCalled();
  });

  it("guards the cooldown write so two runners cannot both record history", async () => {
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(db as unknown as Db, crisis(), 412);
    expect(res.actuated).toBe(false);
    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    expect(vi.mocked(recordCountryEvent)).not.toHaveBeenCalled();
  });
  it("leaves the western alliance so a unified Germany sits in one bloc only", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    expect(vi.mocked(removeOrganizationMembership)).toHaveBeenCalledWith(
      expect.anything(),
      "DD",
      "NATO",
      expect.any(String),
      412
    );
  });

  it("does not admit a survivor that is already in the eastern pole", async () => {
    // With the WINNER as the surviving shell it is normally in the Pact already --
    // it is the side that was there all along. `admitMember` only ever inserts, and
    // `loadBlocMembership` keys a country to whichever row it reads last, so a
    // second membership would make the country's own bloc depend on Mongo's
    // return order.
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { admitMember } = await import("@/lib/internationalOrganizations/joinApplication");
    // `isMember` is stubbed true for this suite, so the guard must suppress it.
    expect(vi.mocked(admitMember)).not.toHaveBeenCalled();
  });

  it("takes the dissolved side off the western alliance", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    const left = vi
      .mocked(removeOrganizationMembership)
      .mock.calls.findIndex((c) => c[1] === "DE" && c[2] === "NATO");
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it("records no withdrawal for a survivor that was never in the western alliance", async () => {
    const { isMember } = await import("@/lib/internationalOrganizations/service");
    vi.mocked(isMember).mockResolvedValue(false);
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    // It tombstones and writes history to EVERY remaining member unconditionally,
    // so calling it here would tell the whole alliance about a withdrawal that
    // never happened.
    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
  });

  it("re-aligns nobody in an era with no eastern alliance to join", async () => {
    const { blocOrgFor } = await import("@/lib/world/blocMembership");
    vi.mocked(blocOrgFor).mockImplementation((_preset, bloc) => (bloc === "east" ? null : "NATO"));
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ outcome: "challenger" }),
      412
    );
    // The merge still happens; only the bloc swap is off. Stripping NATO with no
    // Pact to join would invent a non-aligned Germany the design never described.
    expect(res.actuated).toBe(true);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    const { admitMember } = await import("@/lib/internationalOrganizations/joinApplication");
    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
    expect(vi.mocked(admitMember)).not.toHaveBeenCalled();
  });

  it("takes the dissolved challenger off both bloc rolls", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    // `mergeCountry` retires the shell but never touches organisation rows, so
    // without this the GDR stays on the Warsaw Pact roll for ever.
    const forDD = vi.mocked(removeOrganizationMembership).mock.calls.filter((c) => c[1] === "DE");
    expect(forDD.map((c) => c[2]).sort()).toEqual(["NATO", "WARSAW_PACT"]);
  });

  it("moves nobody between alliances on a Western win", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "incumbent" }), 412);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
  });

  it("migrates the parties before any region moves", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { mergePartiesIntoCountry } = await import("@/lib/country/mergePartiesIntoCountry");
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    expect(vi.mocked(mergePartiesIntoCountry).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mergeCountry).mock.invocationCallOrder[0]
    );
  });

  it("fuses East Berlin into Berlin only after the country merge", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { mergeRegion } = await import("@/lib/country/mergeRegion");
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    expect(vi.mocked(mergeRegion)).toHaveBeenCalledWith(expect.anything(), {
      fromRegionId: "BEO",
      toRegionId: "BE",
      currentTurn: 470,
    });
    // Both halves must be German before they can be fused.
    expect(vi.mocked(mergeRegion).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(mergeCountry).mock.invocationCallOrder[0]
    );
  });

  it("installs the WINNER's own ruling party, which needs no translation", async () => {
    // The protection this replaces: the other direction read the ruling party off
    // a migration map, and getting that wrong installed the side that had just
    // lost. With the winner as the shell its party never moves, so there is no map
    // to mistranslate and no losing incumbent to fall back to. The SED is
    // sequentialId 1 in its own country and stays 1.
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    expect(vi.mocked(installOnePartyState)).toHaveBeenCalledWith(
      expect.anything(),
      "DD",
      470,
      expect.objectContaining({ rulingPartyId: 1 })
    );
  });

  it("tolerates the parties that crossed and vacates the seats of those it bans", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    const opts = vi.mocked(installOnePartyState).mock.calls[0]?.[3] as {
      toleratedPartyIds?: number[];
      vacateBannedSeats?: boolean;
    };
    // The parties that CROSSED are the loser's, and this settlement outlaws them.
    // 7 is a carried id, so it must NOT be tolerated.
    expect(opts.toleratedPartyIds ?? []).not.toContain(7);
    // And their benches are emptied, rather than left sitting as a banned majority
    // of a chamber they are outlawed in.
    expect(opts.vacateBannedSeats).toBe(true);
  });

  it("does not schedule a post-conversion election", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    // Every other route into a conversion schedules one. Reunification must not:
    // a snap would dissolve the chamber this whole pipeline works to preserve.
    const opts = vi.mocked(installOnePartyState).mock.calls[0]?.[3];
    expect(opts).not.toHaveProperty("pendingPostConversionElection");
  });

  it("hands the absorbed country's law catalogue to the survivor", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { rescopeLegislationCatalogue } =
      await import("@/lib/country/rescopeLegislationCatalogue");
    expect(vi.mocked(rescopeLegislationCatalogue)).toHaveBeenCalledWith(
      expect.anything(),
      "DE",
      "DD"
    );
  });

  it("aborts and reports deferred when the party migration fails", async () => {
    const { mergePartiesIntoCountry } = await import("@/lib/country/mergePartiesIntoCountry");
    vi.mocked(mergePartiesIntoCountry).mockResolvedValue({
      ok: false,
      error: "counter unavailable",
      partyIdMap: {},
      partiesMoved: 0,
      documentsRemapped: 0,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ outcome: "challenger" }),
      470
    );
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    expect(res.deferred).toBe(true);
    expect(res.actuated).toBe(false);
    expect(vi.mocked(mergeCountry)).not.toHaveBeenCalled();
  });

  it("aborts when East Berlin cannot be fused", async () => {
    const { mergeRegion } = await import("@/lib/country/mergeRegion");
    vi.mocked(mergeRegion).mockResolvedValue({
      ok: false,
      error: "different countries",
      retired: false,
      documentsMoved: 0,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ outcome: "challenger" }),
      470
    );
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    expect(res.deferred).toBe(true);
    expect(vi.mocked(installOnePartyState)).not.toHaveBeenCalled();
  });

  it("runs none of the merge pipeline on a Western win", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "incumbent" }), 470);
    const { mergePartiesIntoCountry } = await import("@/lib/country/mergePartiesIntoCountry");
    const { mergeRegion } = await import("@/lib/country/mergeRegion");
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    expect(vi.mocked(mergePartiesIntoCountry)).not.toHaveBeenCalled();
    expect(vi.mocked(mergeRegion)).not.toHaveBeenCalled();
    expect(vi.mocked(installOnePartyState)).not.toHaveBeenCalled();
  });

  it("stands the losing head of government down from an office that no longer exists", async () => {
    const loser = new ObjectId();
    prime(db, "governmentFormations").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "DE" ? { _id: "DE", pmCharacterId: loser, pmNppId: null } : null
    );
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // `currentOffice` is a STORED denormalisation and does not follow the
    // formation row being deleted. Left alone the defeated chancellor goes on
    // reading as head of government of a country that no longer exists.
    const cleared = prime(db, "characters").updateOne.mock.calls.find(
      (c) => String(c[0]?._id) === String(loser)
    );
    expect(cleared).toBeDefined();
    expect(cleared![1].$set.currentOffice).toBeNull();
  });

  it("leaves the winner's own government in place rather than installing the loser's", async () => {
    const loser = new ObjectId();
    prime(db, "governmentFormations").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "DE" ? { _id: "DE", pmCharacterId: loser, pmNppId: null } : null
    );
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // The survivor IS the winner now. Writing a head of government onto its
    // formation row could only ever mean seating the side that just lost the
    // war -- the direction this block ran in when the shell was the loser's.
    const seated = prime(db, "governmentFormations").updateOne.mock.calls.find(
      (c) => c[1]?.$set?.pmCharacterId !== undefined || c[1]?.$set?.pmNppId !== undefined
    );
    expect(seated).toBeUndefined();
  });

  it("restates the governing party on the surviving formation", async () => {
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({
      governmentType: "onePartyState",
      rulingPartyId: 7,
    } as never);
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // `updateParliamentaryGovernmentSeats` reads `existing.governingPartyId` for
    // an already-formed government rather than recomputing it, so a value left
    // pointing at the pre-merge benches never heals on a later tick.
    const restated = prime(db, "governmentFormations").updateOne.mock.calls.find(
      (c) => c[0]._id === "DD" && c[1]?.$set?.governingPartyId !== undefined
    );
    expect(restated?.[1].$set.governingPartyId).toBe("7");
  });

  it("credits the reunification to the winner's own leader", async () => {
    const winner = new ObjectId();
    prime(db, "governmentFormations").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "DD" ? { _id: "DD", pmCharacterId: winner, pmNppId: null } : null
    );
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // The mandate is CREDITED, not carried: the winner's leader already holds a
    // `countryLeaderStates` record under the surviving country with their real
    // tenure on it, and reunification is the largest thing that will ever
    // happen to their leadership.
    const { adjustLeaderConfidence, REUNIFICATION_BUMP } =
      await import("@/lib/turn/rulingPartyConfidence");
    expect(vi.mocked(adjustLeaderConfidence)).toHaveBeenCalledWith(
      expect.anything(),
      "DD",
      winner,
      REUNIFICATION_BUMP,
      expect.any(String),
      470
    );
  });

  it("credits nothing when the winner is led by an NPP, which holds no record", async () => {
    prime(db, "governmentFormations").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "DD" ? { _id: "DD", pmCharacterId: null, pmNppId: new ObjectId() } : null
    );
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    const { adjustLeaderConfidence } = await import("@/lib/turn/rulingPartyConfidence");
    expect(vi.mocked(adjustLeaderConfidence)).not.toHaveBeenCalled();
  });

  it("reaps the dissolved side's leader-confidence rows", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // Keyed by country AND character, so they do not follow the country being
    // dissolved and no reader reaches them -- but a dissolved state holding
    // leadership records reads as real the moment the shell comes back.
    expect(prime(db, "countryLeaderStates").deleteMany).toHaveBeenCalledWith({
      countryId: "DE",
    });
  });

  it("names no ruling party when the winner had none, rather than guessing one", async () => {
    // A challenger that was not already a one-party state records no ruling party.
    // The old direction had to invent a stand-in here, because letting
    // `installOnePartyState` resolve it would read the SURVIVOR's formed
    // government and crown the side that just lost. With the winner AS the
    // survivor that risk is gone: there is no other government to fall back to,
    // so the honest answer is to name nobody and let the install resolve it from
    // the winner's own chamber.
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({
      governmentType: "parliamentaryRepublic",
      rulingPartyId: null,
    } as never);
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    const opts = vi.mocked(installOnePartyState).mock.calls[0]?.[3] as {
      rulingPartyId?: number;
    };
    expect(vi.mocked(installOnePartyState).mock.calls[0]?.[1]).toBe("DD");
    expect(opts.rulingPartyId).toBeUndefined();
  });

  it("moves the governing party with the government", async () => {
    const gs = new ObjectId();
    prime(db, "governmentFormations").findOne.mockResolvedValue({
      _id: "DE",
      pmCharacterId: gs,
      pmNppId: null,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const call = prime(db, "governmentFormations").updateOne.mock.calls.find(
      (c) => c[0]._id === "DD"
    );
    // `updateParliamentaryGovernmentSeats` reads this field for an already-formed
    // government rather than recomputing it, so a stale value never heals: the
    // survivor would keep naming the losing party as its government.
    expect(call?.[1].$set.governingPartyId).toBe("1");
  });

  it("clears a retired minister's stale cabinet fields", async () => {
    const minister = new ObjectId();
    prime(db, "cabinetMembers").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ characterId: minister }]),
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const calls = prime(db, "characters").updateMany.mock.calls;
    // `currentOffice` and `cabinetPosition` are stored, not derived, so a
    // deleted portfolio would otherwise still show on the character.
    expect(calls.some((c) => c[1].$unset?.cabinetPosition !== undefined)).toBe(true);
  });

  it("retires the LOSING cabinet and leaves the winner's ministers standing", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // A cabinet is the government of the day, and the settlement is precisely
    // that the losing side's government ends. The survivor IS the winner, so a
    // delete scoped to it could only ever unseat the administration that just
    // won the war -- which is the direction this ran in when the shell was the
    // loser's.
    const deletes = prime(db, "cabinetMembers").deleteMany.mock.calls;
    expect(deletes).toContainEqual([{ countryId: "DE" }]);
    expect(deletes.some((c) => c[0]?.countryId === "DD")).toBe(false);
  });

  it("carries no portfolio across, whatever the survivor calls it", async () => {
    const minister = new ObjectId();
    const row = new ObjectId();
    prime(db, "cabinetMembers").find.mockImplementation((f: { countryId: string }) => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue(
          f.countryId === "DE"
            ? [{ _id: row, positionId: "defense_minister", characterId: minister }]
            : []
        ),
    }));

    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // Germany seats a `defense_minister` and the GDR a `minister_of_defence`, so
    // a mapping between them exists and is deliberately not used: the executive
    // does not merge. Re-scoping the row would seat a defeated minister beside
    // the winner's own.
    expect(prime(db, "cabinetMembers").updateOne).not.toHaveBeenCalled();
  });

  it("clears the stored pointers on a retired minister", async () => {
    const minister = new ObjectId();
    const row = new ObjectId();
    prime(db, "cabinetMembers").find.mockImplementation((f: { countryId: string }) => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue(
          f.countryId === "DE"
            ? [{ _id: row, positionId: "minister_of_machine_building", characterId: minister }]
            : []
        ),
    }));

    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // The rows are read BEFORE the delete because they are how the holders are
    // found; `cabinetPosition` is stored, not derived, so a minister whose row
    // is gone still reads as sitting in a cabinet that no longer exists.
    const cleared = prime(db, "characters").updateMany.mock.calls.find(
      (c) => c[1].$unset?.cabinetPosition !== undefined
    );
    expect(cleared).toBeDefined();
  });

  it("retires a national office with no counterpart in the surviving country", async () => {
    const chairman = new ObjectId();
    prime(db, "electedOfficials").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: chairman, officeType: "chairmanOfStateCouncil" }]),
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    // The region sweep matches on `state`, and this office carries none, so it
    // would otherwise sit for ever on a dissolved country.
    expect(prime(db, "electedOfficials").deleteOne).toHaveBeenCalledWith({ _id: chairman });
  });
});
