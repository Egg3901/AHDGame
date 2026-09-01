import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { SETTLEMENT_REOPEN_COOLDOWN_TURNS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({ recordCountryEvent: vi.fn() }));
vi.mock("@/lib/country/mergeCountry", () => ({ mergeCountry: vi.fn() }));
vi.mock("@/lib/countryState", () => ({ getCountryState: vi.fn() }));
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
    expect(done[1].$set.cooldownUntilTurn).toBe(412 + SETTLEMENT_REOPEN_COOLDOWN_TURNS);
    expect(done[1].$set.actuationClaimedAt).toBeNull();
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

  it("absorbs the GDR into the surviving Germany on a reunification win", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ outcome: "challenger" }),
      412
    );
    expect(res).toEqual({ actuated: true, outcome: "challenger", deferred: false });
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    expect(vi.mocked(mergeCountry).mock.calls[0][1]).toEqual({
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
  });

  it("merges INTO the country already named Germany, never the other way", async () => {
    // A renamed GDR is unbuildable: the country name is seed data read at ~90
    // synchronous sites. The surviving shell must be the one already called
    // Germany, or the unified state renders as "East Germany" everywhere.
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { mergeCountry } = await import("@/lib/country/mergeCountry");
    const call = vi.mocked(mergeCountry).mock.calls[0][1];
    expect(call.toCountryId).toBe("DE");
    expect(call.fromCountryId).not.toBe("DE");
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
      "DE",
      412,
      expect.objectContaining({ rulingPartyId: 7 })
    );
    const { admitMember } = await import("@/lib/internationalOrganizations/joinApplication");
    expect(vi.mocked(admitMember)).toHaveBeenCalledWith(
      expect.anything(),
      "WARSAW_PACT",
      "DE",
      412
    );
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
      "DE",
      "NATO",
      expect.any(String),
      412
    );
  });

  it("leaves the West BEFORE joining the East, so a failure lands in neither pole", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 412);
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    const { admitMember } = await import("@/lib/internationalOrganizations/joinApplication");
    const left = vi
      .mocked(removeOrganizationMembership)
      .mock.calls.findIndex((c) => c[1] === "DE" && c[2] === "NATO");
    expect(left).toBeGreaterThanOrEqual(0);
    // `actuateSettlementOutcome` claims the cooldown first and never retries, so
    // whichever state a throw leaves behind is permanent. In BOTH poles is the
    // non-deterministic one; this ordering is what keeps it unreachable.
    expect(vi.mocked(removeOrganizationMembership).mock.invocationCallOrder[left]).toBeLessThan(
      vi.mocked(admitMember).mock.invocationCallOrder[0]!
    );
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
    const forDD = vi.mocked(removeOrganizationMembership).mock.calls.filter((c) => c[1] === "DD");
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

  it("installs the absorbed country's ruling party, not the survivor's", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    // The SED is sequentialId 1 in East Germany and 7 after the migration.
    // Germany's OWN governing party is also "1" (the SPD) -- the collision this
    // assertion exists to guard.
    expect(vi.mocked(installOnePartyState)).toHaveBeenCalledWith(
      expect.anything(),
      "DE",
      470,
      expect.objectContaining({ rulingPartyId: 7 })
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
    // The carried bloc arrives `approved`, not banned: the winning side does not
    // dissolve its own coalition partners at the moment it wins.
    expect(opts.toleratedPartyIds).toContain(7);
    // And the survivor's own parties lose the offices they hold, rather than
    // sitting as a banned majority of a chamber they are outlawed in.
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
      "DD",
      "DE"
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

  it("carries the absorbed country's head of government to the survivor", async () => {
    const gs = new ObjectId();
    prime(db, "governmentFormations").findOne.mockResolvedValue({
      _id: "DD",
      pmCharacterId: gs,
      pmNppId: null,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const call = prime(db, "governmentFormations").updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    );
    // The winning side's leader leads the unified state. The office KEY stays
    // `chancellor`; the title is resolved from `governmentType` at display time.
    expect(call?.[1].$set.pmCharacterId).toEqual(gs);
    // The survivor's NPP chancellor must not remain beside them.
    expect(call?.[1].$set.pmNppId).toBeNull();
  });

  it("stands the displaced leader down from the office they no longer hold", async () => {
    const gs = new ObjectId();
    prime(db, "governmentFormations").findOne.mockResolvedValue({
      _id: "DD",
      pmCharacterId: gs,
      pmNppId: null,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // `currentOffice` is a STORED denormalisation: clearing `pmNppId` alone
    // leaves the outgoing chancellor still reading as chancellor everywhere that
    // ranks an office off that field. Scoped by country AND executive key.
    for (const coll of ["characters", "npps"] as const) {
      const cleared = prime(db, coll).updateMany.mock.calls.find(
        (c) => c[0]?.countryId === "DE" && c[0]?.["currentOffice.type"] === "chancellor"
      );
      expect(cleared, `${coll} stand-down`).toBeDefined();
      expect(cleared![1].$set.currentOffice).toBeNull();
    }
  });

  it("gives the carried leader the surviving country's office key", async () => {
    const gs = new ObjectId();
    prime(db, "governmentFormations").findOne.mockResolvedValue({
      _id: "DD",
      pmCharacterId: gs,
      pmNppId: null,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // They arrive holding `generalSecretary`, which the Federal Republic does not
    // define. Left alone they show a defunct title and match nothing that looks
    // the office up in the country's config.
    const took = prime(db, "characters").updateOne.mock.calls.find(
      (c) => String(c[0]?._id) === String(gs) && c[1]?.$set?.["currentOffice.type"] !== undefined
    );
    expect(took).toBeDefined();
    expect(took![1].$set["currentOffice.type"]).toBe("chancellor");
    // Filtered on the office being an OBJECT: `$set` on a dotted path throws
    // when the parent is null.
    expect(took![0].currentOffice).toEqual({ $type: "object" });
  });

  it("seats a carried leader who holds no office at all", async () => {
    // A leader whose only office was a cabinet portfolio the remap retires
    // reaches this with `currentOffice` already nulled. A dotted `$set` would
    // throw there, aborting a merge that has already claimed its cooldown and
    // cannot retry.
    const gs = new ObjectId();
    prime(db, "governmentFormations").findOne.mockResolvedValue({
      _id: "DD",
      pmCharacterId: gs,
      pmNppId: null,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    const whole = prime(db, "characters").updateOne.mock.calls.find(
      (c) => String(c[0]?._id) === String(gs) && c[1]?.$set?.currentOffice !== undefined
    );
    expect(whole).toBeDefined();
    expect(whole![1].$set.currentOffice).toEqual({ type: "chancellor" });
    expect(whole![0].currentOffice).toEqual({ $not: { $type: "object" } });
  });

  it("never installs the survivor's own party when the absorbed state names none", async () => {
    // A challenger that was not already a one-party state records no ruling
    // party. Letting the resolver fill the gap reads the SURVIVOR's formed
    // government and installs the side that just lost, banning the winner.
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({
      governmentType: "parliamentaryRepublic",
      rulingPartyId: null,
    } as never);
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const { installOnePartyState } = await import("@/lib/onePartyState/installOnePartyState");
    // 7 is the carried party; 1 would be Germany's own SPD.
    expect(vi.mocked(installOnePartyState)).toHaveBeenCalledWith(
      expect.anything(),
      "DE",
      470,
      expect.objectContaining({ rulingPartyId: 7 })
    );
  });

  it("moves the governing party with the government", async () => {
    const gs = new ObjectId();
    prime(db, "governmentFormations").findOne.mockResolvedValue({
      _id: "DD",
      pmCharacterId: gs,
      pmNppId: null,
    });
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    const call = prime(db, "governmentFormations").updateOne.mock.calls.find(
      (c) => c[0]._id === "DE"
    );
    // `updateParliamentaryGovernmentSeats` reads this field for an already-formed
    // government rather than recomputing it, so a stale value never heals: the
    // survivor would keep naming the losing party as its government.
    expect(call?.[1].$set.governingPartyId).toBe("7");
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

  it("clears the SURVIVOR's cabinet so the defeated side does not govern", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);
    // The merge runs winner-into-shell, so the shell's own ministers go. In the
    // live German case they are NPP ministers of parties this settlement is
    // about to ban, sitting in portfolios the carried ministers are given.
    // Scoped OFF the carried rows, so a resume cannot throw away the winning
    // cabinet it is meant to be seating.
    expect(prime(db, "cabinetMembers").deleteMany).toHaveBeenCalledWith({
      countryId: "DE",
      "mergedFrom.countryId": { $ne: "DD" },
    });
  });

  it("carries a mapped portfolio to the surviving country's equivalent", async () => {
    const minister = new ObjectId();
    const row = new ObjectId();
    prime(db, "cabinetMembers").find.mockImplementation((f: { countryId: string }) => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue(
          f.countryId === "DD"
            ? [{ _id: row, positionId: "minister_of_defence", characterId: minister }]
            : []
        ),
    }));

    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // East Germany seats a `minister_of_defence`; Germany a `defense_minister`.
    // The winner keeps the portfolio, under the survivor's name for it.
    expect(prime(db, "cabinetMembers").updateOne).toHaveBeenCalledWith(
      { _id: row },
      expect.objectContaining({
        $set: expect.objectContaining({ countryId: "DE", positionId: "defense_minister" }),
      })
    );
  });

  it("retires an absorbed portfolio the survivor has no counterpart for", async () => {
    const minister = new ObjectId();
    const row = new ObjectId();
    prime(db, "cabinetMembers").find.mockImplementation((f: { countryId: string }) => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue(
          f.countryId === "DD"
            ? [{ _id: row, positionId: "minister_of_machine_building", characterId: minister }]
            : []
        ),
    }));

    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis({ outcome: "challenger" }), 470);

    // The Federal Republic runs no Ministry for Machine Building, so the
    // portfolio ends with the state that had it rather than being invented.
    expect(prime(db, "cabinetMembers").deleteOne).toHaveBeenCalledWith({ _id: row });
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
