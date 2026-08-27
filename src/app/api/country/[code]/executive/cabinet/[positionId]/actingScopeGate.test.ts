/**
 * The caretaker rule, proven on one representative route per blocked
 * capability. An acting holder is refused with a 403; a confirmed holder in the
 * identical seat is not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
// Asserted against the message source rather than a copied string, so the
// refusal a route actually returns cannot drift from the one players are shown.
import { barredScopeMessage } from "@/lib/cabinet/actingScope";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 400 }),
}));

let db: MockDb;
const holderId = new ObjectId();

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const name of [
    "cabinetMembers",
    "cabinetSettings",
    "gameState",
    "energyPlants",
    "characterGenerals",
    "nationalDoctrine",
  ]) {
    db.collection(name);
  }

  // Conflicts on, so the defence routes reach their holder check.
  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
    _id: "current",
    conflictsEnabled: true,
    currentTurn: 400,
    currentYear: 1953,
    startingYear: 1953,
  });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), isAdmin: false, character: { _id: holderId } },
  } as never);
});

/** Seat the caller in the given position, flagged acting or confirmed. */
function seat(positionId: string, acting: boolean) {
  db.collectionMocks["cabinetMembers"]!.findOne.mockResolvedValue({
    _id: new ObjectId(),
    countryId: "US",
    positionId,
    characterId: holderId,
    acting,
    ministerialActions: 4,
  });
}

function json(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("acting scope gate: policyStance", () => {
  const params = { params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }) };

  it("refuses an acting holder a settings change", async () => {
    seat("secretary_of_treasury", true);
    const { POST } = await import("./setting/route");
    const res = await POST(json({ tierSetting: "expanded" }), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(barredScopeMessage("stance"));
  });

  it("lets a confirmed holder past the acting gate", async () => {
    seat("secretary_of_treasury", false);
    const { POST } = await import("./setting/route");
    const res = await POST(json({ tierSetting: "expanded" }), params);
    expect(res.status).not.toBe(403);
  });

  it("exempts an admin acting on an acting-held seat", async () => {
    // Admins reach these routes without holding the seat, so the caretaker
    // limit must not attach to them via the seat's holder.
    seat("secretary_of_treasury", true);
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: true,
        character: { _id: new ObjectId() },
      },
    } as never);
    const { POST } = await import("./setting/route");
    const res = await POST(json({ tierSetting: "expanded" }), params);
    expect(res.status).not.toBe(403);
  });
});

describe("acting scope gate: personnel", () => {
  const params = {
    params: Promise.resolve({
      code: "us",
      positionId: "secretary_of_defense",
      characterId: new ObjectId().toString(),
    }),
  };

  it("refuses an acting holder a general dismissal", async () => {
    seat("secretary_of_defense", true);
    const { DELETE } = await import("./generals/[characterId]/route");
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(barredScopeMessage("personnel"));
  });

  it("lets a confirmed holder past the acting gate", async () => {
    seat("secretary_of_defense", false);
    const { DELETE } = await import("./generals/[characterId]/route");
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), params);
    expect(res.status).not.toBe(403);
  });
});

describe("acting scope gate: strategicCommitment", () => {
  const params = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

  it("refuses an acting holder a doctrine adoption", async () => {
    seat("secretary_of_defense", true);
    const { POST } = await import("./doctrine/adopt/route");
    const res = await POST(json({ key: "nuclear-deterrence" }), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(barredScopeMessage("doctrine"));
  });

  it("lets a confirmed holder past the acting gate", async () => {
    seat("secretary_of_defense", false);
    const { POST } = await import("./doctrine/adopt/route");
    const res = await POST(json({ key: "nuclear-deterrence" }), params);
    expect(res.status).not.toBe(403);
  });
});

describe("acting scope gate: capitalProject", () => {
  const params = {
    params: Promise.resolve({
      code: "us",
      positionId: "secretary_of_energy",
      plantId: new ObjectId().toString(),
    }),
  };

  it("refuses an acting holder a plant retirement", async () => {
    seat("secretary_of_energy", true);
    const { DELETE } = await import("./energy/[plantId]/route");
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(barredScopeMessage("assets"));
  });

  it("lets a confirmed holder past the acting gate", async () => {
    seat("secretary_of_energy", false);
    const { DELETE } = await import("./energy/[plantId]/route");
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), params);
    expect(res.status).not.toBe(403);
  });
});
