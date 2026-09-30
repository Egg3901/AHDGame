import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getCountryConfig } from "@/lib/constants/countries";

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

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ code: "cs" }) };
const characterId = new ObjectId();
function request() {
  return new Request("http://localhost/api/country/cs/federation/proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ negotiatedCustodians: {} }),
  });
}

describe("federation proposal action", () => {
  let mem: ReturnType<typeof createInMemoryDb>;
  beforeEach(() => {
    vi.clearAllMocks();
    mem = createInMemoryDb();
    mem.seed("gameState", [
      { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 96 },
    ]);
    mem.seed("states", csRegions1991 as unknown as Record<string, unknown>[]);
    mocks.getDb.mockResolvedValue(mem as unknown as Db);
    mocks.getGameState.mockResolvedValue({
      preset: "1991-default",
      currentYear: 1992,
      currentTurn: 96,
    });
    mocks.requireBasicAuth.mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: false },
    });
    mocks.getCharacterByUserId.mockResolvedValue({ _id: characterId });
    mocks.checkLegislationFreeze.mockResolvedValue({ ok: true });
  });

  it("rejects an unseated character without opening a vote", async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(await mem.collection("bills").countDocuments({})).toBe(0);
  });

  it("opens one normal bill for a seated legislator and exposes its status", async () => {
    const chamber = getCountryConfig("CS", "1991-default").legislature.lowerChamber.key;
    const officeType = getOfficeTypeForChamber("CS", chamber, "1991-default");
    mem.seed("electedOfficials", [
      { _id: new ObjectId(), characterId, countryId: "CS", officeType },
    ]);
    const response = await POST(request(), params);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { billId: string };
    expect(ObjectId.isValid(body.billId)).toBe(true);
    const listed = await GET(
      new Request("http://localhost/api/country/cs/federation/proposal"),
      params
    );
    expect(await listed.json()).toMatchObject({
      proposal: { billId: body.billId, billStatus: "active" },
    });
    expect(await mem.collection("bills").countDocuments({})).toBe(1);
  });
});
