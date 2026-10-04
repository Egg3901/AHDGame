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
vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: (body: (session: ClientSession) => Promise<unknown>) =>
    body({ inTransaction: () => true } as ClientSession),
}));
import { GET, POST } from "./route";
const params = { params: Promise.resolve({ code: "hu" }) };
const characterId = new ObjectId();
const request = (body: unknown = { kind: "threshold1994" }) =>
  new Request("http://localhost/api/country/hu/electoral-reform/proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Hungarian electoral proposal routes", () => {
  let mem: ReturnType<typeof createInMemoryDb>;
  beforeEach(() => {
    vi.clearAllMocks();
    mem = createInMemoryDb();
    mem.seed("gameState", [{ _id: "current", preset: "1991-default", currentTurn: 145 }]);
    mem.seed("countryState", [{ _id: "HU", governmentType: "parliamentaryRepublic" }]);
    mem.seed("countryGameStates", [{ _id: "HU" }]);
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        characterId,
        countryId: "HU",
        officeType: "assemblyDelegate",
        seatsHeld: 1,
        party: "1",
      },
    ]);
    mocks.getDb.mockResolvedValue(mem as unknown as Db);
    mocks.getGameState.mockResolvedValue({ preset: "1991-default", currentTurn: 145 });
    mocks.requireBasicAuth.mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toHexString(), isAdmin: false },
    });
    mocks.getCharacterByUserId.mockResolvedValue({ _id: characterId, name: "Synthetic Deputy" });
    mocks.checkLegislationFreeze.mockResolvedValue({ ok: true });
  });
  it("opens one bound parliamentary bill and shows public state without caching", async () => {
    const first = await POST(request(), params);
    const second = await POST(request(), params);
    expect(first.status).toBe(201);
    expect((await first.json()).billId).toBe((await second.json()).billId);
    expect(mem.collection("bills").docs).toHaveLength(1);
    expect(mem.collection("bills").docs[0]).toMatchObject({
      countryId: "HU",
      sponsorId: characterId,
      sponsorParty: "1",
      status: "proposed",
      hungarianElectoralMandate: { revision: 1, kind: "threshold1994" },
    });
    const response = await GET(new Request("http://localhost"), params);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      decision: {
        available: true,
        proposal: { revision: 1, billStatus: "proposed", canRevise: false },
      },
    });
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty(
      "huElectoralLaw1994SinceTurn"
    );
  });
  it("rejects a premature date and invented authorization fields", async () => {
    expect((await POST(request({ kind: "threshold1994", approved: true }), params)).status).toBe(
      400
    );
    mocks.getGameState.mockResolvedValue({ preset: "1991-default", currentTurn: 144 });
    expect((await POST(request(), params)).status).toBe(409);
    expect(mem.collection("bills").docs).toHaveLength(0);
  });
  it.each(["president", "primeMinister", "senator"])(
    "refuses the %s office without a deputy mandate",
    async (officeType) => {
      mem.collection("electedOfficials").docs[0].officeType = officeType;
      expect((await POST(request(), params)).status).toBe(403);
    }
  );
  it("respects government freeze and a changed one-party settlement", async () => {
    mocks.checkLegislationFreeze.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 409 }),
    });
    expect((await POST(request(), params)).status).toBe(409);
    mocks.checkLegislationFreeze.mockResolvedValue({ ok: true });
    mem.collection("countryState").docs[0].governmentType = "onePartyState";
    expect((await POST(request(), params)).status).toBe(409);
    expect(mem.collection("bills").docs).toHaveLength(0);
  });
  it("preserves a modern alternate-history settlement even with a stale caller game record", async () => {
    mem.collection("gameState").docs[0].huAssemblyReformedAtYear = 2014;
    expect((await POST(request(), params)).status).toBe(409);
    expect(
      (await (await GET(new Request("http://localhost"), params)).json()).decision.reason
    ).toBe("modern-law-in-force");
  });
  it("allows a legislator to revise a rejected bill without overwriting its history", async () => {
    await POST(request(), params);
    mem.collection("bills").docs[0].status = "failed";
    const revised = await POST(request(), params);
    expect((await revised.json()).revision).toBe(2);
    expect(mem.collection("bills").docs).toHaveLength(2);
    expect(mem.collection("bills").docs[0].status).toBe("failed");
  });
  it("rejects another country and an unauthenticated caller", async () => {
    expect((await POST(request(), { params: Promise.resolve({ code: "PL" }) })).status).toBe(404);
    mocks.requireBasicAuth.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    expect((await GET(new Request("http://localhost"), params)).status).toBe(401);
    expect((await POST(request(), params)).status).toBe(401);
  });
});
