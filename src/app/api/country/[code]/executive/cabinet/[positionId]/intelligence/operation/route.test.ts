import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/cabinet/officeVisibility", () => ({
  resolveCabinetOfficeVisibility: vi.fn(),
}));
vi.mock("@/lib/api/requireConfirmedSecretary", () => ({
  requireConfirmedSecretary: vi.fn(() => null),
}));
vi.mock("@/lib/intelligence/runOperation", () => ({ runOperation: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getCountryAccessFromDb: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { resolveCabinetOfficeVisibility } = await import("@/lib/cabinet/officeVisibility");
const { requireConfirmedSecretary } = await import("@/lib/api/requireConfirmedSecretary");
const { runOperation } = await import("@/lib/intelligence/runOperation");
const { getCountryAccessFromDb } = await import("@/lib/countryAccess");

const HOLDER = "char_holder";

const call = (positionId = "director_of_intelligence", code = "us") => ({
  params: Promise.resolve({ code, positionId }),
});

let db: MockDb;

function post(body: unknown) {
  return new Request("http://t", { method: "POST", body: JSON.stringify(body) });
}

/** The route's return type is nullable through its guard union; tests need a value. */
async function run(body: unknown, positionId?: string, code?: string) {
  const { POST } = await import("./route");
  const res = await POST(post(body), call(positionId, code));
  if (!res) throw new Error("route returned no response");
  return res;
}

const VALID = {
  targetCountryId: "RU",
  domain: "military",
  kind: "collect",
  opType: "assess",
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: HOLDER }, userId: "u1" },
  } as never);
  vi.mocked(resolveCabinetOfficeVisibility).mockResolvedValue({
    canView: true,
    canAct: true,
  } as never);
  vi.mocked(requireConfirmedSecretary).mockReturnValue(null);
  vi.mocked(getCountryAccessFromDb).mockResolvedValue({ registered: true } as never);
  vi.mocked(runOperation).mockResolvedValue({
    ok: true,
    outcome: "success",
    compromise: "attributed",
    coverage: 25,
    networkLevel: 2,
    networkStatus: "burned",
    message: "The station filed a usable report.",
  } as never);

  db.collection("gameState");
  db.collection("cabinetMembers");
  db.collection("intelligenceAgencies");
  db.collection("characters");
  db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 10 });
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
    budgetRemaining: 5_000_000,
    opSlots: { turn: 10, remaining: 2 },
    foundedTurn: 1,
  });
  db.collectionMocks.characters.findOne.mockResolvedValue({
    stats: { intellect: 7, statecraft: 6 },
  });
});

describe("POST intelligence operation", () => {
  it("404s on a position that is not the intelligence seat", async () => {
    expect((await run(VALID, "secretary_of_defense")).status).toBe(404);
  });

  it("403s when the caller may not act in the office", async () => {
    vi.mocked(resolveCabinetOfficeVisibility).mockResolvedValue({
      canView: true,
      canAct: false,
    } as never);
    expect((await run(VALID)).status).toBe(403);
  });

  it("403s an acting director, whose scope bars pointing the service", async () => {
    vi.mocked(requireConfirmedSecretary).mockReturnValue(
      new Response(null, { status: 403 }) as never
    );
    expect((await run(VALID)).status).toBe(403);
    expect(runOperation).not.toHaveBeenCalled();
  });

  it("400s on an unknown domain", async () => {
    const res = await run({ ...VALID, domain: "political" });
    // Political is not a domain, deliberately: espionage targets state
    // capability, never another player's political career.
    expect(res.status).toBe(400);
  });

  it("400s on an unknown target country", async () => {
    expect((await run({ ...VALID, targetCountryId: "zz" })).status).toBe(400);
  });

  it("404s a target country that has been dissolved out of the registry", async () => {
    // COUNTRY_CONFIGS is static and keeps a merged country forever, so checking
    // it alone would let a service work inside a state that no longer exists and
    // quietly recreate the rows the dissolution purge just deleted.
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({ registered: false } as never);
    expect((await run(VALID)).status).toBe(404);
    expect(runOperation).not.toHaveBeenCalled();
  });

  it("400s an operation aimed at your own country", async () => {
    expect((await run({ ...VALID, targetCountryId: "US" })).status).toBe(400);
  });

  it("passes the resolved director stat multiplier through", async () => {
    await run(VALID);
    const args = vi.mocked(runOperation).mock.calls[0][0];
    // intellect 7 + statecraft 6 => mean 6.5, one point above the 5.5 pivot.
    expect(args.statMultiplier).toBeCloseTo(1.04, 5);
    expect(args.targetCountryId).toBe("RU");
  });

  it("resolves a vacant seat at the neutral multiplier rather than refusing", async () => {
    // Genuinely vacant: no cabinet member AND no stored director. Setting only
    // the stored field would be re-synced back from the live seat holder, which
    // is the staleness guard doing its job.
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collectionMocks.intelligenceAgencies.findOne.mockResolvedValue({
      _id: "a1",
      countryId: "US",
      directorCharacterId: null,
      tradecraft: 5,
      counterIntel: 20,
      budgetRemaining: 5_000_000,
      opSlots: { turn: 10, remaining: 2 },
      foundedTurn: 1,
    });
    expect((await run(VALID)).status).toBe(200);
    expect(vi.mocked(runOperation).mock.calls[0][0].statMultiplier).toBe(1);
  });

  it("returns both axes and never the roll detail", async () => {
    const res = await run(VALID);
    const raw = await res.text();
    expect(raw).not.toContain("rollDetail");
    const body = JSON.parse(raw);
    expect(body.outcome).toBe("success");
    // Success AND attributed: the two axes are independent, and the route must
    // be able to report both at once.
    expect(body.compromise).toBe("attributed");
  });

  it("passes a refusal's status through rather than flattening it to 500", async () => {
    vi.mocked(runOperation).mockResolvedValue({
      ok: false,
      status: 429,
      error: "The service has run every operation it can this turn.",
    } as never);
    const res = await run(VALID);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("this turn");
  });
});
