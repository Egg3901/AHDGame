import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getGameState: vi.fn(),
  requireBasicAuth: vi.fn(),
  getCharacterByUserId: vi.fn(),
  checkLegislationFreeze: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/gameState", () => ({ getGameState: mocks.getGameState }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.requireBasicAuth }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: mocks.getCharacterByUserId }));
vi.mock("@/lib/api/parliamentaryFreeze", () => ({
  checkLegislationFreeze: mocks.checkLegislationFreeze,
}));
// The route and proposal shell run against real in-memory collections. Only
// the replica-set session boundary is substituted here; Mongo rollback has its own gate.
vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: (body: (session: ClientSession) => Promise<unknown>) =>
    body({ inTransaction: () => true } as ClientSession),
}));
import { GET, POST } from "./route";
const params = { params: Promise.resolve({ code: "ru" }) };
const characterId = new ObjectId();
const request = (body: unknown = { kind: "presidency" }) =>
  new Request("http://localhost/api/country/ru/constitution/proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("Russian constitutional decision routes", () => {
  let mem: ReturnType<typeof createInMemoryDb>;
  beforeEach(() => {
    vi.clearAllMocks();
    mem = createInMemoryDb();
    mem.seed("countryGameStates", [
      { _id: "RU", ruSovietSuccessionSinceTurn: 48, ruProvisionalCongressSeats: 1154 },
    ]);
    mem.seed("electedOfficials", [
      { _id: new ObjectId(), characterId, countryId: "RU", officeType: "congressDeputy" },
    ]);
    mocks.getDb.mockResolvedValue(mem as unknown as Db);
    mocks.getGameState.mockResolvedValue({ preset: "1991-default", currentTurn: 129 });
    mocks.requireBasicAuth.mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toHexString(), isAdmin: false },
    });
    mocks.getCharacterByUserId.mockResolvedValue({ _id: characterId, name: "Deputy" });
    mocks.checkLegislationFreeze.mockResolvedValue({ ok: true });
  });
  it("opens independent bound bills and exposes their public state without cache", async () => {
    const first = await POST(request(), params);
    expect(first.status).toBe(201);
    const second = await POST(request({ kind: "federalAssembly" }), params);
    expect(second.status).toBe(201);
    expect((await first.json()).billId).not.toBe((await second.json()).billId);
    expect(mem.collection("bills").docs).toHaveLength(2);
    expect(mem.collection("bills").docs[0]).toMatchObject({
      status: "proposed",
      countryId: "RU",
      sponsorId: characterId,
    });
    const response = await GET(new Request("http://localhost"), params);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      decisions: [
        {
          kind: "presidency",
          seatCapacity: 1154,
          proposal: { revision: 1, billStatus: "proposed" },
        },
        {
          kind: "federalAssembly",
          seatCapacity: 1154,
          proposal: { revision: 1, billStatus: "proposed" },
        },
      ],
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty("ruPresidencySinceTurn");
  });
  it.each(["unionCongressDeputy", "dumaDeputy", "president"])(
    "rejects obsolete or inactive office %s",
    async (officeType) => {
      mem.collection("electedOfficials").docs[0].officeType = officeType;
      expect((await POST(request(), params)).status).toBe(403);
      expect(mem.collection("bills").docs).toHaveLength(0);
    }
  );
  it("rejects invented mandate fields and premature Assembly decisions", async () => {
    expect((await POST(request({ kind: "presidency", certified: true }), params)).status).toBe(400);
    mocks.getGameState.mockResolvedValue({ preset: "1991-default", currentTurn: 128 });
    expect((await POST(request({ kind: "federalAssembly" }), params)).status).toBe(409);
    expect(mem.collection("bills").docs).toHaveLength(0);
  });
  it("opens separate statutory Council formation bills only after their date and Assembly seating", async () => {
    mocks.getGameState.mockResolvedValue({ preset: "1991-default", currentTurn: 237 });
    const country = mem.collection("countryGameStates").docs[0];
    country.ruFederalAssemblySinceTurn = 145;
    mem.collection("electedOfficials").docs[0].officeType = "dumaDeputy";
    expect((await POST(request({ kind: "regionalHeads" }), params)).status).toBe(201);
    expect((await POST(request({ kind: "regionalDelegates" }), params)).status).toBe(409);
    expect(mem.collection("bills").docs).toHaveLength(1);
    expect(mem.collection("bills").docs[0]).toMatchObject({
      russianCouncilFormationMandate: { mode: "regionalHeads", revision: 1 },
    });
    expect(country).not.toHaveProperty("ruCouncilComposition");
    const response = await GET(new Request("http://localhost"), params);
    const body = await response.json();
    expect(body.decisions).toContainEqual(
      expect.objectContaining({ kind: "regionalHeads", threshold: "majority", seatCapacity: 450 })
    );
  });
  it("preserves the government formation freeze", async () => {
    mocks.checkLegislationFreeze.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 409 }),
    });
    expect((await POST(request(), params)).status).toBe(409);
    expect(mem.collection("bills").docs).toHaveLength(0);
  });
  it("requires authentication for public state and rejects other eras", async () => {
    mocks.requireBasicAuth.mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    expect((await GET(new Request("http://localhost"), params)).status).toBe(401);
    mocks.getGameState.mockResolvedValue({ preset: "1953-default", currentTurn: 129 });
    expect((await POST(request(), params)).status).toBe(409);
  });
});
