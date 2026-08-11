import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/military/currentDoctrineEra", () => ({ resolveDoctrineEra: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { resolveDoctrineEra } = await import("@/lib/military/currentDoctrineEra");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/doctrine/adopt/route";

// firepower-1 is in DEFAULT_ADOPTED, so firepower-2 is the next adoptable node in that path.
const VALID_KEY = "firepower-2";

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("POST doctrine/adopt", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(resolveDoctrineEra).mockResolvedValue(11); // 2010s → decade-2 node available
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("nationalDoctrine");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null); // defaults
    db.collectionMocks.nationalDoctrine.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("adopts a valid node and upserts the new state", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ key: VALID_KEY }), call);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adopted[VALID_KEY]).toBe(1);
    expect(body.points).toBeLessThan(12); // points spent
    expect(db.collectionMocks.nationalDoctrine.updateOne).toHaveBeenCalled();
  });

  it("rejects a non-holder non-admin with 403", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ key: VALID_KEY }), call);
    expect(res.status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ key: VALID_KEY }), call);
    expect(res.status).toBe(404);
  });

  it("400s an already-adopted node without writing", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ key: "maneuver-0" }), call); // already in DEFAULT_ADOPTED
    expect(res.status).toBe(400);
  });
});
