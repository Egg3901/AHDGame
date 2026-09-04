import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COVERAGE_DECAY_PER_TURN, OP_SLOTS_PER_TURN } from "@/lib/intelligence/config";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/cabinet/officeVisibility", () => ({
  resolveCabinetOfficeVisibility: vi.fn(),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { resolveCabinetOfficeVisibility } = await import("@/lib/cabinet/officeVisibility");

const HOLDER = "char_holder";
const TURN = 10;

const call = (positionId = "director_of_intelligence", code = "us") => ({
  params: Promise.resolve({ code, positionId }),
});

let db: MockDb;

/** The route's return type is nullable through its guard union; tests need a value. */
async function get(positionId?: string, code?: string) {
  const { GET } = await import("./route");
  const res = await GET(new Request("http://t"), call(positionId, code));
  if (!res) throw new Error("route returned no response");
  return res;
}

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

function allow(canView: boolean, canAct: boolean) {
  vi.mocked(resolveCabinetOfficeVisibility).mockResolvedValue({ canView, canAct } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: HOLDER }, userId: "u1" },
  } as never);
  allow(true, true);

  db.collection("gameState");
  db.collection("cabinetMembers");
  db.collection("intelligenceAgencies");
  db.collection("intelligenceNetworks");
  db.collection("intelligenceCoverage");
  db.collection("intelligenceOpLog");

  db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: TURN });
  db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
    _id: "m1",
    countryId: "US",
    positionId: "director_of_intelligence",
    characterId: HOLDER,
  });
  db.collectionMocks.intelligenceAgencies.findOne.mockResolvedValue({
    _id: "a1",
    countryId: "US",
    directorCharacterId: HOLDER,
    tradecraft: 5,
    counterIntel: 20,
    budgetRemaining: 500_000,
    opSlots: { turn: TURN, remaining: 1 },
    foundedTurn: 1,
  });
  db.collectionMocks.intelligenceNetworks.find.mockReturnValue(cursor([]));
  db.collectionMocks.intelligenceCoverage.find.mockReturnValue(cursor([]));
  db.collectionMocks.intelligenceOpLog.find.mockReturnValue(cursor([]));
});

describe("GET intelligence console", () => {
  it("404s on a position that is not the intelligence seat", async () => {
    const res = await get("secretary_of_defense");
    expect(res.status).toBe(404);
  });

  it("400s on an unknown country", async () => {
    const res = await get("director_of_intelligence", "zz");
    expect(res.status).toBe(400);
  });

  it("401s when the caller is not signed in", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("403s an outsider who may not view the office", async () => {
    allow(false, false);
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("serves the console to the seat holder", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agency.tradecraft).toBe(5);
    expect(body.slotsRemaining).toBe(1);
    expect(body.turn).toBe(TURN);
  });

  it("opens to a viewer who may read the office but not act in it", async () => {
    // A head of government can open the office; the GET must follow the office
    // visibility rule rather than the mutation rule, or they hit a 403 inside.
    allow(true, false);
    expect((await get()).status).toBe(200);
  });

  it("serves DERIVED coverage, not the stored reading", async () => {
    db.collectionMocks.intelligenceCoverage.find.mockReturnValue(
      cursor([
        {
          ownerCountryId: "US",
          targetCountryId: "RU",
          domain: "military",
          valueAtCollection: 100,
          lastCollectedTurn: 0,
        },
      ])
    );
    const body = await (await get()).json();
    // Collected on turn 0, read on turn 10: the console must show what an
    // operation would actually be judged on, not the stale stored figure.
    expect(body.coverage[0].value).toBe(100 - COVERAGE_DECAY_PER_TURN * TURN);
  });

  it("NEVER serves rollDetail, which would publish the odds behind every operation", async () => {
    db.collectionMocks.intelligenceOpLog.find.mockReturnValue(
      cursor([
        {
          targetCountryId: "RU",
          domain: "military",
          opType: "assess",
          outcome: "success",
          compromise: "clean",
          effectSummary: "The station filed a usable report.",
          turn: 9,
          rollDetail: { successRoll: 0.01, compromiseRoll: 0.99, counterIntel: 20 },
        },
      ])
    );
    const res = await get();
    const raw = await res.text();

    expect(raw).not.toContain("rollDetail");
    expect(raw).not.toContain("successRoll");
    const body = JSON.parse(raw);
    expect(body.incidents[0].outcome).toBe("success");
    expect(body.incidents[0].rollDetail).toBeUndefined();
  });

  it("reports a full budget for a stale slot row rather than a spent one", async () => {
    db.collectionMocks.intelligenceAgencies.findOne.mockResolvedValue({
      _id: "a1",
      countryId: "US",
      directorCharacterId: HOLDER,
      tradecraft: 5,
      counterIntel: 20,
      budgetRemaining: 0,
      opSlots: { turn: TURN - 3, remaining: 0 },
      foundedTurn: 1,
    });
    const body = await (await get()).json();
    expect(body.slotsRemaining).toBe(OP_SLOTS_PER_TURN);
  });
});
