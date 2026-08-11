import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb, assertCalledWithFilter } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/countryState", () => ({ getCountryState: vi.fn() }));
vi.mock("@/lib/db/collections/cabinetSettings", () => ({
  resetCabinetSettingCooldowns: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/country/cn/cabinet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

describe("POST /api/admin/country/[code]/cabinet", () => {
  let db: MockDb;
  const charId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: true },
    } as never);
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({ governmentType: "onePartyState" } as never);

    db.collection("characters");
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      name: "Test Minister",
      userId: new ObjectId(),
      countryId: "CN",
      party: "1",
    });
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    db.collection("ukCabinetCooldowns");
    db.collection("cabinetMembers");
    db.collection("cabinetNominations");
  });

  it("rejects non-admin callers", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);

    const res = await POST(
      makeRequest({
        action: "appoint",
        positionId: "vice_premier",
        characterId: charId.toString(),
      }),
      makeParams("cn")
    );
    expect(res.status).toBe(403);
  });

  it("appoints a player character to a parliamentary-family seat", async () => {
    const res = await POST(
      makeRequest({
        action: "appoint",
        positionId: "vice_premier",
        characterId: charId.toString(),
      }),
      makeParams("cn")
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toContain("Test Minister");
    assertCalledWithFilter(db.collectionMocks.cabinetMembers.updateOne, {
      countryId: "CN",
      positionId: "vice_premier",
    });
    // Position cooldown is cleared on appointment.
    assertCalledWithFilter(db.collectionMocks.ukCabinetCooldowns.deleteOne, {
      countryId: "CN",
      positionId: "vice_premier",
    });
    // currentOffice set so the appointee receives cabinet bonuses.
    assertCalledWithFilter(db.collectionMocks.characters.updateOne, { _id: charId });
  });

  it("rejects appointing to the head-of-government seat", async () => {
    const res = await POST(
      makeRequest({ action: "appoint", positionId: "premier", characterId: charId.toString() }),
      makeParams("cn")
    );
    expect(res.status).toBe(403);
  });

  it("rejects appointing a non-player (NPP) character", async () => {
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      name: "NPP Bot",
      countryId: "CN",
    });
    const res = await POST(
      makeRequest({
        action: "appoint",
        positionId: "vice_premier",
        characterId: charId.toString(),
      }),
      makeParams("cn")
    );
    expect(res.status).toBe(403);
  });

  it("removes a sitting member and restores their legislative office", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "CN",
      positionId: "vice_premier",
      characterId: charId,
      characterName: "Test Minister",
    });
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
      characterId: charId,
      officeType: "npcDelegate",
      state: "XB",
    });

    const res = await POST(
      makeRequest({ action: "remove", positionId: "vice_premier" }),
      makeParams("cn")
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toContain("removed");
    assertCalledWithFilter(db.collectionMocks.cabinetMembers.deleteOne, {
      countryId: "CN",
      positionId: "vice_premier",
    });
    assertCalledWithFilter(db.collectionMocks.characters.updateOne, { _id: charId });
  });

  it("clears a position cooldown via resetCooldown", async () => {
    const res = await POST(
      makeRequest({ action: "resetCooldown", positionId: "vice_premier" }),
      makeParams("cn")
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toContain("cooldown");
    assertCalledWithFilter(db.collectionMocks.ukCabinetCooldowns.deleteOne, {
      countryId: "CN",
      positionId: "vice_premier",
    });
  });

  it("appoints into the presidential flow", async () => {
    const { getCountryState } = await import("@/lib/countryState");
    vi.mocked(getCountryState).mockResolvedValue({ governmentType: "presidential" } as never);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      name: "Test Secretary",
      userId: new ObjectId(),
      countryId: "US",
      party: "democrat",
    });

    const res = await POST(
      makeRequest({
        action: "appoint",
        positionId: "secretary_of_state",
        characterId: charId.toString(),
      }),
      makeParams("us")
    );

    expect(res.status).toBe(200);
    assertCalledWithFilter(db.collectionMocks.cabinetMembers.updateOne, {
      countryId: "US",
      positionId: "secretary_of_state",
    });
    // A direct admin appointment closes any open Senate nomination for the seat.
    assertCalledWithFilter(db.collectionMocks.cabinetNominations.updateMany, {
      countryId: "US",
      positionId: "secretary_of_state",
    });
  });
});
