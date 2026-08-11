import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { pickDefectors, type OfficialAlignment } from "@/lib/onePartyState/factionSplit";

function alignment(divergence: number, charId = new ObjectId()): OfficialAlignment {
  return { characterId: charId, divergence };
}

describe("pickDefectors", () => {
  it("returns empty for empty input", () => {
    expect(pickDefectors([])).toEqual([]);
  });

  it("picks max(3, ceil(15% of officials))", () => {
    const ten = Array.from({ length: 10 }, () => alignment(0));
    expect(pickDefectors(ten).length).toBe(3);

    // 15% of 50 = 7.5 → ceil to 8
    const fifty = Array.from({ length: 50 }, () => alignment(0));
    expect(pickDefectors(fifty).length).toBe(8);

    // 15% of 100 = 15
    const hundred = Array.from({ length: 100 }, () => alignment(0));
    expect(pickDefectors(hundred).length).toBe(15);
  });

  it("returns all officials when fewer than 3 exist", () => {
    expect(pickDefectors([alignment(1), alignment(2)]).length).toBe(2);
  });

  it("orders by divergence descending", () => {
    const list: OfficialAlignment[] = [
      alignment(0.1),
      alignment(0.9),
      alignment(0.5),
      alignment(0.7),
    ];
    const picked = pickDefectors(list);
    expect(picked[0].divergence).toBe(0.9);
    expect(picked[1].divergence).toBe(0.7);
    expect(picked[2].divergence).toBe(0.5);
  });

  it("ties broken by stable input order (lower index wins)", () => {
    const ids = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
    const list: OfficialAlignment[] = ids.map((id) => alignment(0.5, id));
    const picked = pickDefectors(list);
    // All ties at 0.5 → first 3 by input order
    expect(picked.map((p) => p.characterId.toString())).toEqual([
      ids[0].toString(),
      ids[1].toString(),
      ids[2].toString(),
    ]);
  });
});

// ── fireFactionSplit eligibility (#3164 regression) ─────────────────────────
//
// The t1061 CN incident: NPP-held seats carry `characterId: null`; letting
// those nulls into the defector list made the electedOfficials `$in` update
// match EVERY null-characterId row (Mongo `$in: [null]` semantics) and flip
// all NPP seats to the new party. The placeholder scorer also "defected" the
// ruling party's chair. Both are excluded now.
import { vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { fireFactionSplit } from "@/lib/onePartyState/factionSplit";

vi.mock("@/lib/countryState", () => ({ getCountryState: vi.fn() }));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn() }));
vi.mock("@/lib/parties/vacateDepartedLeadership", () => ({
  vacateDepartedLeadership: vi.fn(),
}));
vi.mock("@/lib/parties/recomputePartyMemberCount", () => ({
  recomputePartyMemberCount: vi.fn(),
}));
vi.mock("@/lib/elections/withdrawFromPartyLeadershipElections", () => ({
  withdrawFromPartyLeadershipElections: vi.fn(),
}));

describe("fireFactionSplit defector eligibility", () => {
  let db: MockDb;
  const chairId = new ObjectId();
  const leaderId = new ObjectId();
  const regulars = Array.from({ length: 4 }, () => new ObjectId());

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({ rulingPartyId: 1 } as never);
    const { getNextSequentialId } = await import("@/lib/db/sequentialId");
    vi.mocked(getNextSequentialId).mockResolvedValue(4);

    const parties = db.collection("politicalParties");
    parties.findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "CN",
      chairId,
      economicPosition: -3,
      socialPosition: 1,
    });
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "CN",
      pmCharacterId: leaderId,
    });
    const officials = [
      // NPP-held seats — must never enter the defector list
      ...Array.from({ length: 5 }, () => ({ characterId: null })),
      { characterId: chairId }, // ruling-party chair — excluded
      { characterId: leaderId }, // installed leader — excluded
      ...regulars.map((id) => ({ characterId: id })),
      { characterId: regulars[0] }, // duplicate seat for same character — deduped
    ];
    const cursor = db.collection("electedOfficials").find();
    cursor.toArray.mockResolvedValue(officials);
  });

  it("only defects character-held seats, excluding chair/leader, no nulls in $in", async () => {
    const result = await fireFactionSplit(db as unknown as Db, "CN", 1061);
    expect(result).not.toBeNull();
    const pickedIds = result!.defectorCharacterIds.map((id) => id.toString());
    // 4 unique eligible regulars → max(3, ceil(4*0.15)) = 3 defectors
    expect(pickedIds).toHaveLength(3);
    expect(pickedIds).not.toContain(chairId.toString());
    expect(pickedIds).not.toContain(leaderId.toString());
    expect(pickedIds).not.toContain("null");

    // The seat update must carry only real ObjectIds — a null in $in would
    // match every NPP seat row.
    const seatUpdate = db.collectionMocks.electedOfficials.updateMany.mock.calls.find(
      (call) => call[0]?.characterId?.$in
    );
    expect(seatUpdate).toBeDefined();
    for (const id of seatUpdate![0].characterId.$in) {
      expect(id).not.toBeNull();
    }
  });

  it("no-ops when only NPP seats and excluded leaders hold ruling-party seats", async () => {
    const cursor = db.collection("electedOfficials").find();
    cursor.toArray.mockResolvedValue([
      { characterId: null },
      { characterId: null },
      { characterId: chairId },
      { characterId: leaderId },
    ]);
    const result = await fireFactionSplit(db as unknown as Db, "CN", 1061);
    expect(result).toBeNull();
    expect(db.collectionMocks.politicalParties.insertOne).not.toHaveBeenCalled();
  });
});
