import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const COUNTRY = "US" as const;
const STATE = "AZ";

function holderRow(extra: Record<string, unknown>) {
  return {
    _id: new ObjectId(),
    officeType: "governor",
    state: STATE,
    countryId: COUNTRY,
    ...extra,
  };
}

describe("resolveOfficeAccess", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function setHolder(row: Record<string, unknown> | null) {
    db.collection("electedOfficials").findOne.mockResolvedValue(row);
  }
  function setStateOrg(row: Record<string, unknown> | null) {
    db.collection("statePartyOrg").findOne.mockResolvedValue(row);
  }
  function setParty(row: Record<string, unknown> | null) {
    db.collection("politicalParties").findOne.mockResolvedValue(row);
  }

  it("grants the human holder", async () => {
    const cid = new ObjectId();
    setHolder(holderRow({ characterId: cid, party: "1" }));
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, cid);
    expect(a.viewerIsHolder).toBe(true);
    expect(a.canManage).toBe(true);
    expect(a.actingRole).toBe("holder");
    expect(a.officeParty).toBe("1");
  });

  it("denies a random viewer of a human-held office", async () => {
    setHolder(holderRow({ characterId: new ObjectId(), party: "1" }));
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, new ObjectId());
    expect(a.canManage).toBe(false);
    expect(a.actingRole).toBeNull();
  });

  it("grants the state chair of an NPP-held office", async () => {
    const chair = new ObjectId();
    setHolder(holderRow({ characterId: null, isNPP: true, nppId: new ObjectId(), party: "3" }));
    setStateOrg({ chairId: chair, viceChairId: null });
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, chair);
    expect(a.canManage).toBe(true);
    expect(a.actingRole).toBe("stateChair");
    expect(a.viewerIsHolder).toBe(false);
  });

  it("grants the state vice chair of an NPP-held office", async () => {
    const vc = new ObjectId();
    setHolder(holderRow({ characterId: null, isNPP: true, party: "3" }));
    setStateOrg({ chairId: null, viceChairId: vc });
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, vc);
    expect(a.actingRole).toBe("stateViceChair");
  });

  it("denies the national chair when a state chair exists (state present blocks national)", async () => {
    const nationalChair = new ObjectId();
    setHolder(holderRow({ characterId: null, isNPP: true, party: "3" }));
    setStateOrg({ chairId: new ObjectId(), viceChairId: null });
    setParty({ sequentialId: 3, chairId: nationalChair, viceChairId: null });
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, nationalChair);
    expect(a.canManage).toBe(false);
  });

  it("falls back to the national chair only when both state slots are empty", async () => {
    const nationalChair = new ObjectId();
    setHolder(holderRow({ characterId: null, isNPP: true, party: "3" }));
    setStateOrg({ chairId: null, viceChairId: null });
    setParty({ sequentialId: 3, chairId: nationalChair, viceChairId: null });
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, nationalChair);
    expect(a.actingRole).toBe("nationalChair");
    expect(a.canManage).toBe(true);
  });

  it("falls back to the national vice chair when both state slots empty and no state org row", async () => {
    const nationalVc = new ObjectId();
    setHolder(holderRow({ characterId: null, isNPP: true, party: "3" }));
    setStateOrg(null); // no row at all → both empty
    setParty({ sequentialId: 3, chairId: new ObjectId(), viceChairId: nationalVc });
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, nationalVc);
    expect(a.actingRole).toBe("nationalViceChair");
  });

  it("denies a non-officer member of an NPP-held office", async () => {
    setHolder(holderRow({ characterId: null, isNPP: true, party: "3" }));
    setStateOrg({ chairId: new ObjectId(), viceChairId: new ObjectId() });
    setParty({ sequentialId: 3, chairId: new ObjectId(), viceChairId: new ObjectId() });
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, new ObjectId());
    expect(a.canManage).toBe(false);
  });

  it("denies everyone on a vacant office", async () => {
    setHolder(null);
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, new ObjectId());
    expect(a.holder).toBeNull();
    expect(a.canManage).toBe(false);
  });

  it("returns canManage=false for a null viewer character", async () => {
    setHolder(holderRow({ characterId: null, isNPP: true, party: "3" }));
    setStateOrg({ chairId: new ObjectId(), viceChairId: null });
    const { resolveOfficeAccess } = await import("./access");
    const a = await resolveOfficeAccess(db as unknown as Db, COUNTRY, STATE, null);
    expect(a.canManage).toBe(false);
  });
});

describe("canManageOffice", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("is a boolean wrapper over resolveOfficeAccess", async () => {
    const chair = new ObjectId();
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      officeType: "governor",
      state: STATE,
      countryId: COUNTRY,
      characterId: null,
      isNPP: true,
      party: "3",
    });
    db.collection("statePartyOrg").findOne.mockResolvedValue({ chairId: chair, viceChairId: null });
    const { canManageOffice } = await import("./access");
    expect(await canManageOffice(db as unknown as Db, COUNTRY, STATE, chair)).toBe(true);
    expect(await canManageOffice(db as unknown as Db, COUNTRY, STATE, new ObjectId())).toBe(false);
  });
});
