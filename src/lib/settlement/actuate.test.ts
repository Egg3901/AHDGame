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
    vi.mocked(blocOrgFor).mockReturnValue("WARSAW_PACT");
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

  it("ignores a crisis already actuated", async () => {
    // A cooldown is the marker; without this check the history entries double.
    const { actuateSettlementOutcome } = await import("./actuate");
    const res = await actuateSettlementOutcome(
      db as unknown as Db,
      crisis({ cooldownUntilTurn: 500 }),
      412
    );
    expect(res.actuated).toBe(false);
  });

  it("sets a cooldown so the question can be asked again, but not at once", async () => {
    const { actuateSettlementOutcome } = await import("./actuate");
    await actuateSettlementOutcome(db as unknown as Db, crisis(), 412);
    const [filter, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter).toMatchObject({ cooldownUntilTurn: null });
    expect(update.$set.cooldownUntilTurn).toBe(412 + SETTLEMENT_REOPEN_COOLDOWN_TURNS);
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
    const { getCountryStateCollection } = await import("@/lib/db/collections/countryState");
    const coll = vi.mocked(getCountryStateCollection).mock.results[0].value;
    expect(coll.updateOne).toHaveBeenCalledWith(
      { _id: "DE" },
      expect.objectContaining({
        $set: expect.objectContaining({ governmentType: "onePartyState" }),
      }),
      { upsert: true }
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
});
