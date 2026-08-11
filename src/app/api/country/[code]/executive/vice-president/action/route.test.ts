import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");

function makeRequest(actionId: string) {
  return new Request("http://localhost/api/country/us/executive/vice-president/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId }),
  });
}
const routeParams = { params: Promise.resolve({ code: "us" }) };

describe("POST /api/country/[code]/executive/vice-president/action", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_vp" } },
    } as never);

    db.collection("electedOfficials");
    db.collection("characters");
    // Seated, character-backed VP with a full action pool.
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
      _id: "vp_official",
      officeType: "vicePresident",
      characterId: "char_vp",
      vpActionsRemaining: 2,
      lastVpActionResetDay: "2026-07-21",
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: "char_vp",
      favorability: 50,
      politicalInfluence: 40,
    });
  });

  it("lets the seated VP spend an action on Rally the Base and bumps their influence", async () => {
    const { POST } = await import("@/app/api/country/[code]/executive/vice-president/action/route");

    const response = await POST(makeRequest("rally_base"), routeParams);

    expect(response.status).toBe(200);
    // Spent one action atomically off the office doc.
    expect(db.collectionMocks.electedOfficials.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ vpActionsRemaining: { $gte: 1 } }),
      { $inc: { vpActionsRemaining: -1 } }
    );
    // Applied a clamped +2 political-influence bump to the VP's own character.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: "char_vp" },
      { $set: expect.objectContaining({ politicalInfluence: 42 }) }
    );
  });

  it("boosts the sitting president's favorability on a Surrogate Address", async () => {
    db.collectionMocks.electedOfficials.findOne
      .mockResolvedValueOnce({
        _id: "vp_official",
        officeType: "vicePresident",
        characterId: "char_vp",
        vpActionsRemaining: 2,
        lastVpActionResetDay: "2026-07-21",
      })
      .mockResolvedValueOnce({
        _id: "pres_official",
        officeType: "president",
        characterId: "char_pres",
      });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: "char_pres",
      favorability: 60,
      politicalInfluence: 70,
    });

    const { POST } = await import("@/app/api/country/[code]/executive/vice-president/action/route");

    const response = await POST(makeRequest("surrogate_address"), routeParams);

    expect(response.status).toBe(200);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: "char_pres" },
      { $set: expect.objectContaining({ favorability: 62 }) }
    );
  });

  it("rejects an actor who is not the seated VP without spending an action", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_other" } },
    } as never);

    const { POST } = await import("@/app/api/country/[code]/executive/vice-president/action/route");

    const response = await POST(makeRequest("rally_base"), routeParams);

    expect(response.status).toBe(403);
    expect(db.collectionMocks.electedOfficials.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a Surrogate Address with no sitting president and spends no action", async () => {
    db.collectionMocks.electedOfficials.findOne
      .mockResolvedValueOnce({
        _id: "vp_official",
        officeType: "vicePresident",
        characterId: "char_vp",
        vpActionsRemaining: 2,
        lastVpActionResetDay: "2026-07-21",
      })
      .mockResolvedValueOnce(null); // no president seated

    const { POST } = await import("@/app/api/country/[code]/executive/vice-president/action/route");

    const response = await POST(makeRequest("surrogate_address"), routeParams);

    expect(response.status).toBe(400);
    expect(db.collectionMocks.electedOfficials.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});
