import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { newGeneral } from "@/lib/military/generalsTree";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/military/currentGeneralEra", () => ({ resolveGeneralEra: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { resolveGeneralEra } = await import("@/lib/military/currentGeneralEra");
const ROUTE = "@/app/api/character/[id]/general/train/route";

const CHAR_ID = new ObjectId();
const call = { params: Promise.resolve({ id: CHAR_ID.toString() }) };

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST general/train", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: CHAR_ID } },
    } as never);
    vi.mocked(resolveGeneralEra).mockResolvedValue(2020); // modern era → no node is "future"
    db.collection("gameState");
    db.collection("characters");
    db.collection("characterGenerals");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: CHAR_ID, name: "Jane Doe" });
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: CHAR_ID.toString(),
      general: newGeneral(CHAR_ID.toString(), "Jane Doe", "JD", "US"),
    });
    db.collectionMocks.characterGenerals.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("trains an available node, spends a point, and persists", async () => {
    const { POST } = await import(ROUTE);
    // "tr1" (Unit Drills, 1900) is the first node of the Training path → available.
    const res = await POST(req({ nodeId: "tr1" }), call);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.general.gtraits).toContain("tr1");
    expect(body.general.pts).toBe(3); // 4 - 1
    expect(db.collectionMocks.characterGenerals.updateOne).toHaveBeenCalled();
  });

  it("400s an unknown / unavailable node without writing", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeId: "not-a-real-node" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  it("403s a character who is not a commissioned general", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue(null);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeId: "tr1" }), call);
    expect(res.status).toBe(403);
  });

  it("403s a non-self non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: new ObjectId() } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ nodeId: "tr1" }), call);
    expect(res.status).toBe(403);
  });
});
