import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/manpower/route";

function req(body: unknown) {
  return new Request("http://x", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("PUT manpower", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("nationalManpower");
    db.collection("statePolicies");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    // Default: the reserve law sits at its baseline rung, which permits conscription.
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({ policyOptionIndex: 2 });
  });

  it("saves a valid reinforcement mode", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ mode: "trained" }), call);
    expect(res.status).toBe(200);
    const c = db.collectionMocks.nationalManpower.updateOne.mock.calls[0];
    expect(c[0]).toEqual({ countryId: "US" });
    expect(c[1].$set).toEqual({ mode: "trained" });
  });

  it("400s an unknown mode without writing", async () => {
    const { PUT } = await import(ROUTE);
    expect((await PUT(req({ mode: "banana" }), call)).status).toBe(400);
    expect(db.collectionMocks.nationalManpower.updateOne).not.toHaveBeenCalled();
  });

  // The law gates conscription at the write boundary, not only in the turn step.
  it("400s conscript when the enacted law forbids it", async () => {
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({ policyOptionIndex: 0 });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ mode: "conscript" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.nationalManpower.updateOne).not.toHaveBeenCalled();
  });

  it("allows conscript when the law permits it", async () => {
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({ policyOptionIndex: 4 });
    const { PUT } = await import(ROUTE);
    expect((await PUT(req({ mode: "conscript" }), call)).status).toBe(200);
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { PUT } = await import(ROUTE);
    expect((await PUT(req({ mode: "trained" }), call)).status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { PUT } = await import(ROUTE);
    expect((await PUT(req({ mode: "trained" }), call)).status).toBe(404);
  });

  it("404s a non-defense seat", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ mode: "trained" }), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_education" }),
    });
    expect(res.status).toBe(404);
  });
});
