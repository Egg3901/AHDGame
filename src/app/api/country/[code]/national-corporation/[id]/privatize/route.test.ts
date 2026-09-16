import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stubMarketizationDb } from "@/lib/test-utils/stubMarketizationDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(900) }));
vi.mock("@/lib/nationalization/authority", () => ({ assertTreasuryAuthority: vi.fn() }));
vi.mock("@/lib/turn/stockExchangeSnapshot", () => ({
  generateStockExchangeSnapshots: vi.fn().mockResolvedValue(undefined),
}));

const characterId = new ObjectId();
const sourceCorpId = new ObjectId();

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/privatize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  selections: [{ sectorId: new ObjectId().toHexString(), carveFraction: 1 }],
  newCorpName: "Soviet Spin Out",
  goldenSharePercent: 0,
  method: "ipo" as const,
};

async function callRoute(countryId: string, db: Db) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db);
  const { POST } = await import("./route");
  return POST(makeRequest(validBody), {
    params: Promise.resolve({ code: countryId.toLowerCase(), id: sourceCorpId.toHexString() }),
  });
}

describe("POST privatize - command economy gate", () => {
  let mock: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    mock = createMockDb();
    for (const n of ["corporations", "corporateSectors"]) mock.collection(n);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "minister",
        isAdmin: false,
        character: { _id: characterId, name: "Finance Minister" },
      },
    } as never);
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true as never);
  });

  it("refuses with 403 in a command economy", async () => {
    const db = stubMarketizationDb({ currentYear: 1970, base: mock as unknown as Db });
    const res = await callRoute("RU", db);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("command economy");
  });

  it("refuses in China, which is dial-governed and never carried a config flag", async () => {
    const db = stubMarketizationDb({ currentYear: 1970, base: mock as unknown as Db });
    const res = await callRoute("CN", db);
    expect(res.status).toBe(403);
  });

  it("refuses before consulting treasury authority", async () => {
    // A player in a command economy should be told the mechanic does not exist
    // there, not that they hold the wrong office.
    const db = stubMarketizationDb({ currentYear: 1970, base: mock as unknown as Db });
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    await callRoute("RU", db);
    expect(assertTreasuryAuthority).not.toHaveBeenCalled();
  });

  it("does not refuse a market economy on command-economy grounds", async () => {
    const db = stubMarketizationDb({ currentYear: 1970, base: mock as unknown as Db });
    mock.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const res = await callRoute("US", db);
    // 404 (no National Corporation in this stub) proves the gate let it through.
    expect(res.status).toBe(404);
  });

  it("releases a command economy once its dial crosses the ceiling", async () => {
    const db = stubMarketizationDb({
      currentYear: 1970,
      levels: { RU: 55 },
      base: mock as unknown as Db,
    });
    mock.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const res = await callRoute("RU", db);
    expect(res.status).toBe(404);
  });
});
