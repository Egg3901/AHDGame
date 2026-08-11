import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/battle/declare/route";

function post(body: unknown) {
  return new Request("http://x/api/…/battle/declare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function del(theaterId: string) {
  return new Request(`http://x/api/…/battle/declare?theaterId=${theaterId}`, { method: "DELETE" });
}
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };
// East Germany's defence seat — the viewer in the eastern-belligerent regression below.
const ddCall = { params: Promise.resolve({ code: "dd", positionId: "minister_of_defence" }) };

describe("battle declare route", () => {
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
    db.collection("militaryUnits");
    db.collection("battleDeclarations");
    db.collection("militaryFormations");
    db.collection("conflicts");
    // "afghan" is a live conflict by default (a declaration needs a real one), with a
    // real roster on both sides — opposition is resolved from these, not from a bloc.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "afghan",
      sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition", backer: "west" },
      sideB: {
        label: "Warsaw Pact",
        countries: ["DD", "RU"],
        kind: "coalition",
        backer: "east",
      },
    });
    // No theater commander designated by default — the defense holder retains authority.
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: true,
      currentTurn: 40,
    });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(3);
    db.collectionMocks.battleDeclarations.findOne.mockResolvedValue(null); // no existing pending
    db.collectionMocks.battleDeclarations.insertOne.mockResolvedValue({ insertedId: "d1" });
    db.collectionMocks.battleDeclarations.deleteOne.mockResolvedValue({ deletedCount: 1 });
  });

  it("declares a valid offensive vs an opposing-side nation (pending insert)", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.battleDeclarations.insertOne).toHaveBeenCalled();
    const doc = db.collectionMocks.battleDeclarations.insertOne.mock.calls[0][0];
    expect(doc).toMatchObject({
      declarerCountry: "US",
      targetCountry: "RU",
      theaterId: "afghan",
      declaredTurn: 40,
      status: "pending",
    });
  });

  it("400s a target on the declarer's own side without writing", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "UK" }), call);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Target is on your own side" });
    expect(db.collectionMocks.battleDeclarations.insertOne).not.toHaveBeenCalled();
  });

  // You may only attack somebody actually in this war. The old global bloc check let a
  // belligerent name any opposing-bloc nation, dragging a bystander into a war it had
  // no part in.
  it("400s a target that is not a belligerent in this conflict", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "CN" }), call);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Target is not a belligerent in this conflict",
    });
    expect(db.collectionMocks.battleDeclarations.insertOne).not.toHaveBeenCalled();
  });

  // Regression: East Germany could not declare on anyone. `blocOf` had no DD row and
  // silently fell back to the US one, so DD read as "west" and every NATO target was
  // refused as same-bloc. Opposition is this conflict's rosters, not a global table.
  it("lets an eastern belligerent declare on the western side (DD -> US)", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "US" }), ddCall);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.battleDeclarations.insertOne).toHaveBeenCalled();
    expect(db.collectionMocks.battleDeclarations.insertOne.mock.calls[0][0]).toMatchObject({
      declarerCountry: "DD",
      targetCountry: "US",
    });
  });

  it("400s an unknown target country", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "ZZ" }), call);
    expect(res.status).toBe(400);
  });

  it("400s when the theater is not a live conflict", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "ghost", targetCountry: "RU" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.battleDeclarations.insertOne).not.toHaveBeenCalled();
  });

  it("400s when the declarer has no forces at the theater", async () => {
    db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(0);
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.battleDeclarations.insertOne).not.toHaveBeenCalled();
  });

  it("409s a duplicate pending declaration", async () => {
    db.collectionMocks.battleDeclarations.findOne.mockResolvedValue({ _id: "existing" });
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(409);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(404);
  });

  it("withdraws a pending declaration", async () => {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(del("afghan"), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.battleDeclarations.deleteOne).toHaveBeenCalled();
  });

  it("404s withdraw when nothing is pending", async () => {
    db.collectionMocks.battleDeclarations.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(del("afghan"), call);
    expect(res.status).toBe(404);
  });

  // Authority over a Conflict is per-theater. Designating a Theater Commander
  // delegates the front to them — the defense holder can no longer declare over
  // their head, and the TC (usually a general, not the seat holder) can.
  function withTheaterCommander(characterId: string) {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      positions: {},
      conflictAssignments: [
        { theaterId: "afghan", generalCharacterId: characterId, inCharge: true, unitIds: [] },
      ],
    });
  }

  it("lets the theater commander declare even though they are not the defense holder", async () => {
    withTheaterCommander("char_general");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_general" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(200);
  });

  it("403s the defense holder once a theater commander is designated", async () => {
    withTheaterCommander("char_general");
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.battleDeclarations.insertOne).not.toHaveBeenCalled();
  });

  it("403s a general who commands a different conflict", async () => {
    withTheaterCommander("char_general");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_other" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(403);
  });

  it("admin keeps the escape hatch over a theater commander", async () => {
    withTheaterCommander("char_general");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: true, character: { _id: "char_admin" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(200);
  });

  it("403s a non-holder non-admin when no theater commander is designated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "nobody" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(post({ theaterId: "afghan", targetCountry: "RU" }), call);
    expect(res.status).toBe(403);
  });

  it("403s the defense holder withdrawing from a conflict with a theater commander", async () => {
    withTheaterCommander("char_general");
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(del("afghan"), call);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.battleDeclarations.deleteOne).not.toHaveBeenCalled();
  });

  it("lets the theater commander withdraw from their own conflict", async () => {
    withTheaterCommander("char_general");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_general" } },
    } as never);
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(del("afghan"), call);
    expect(res.status).toBe(200);
  });
});
