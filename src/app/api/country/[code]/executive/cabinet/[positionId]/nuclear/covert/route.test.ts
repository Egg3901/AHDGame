import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BREAKOUT_TENSION_SPIKE } from "@/lib/military/covertNuclear";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const BASE = "@/app/api/country/[code]/executive/cabinet/[positionId]/nuclear/covert";

function post(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const get = () => new Request("http://x");
// DD's defence seat, per DEFENSE_POSITION_BY_COUNTRY.
const call = { params: Promise.resolve({ code: "dd", positionId: "minister_of_defence" }) };

const covertDoc = (over: Record<string, unknown> = {}) => ({
  _id: "DD",
  stage: 2,
  progress: 15,
  funding: "steady",
  suspicion: 25,
  exposureCount: 1,
  startedTurn: 5,
  completed: false,
  updatedAt: new Date(),
  ...over,
});

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
  db.collection("covertNuclearPrograms");
  db.collection("nuclearPrograms");
  db.collection("coldWarTension");
  db.collection("politicalMetrics");
  db.collection("newsPosts");
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    coldWarEnabled: true,
    currentYear: 1955,
    currentTurn: 42,
    startingYear: 1953,
  });
  db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
    _id: "m1",
    characterId: "char_1",
  });
  db.collectionMocks.covertNuclearPrograms.findOne.mockResolvedValue(covertDoc());
  db.collectionMocks.covertNuclearPrograms.updateOne.mockResolvedValue({ matchedCount: 1 });
});

describe("GET nuclear/covert", () => {
  it("returns the full covert surface for the DDR's defence seat", async () => {
    const { GET } = await import(`${BASE}/route`);
    const res = await GET(get(), call);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(true);
    expect(body.state).toMatchObject({ stage: 2, funding: "steady", suspicion: 25 });
    expect(body.stages).toHaveLength(5);
    expect(body.stageProgress).toBe(60);
    expect(body.discoveryChance).toBeGreaterThan(0);
    expect(body.fundingOptions).toContainEqual({ key: "crash", cost: 780, progress: 4 });
  });

  it("404s a bare eligible:false for a country outside the covert set", async () => {
    const { GET } = await import(`${BASE}/route`);
    const res = await GET(get(), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }),
    });
    expect(res.status).toBe(404);
    // Nothing else attached: the surface must not exist for anyone else.
    expect(await res.json()).toEqual({ eligible: false });
  });

  it("404s while the Cold War subsystem is off", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ coldWarEnabled: false });
    const { GET } = await import(`${BASE}/route`);
    const res = await GET(get(), call);
    expect(res.status).toBe(404);
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { GET } = await import(`${BASE}/route`);
    const res = await GET(get(), call);
    expect(res.status).toBe(403);
  });
});

describe("POST nuclear/covert/funding", () => {
  it("sets the level and stamps startedTurn on the first real funding", async () => {
    db.collectionMocks.covertNuclearPrograms.findOne.mockResolvedValue(null); // fresh
    const { POST } = await import(`${BASE}/funding/route`);
    const res = await POST(post({ funding: "trickle" }), call);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ funding: "trickle", startedTurn: 42 });
    expect(db.collectionMocks.covertNuclearPrograms.updateOne).toHaveBeenCalledWith(
      { _id: "DD" },
      { $set: expect.objectContaining({ funding: "trickle", startedTurn: 42 }) },
      { upsert: true }
    );
  });

  it("keeps the original startedTurn on later changes", async () => {
    const { POST } = await import(`${BASE}/funding/route`);
    const res = await POST(post({ funding: "crash" }), call);
    expect((await res.json()).startedTurn).toBe(5);
  });

  it("400s an unknown funding level", async () => {
    const { POST } = await import(`${BASE}/funding/route`);
    const res = await POST(post({ funding: "torrent" }), call);
    expect(res.status).toBe(400);
  });

  it("409s a completed programme", async () => {
    db.collectionMocks.covertNuclearPrograms.findOne.mockResolvedValue(
      covertDoc({ completed: true })
    );
    const { POST } = await import(`${BASE}/funding/route`);
    const res = await POST(post({ funding: "steady" }), call);
    expect(res.status).toBe(409);
  });
});

describe("POST nuclear/covert/breakout", () => {
  beforeEach(() => {
    db.collectionMocks.covertNuclearPrograms.findOne.mockResolvedValue(
      covertDoc({ stage: 5, completed: true, funding: "none" })
    );
    db.collectionMocks.nuclearPrograms.findOne.mockResolvedValue(null);
    db.collectionMocks.nuclearPrograms.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.coldWarTension.findOne.mockResolvedValue(null);
  });

  it("opens the overt programme, spikes tension, shocks the board, posts news", async () => {
    const { POST } = await import(`${BASE}/breakout/route`);
    const res = await POST(post({}), call);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brokenOutTurn).toBe(42);
    expect(body.adopted["device-fission"]).toBe(42);
    expect(db.collectionMocks.nuclearPrograms.updateOne).toHaveBeenCalledWith(
      { _id: "DD" },
      {
        $set: expect.objectContaining({
          adopted: { "device-fission": 42 },
          lastTestTurn: 42,
          warheads: 0,
        }),
      },
      { upsert: true }
    );
    expect(db.collectionMocks.covertNuclearPrograms.updateOne).toHaveBeenCalledWith(
      { _id: "DD" },
      { $set: expect.objectContaining({ brokenOutTurn: 42, completed: true }) },
      { upsert: true }
    );
    // The tension ledger recorded the breakout's spike.
    const tensionWrite = db.collectionMocks.coldWarTension.updateOne.mock.calls[0];
    expect(JSON.stringify(tensionWrite)).toContain(String(BREAKOUT_TENSION_SPIKE));
    expect(db.collectionMocks.newsPosts.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ isSystem: true, category: "executive" })
    );
  });

  it("keeps existing warheads when an overt doc already exists", async () => {
    db.collectionMocks.nuclearPrograms.findOne.mockResolvedValue({
      _id: "DD",
      adopted: { "delivery-bombers": 7 },
      warheads: 4,
      productionRate: 0,
    });
    const { POST } = await import(`${BASE}/breakout/route`);
    const res = await POST(post({}), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.nuclearPrograms.updateOne).toHaveBeenCalledWith(
      { _id: "DD" },
      {
        $set: expect.objectContaining({
          adopted: { "delivery-bombers": 7, "device-fission": 42 },
          warheads: 4,
        }),
      },
      { upsert: true }
    );
  });

  it("409s while the device is not assembled", async () => {
    db.collectionMocks.covertNuclearPrograms.findOne.mockResolvedValue(covertDoc());
    const { POST } = await import(`${BASE}/breakout/route`);
    const res = await POST(post({}), call);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.nuclearPrograms.updateOne).not.toHaveBeenCalled();
  });

  it("409s a second breakout - it is once", async () => {
    db.collectionMocks.covertNuclearPrograms.findOne.mockResolvedValue(
      covertDoc({ stage: 5, completed: true, brokenOutTurn: 40 })
    );
    const { POST } = await import(`${BASE}/breakout/route`);
    const res = await POST(post({}), call);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.nuclearPrograms.updateOne).not.toHaveBeenCalled();
  });

  it("404s a country outside the covert set", async () => {
    const { POST } = await import(`${BASE}/breakout/route`);
    const res = await POST(post({}), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }),
    });
    expect(res.status).toBe(404);
  });
});
