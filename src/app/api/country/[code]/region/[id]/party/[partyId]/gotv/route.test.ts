import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});

function makeRequest() {
  return new Request("http://localhost/api/country/us/region/CA/party/1/gotv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gotvBudgetPercent: 10 }),
  });
}

describe("POST gotv cross-country guard", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("statePartyOrg");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Spender",
      chairId: new ObjectId(),
    } as never);
  });

  it("rejects a cross-country actor with 403 (admins included)", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "ccpChair",
        isAdmin: true,
        character: { _id: new ObjectId(), name: "Jiang Zemin", countryId: "CN" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/another country/i);
  });
});
