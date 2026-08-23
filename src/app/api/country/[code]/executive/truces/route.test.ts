import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));

const trucesSpy = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/military/truce", () => ({
  listActiveTruces: (...a: unknown[]) => trucesSpy(...a),
}));

let db: MockDb;

const params = { params: Promise.resolve({ code: "us" }) };
const req = () => new Request("http://x/api/country/us/executive/truces");

/** Seat `countries` in `orgId` on the live roll the panel's alliance bar reads. */
function allyRoll(orgId: string, countries: string[], preset = "1953-default") {
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    conflictsEnabled: true,
    currentTurn: 40,
    preset,
  });
  db.collectionMocks.organizationMemberships.find.mockReturnValue({
    toArray: async () => countries.map((countryId) => ({ organizationId: orgId, countryId })),
  });
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const c of ["gameState", "organizationMemberships"]) db.collection(c);
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    conflictsEnabled: true,
    currentTurn: 40,
  });
  trucesSpy.mockResolvedValue([]);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: new ObjectId(), name: "P", party: null } },
  } as never);
});

describe("GET truces", () => {
  it("returns the live truces binding this country", async () => {
    trucesSpy.mockResolvedValue([{ other: "CN", expiresTurn: 88 }]);
    const { GET } = await import("./route");
    const body = await (await GET(req(), params)).json();
    expect(body.truces).toEqual([{ other: "CN", expiresTurn: 88 }]);
    expect(body.currentTurn).toBe(40);
  });

  it("404s when the conflicts subsystem is off", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { GET } = await import("./route");
    expect((await GET(req(), params)).status).toBe(404);
  });

  it("400s on a country code that does not exist", async () => {
    const { GET } = await import("./route");
    const res = await GET(req(), { params: Promise.resolve({ code: "zz" }) });
    expect(res.status).toBe(400);
  });
});

describe("GET truces — the alliance bar", () => {
  // The panel greys these in the picker, so the bar is stated up front rather than
  // discovered by filing a declaration and being refused.
  it("names the alliance and lists the fellow members it bars", async () => {
    allyRoll("NATO", ["US", "UK", "DE"]);
    const { GET } = await import("./route");
    const body = await (await GET(req(), params)).json();
    expect(body.alliance).toBe("North Atlantic Treaty Organization");
    expect(new Set(body.allies)).toEqual(new Set(["UK", "DE"]));
  });

  it("never lists the country itself as its own ally", async () => {
    allyRoll("NATO", ["US", "UK"]);
    const { GET } = await import("./route");
    const body = await (await GET(req(), params)).json();
    expect(body.allies).not.toContain("US");
  });

  it("bars nobody for a non-aligned country", async () => {
    // US in no accession org: non-alignment is the absence of a treaty, not a treaty.
    allyRoll("WARSAW_PACT", ["RU", "DD"]);
    const { GET } = await import("./route");
    const body = await (await GET(req(), params)).json();
    expect(body.alliance).toBeNull();
    expect(body.allies).toEqual([]);
  });
});
