import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/battle/forecast/route";

const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };
// East Germany's defence seat — the viewer in the eastern-belligerent regression below.
const ddCall = { params: Promise.resolve({ code: "dd", positionId: "minister_of_defence" }) };
const req = (qs: string) => new Request(`http://x/api/x/battle/forecast?${qs}`);

let seq = 0;
function unit(over: Record<string, unknown> = {}) {
  return {
    _id: `u${seq++}`,
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "Div",
    type: "Armored Division",
    icon: "tank",
    basePower: 92,
    personnel: 15000,
    upkeepBase: 180,
    posture: "standard",
    techTier: 2,
    vet: 1,
    xp: 0,
    readiness: 70,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "afghan",
    assignedGeneralId: null,
    createdTurn: 1,
    ...over,
  };
}

/** The default live conflict. Sides are overridden per test to move the rosters. */
const CONFLICT = {
  _id: "afghan",
  name: "Central Asian Front",
  hostCountry: "RU",
  region: "cas",
  terrain: "Arid / mountainous",
  bloc: "contested",
  severity: "HIGH",
  baseStrength: 470,
  terr: 1.15,
  infra: 34,
  enemyMix: ["armor", "mech"],
  sideA: { label: "A", countries: ["US"], kind: "state" },
  sideB: { label: "B", countries: ["CN"], kind: "state" },
};

describe("battle forecast route", () => {
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
    db.collection("militaryFormations");
    db.collection("nationalDoctrine");
    db.collection("conflicts");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: true,
      currentTurn: 40,
    });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    // No theater commander designated — the defense holder retains authority.
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(CONFLICT);
    // Both nations have forces at the front by default. The route now loads the whole
    // front in one query (the defence pools allies), so serve the theater shape too.
    db.collectionMocks.militaryUnits.find.mockImplementation(
      (q: { countryId?: string; theaterId?: string } = {}) => {
        const docs = q.theaterId
          ? [
              unit({ countryId: "US", theaterId: q.theaterId }),
              unit({ countryId: "CN", theaterId: q.theaterId }),
            ]
          : [unit({ countryId: q.countryId ?? "US", theaterId: "afghan" })];
        return { toArray: vi.fn().mockResolvedValue(docs) };
      }
    );
  });

  it("returns odds, own strength, supply and a coarse enemy band", async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=CN"), call);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.oddsPct).toBe("number");
    expect(body.ownStrength).toBeGreaterThan(0);
    expect(typeof body.enemyBand).toBe("string");
    expect(body.unopposed).toBe(false);
  });

  // Fog: the payload must never carry the opponent's roster or strength.
  it("leaks no enemy roster or enemy strength", async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=CN"), call);
    const body = await res.json();
    expect(body).not.toHaveProperty("defStr");
    expect(body).not.toHaveProperty("enemy");
    expect(body).not.toHaveProperty("enemyUnits");
    expect(body).not.toHaveProperty("defenderProfile");
    expect(JSON.stringify(body)).not.toMatch(/Armored Division/);
  });

  it("flags an undefended front as unopposed", async () => {
    db.collectionMocks.militaryUnits.find.mockImplementation((q: { countryId: string }) => ({
      toArray: vi
        .fn()
        .mockResolvedValue(
          q.countryId === "US"
            ? [unit({ countryId: "US", theaterId: "afghan" })]
            : [unit({ countryId: "CN", theaterId: "reserve" })]
        ),
    }));
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=CN"), call);
    const body = await res.json();
    expect(body.unopposed).toBe(true);
    expect(body.enemyBand).toBe("No forces detected");
  });

  it("returns the defensive projection alongside the offensive one", async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=CN"), call);
    const body = await res.json();
    expect(typeof body.counterOddsPct).toBe("number");
    expect(body.counterOddsPct).toBeGreaterThanOrEqual(0);
    expect(body.counterOddsPct).toBeLessThanOrEqual(100);
  });

  // Terrain favours whoever defends, so the two projections are NOT complementary:
  // with equal forces both sides can project themselves under 50%.
  it("does not merely mirror the offensive odds", async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=CN"), call);
    const body = await res.json();
    expect(body.oddsPct + body.counterOddsPct).not.toBe(100);
  });

  // Fog is unchanged: the counter-projection is derived from sides already built.
  it("still leaks no enemy strength with the counter-projection present", async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=CN"), call);
    const body = await res.json();
    expect(body).not.toHaveProperty("defStr");
    expect(body).not.toHaveProperty("defenderProfile");
    expect(JSON.stringify(body)).not.toMatch(/Armored Division/);
  });

  it("400s an unknown conflict", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { GET } = await import(ROUTE);
    expect((await GET(req("theaterId=ghost&targetCountry=CN"), call)).status).toBe(400);
  });

  it("400s a target that is not a belligerent in this conflict", async () => {
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=UK"), call);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Target is not a belligerent in this conflict",
    });
  });

  it("400s a target on the viewer's own side", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...CONFLICT,
      sideA: { label: "A", countries: ["US", "UK"], kind: "coalition" },
    });
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=UK"), call);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Target is on your own side" });
  });

  // Regression: the forecast refused on the same stale-bloc check as declare — `blocOf`
  // had no DD row and fell back to the US one — so the war room showed "Projection
  // unavailable" beside the refusal instead of odds.
  it("projects for an eastern belligerent against the western side (DD -> US)", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...CONFLICT,
      sideA: { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" },
      sideB: { label: "Warsaw Pact", countries: ["DD"], kind: "coalition", backer: "east" },
    });
    db.collectionMocks.militaryUnits.find.mockImplementation(
      (q: { countryId?: string; theaterId?: string } = {}) => ({
        toArray: vi
          .fn()
          .mockResolvedValue(
            q.theaterId
              ? [
                  unit({ countryId: "DD", theaterId: q.theaterId }),
                  unit({ countryId: "US", theaterId: q.theaterId }),
                ]
              : [unit({ countryId: q.countryId ?? "DD", theaterId: "afghan" })]
          ),
      })
    );
    const { GET } = await import(ROUTE);
    const res = await GET(req("theaterId=afghan&targetCountry=US"), ddCall);
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).oddsPct).toBe("number");
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { GET } = await import(ROUTE);
    expect((await GET(req("theaterId=afghan&targetCountry=CN"), call)).status).toBe(404);
  });

  it("403s a non-holder when no theater commander is designated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "nobody" } },
    } as never);
    const { GET } = await import(ROUTE);
    expect((await GET(req("theaterId=afghan&targetCountry=CN"), call)).status).toBe(403);
  });
});
