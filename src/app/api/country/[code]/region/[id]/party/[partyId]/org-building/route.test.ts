import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/validate", () => ({ parseJsonBody: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});
vi.mock("@/lib/db/collections", () => ({ getPartyBudgetCollection: vi.fn() }));
vi.mock("@/lib/partyBudgetGuards", () => ({
  isPartyTreasuryNegative: vi.fn(() => false),
  resetPartyBudgetSpending: vi.fn(),
  savePartyBudgetForScope: vi.fn(),
}));
vi.mock("@/lib/turn/partyOrg/presence", () => ({ checkPartyPresence: vi.fn() }));

function makeRequest() {
  return new Request("http://localhost/api/country/de/region/BY/party/2/org-building", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgBuildingPercent: 10 }),
  });
}

describe("POST org-building national-chair row bootstrap", () => {
  let db: MockDb;
  let nationalChairId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePartyOrg");
    db.collection("states");
    db.collection("adminLogs");
    nationalChairId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "natchair",
        isAdmin: false,
        // DE party 2's national chair is a DE character (matches the region).
        character: { _id: nationalChairId, name: "Nat Chair", countryId: "DE" },
      },
    } as never);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { orgBuildingPercent: 10 },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "DE",
      name: "CDU",
      chairId: nationalChairId,
    } as never);

    const { getPartyBudgetCollection } = await import("@/lib/db/collections");
    vi.mocked(getPartyBudgetCollection).mockResolvedValue({} as never);

    // State exists; no statePartyOrg row yet (CDU has none seeded in BY).
    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "BY",
      countryId: "DE",
      name: "Bayern",
    });
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);

    // Default: party has live presence in the state.
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(true);
  });

  it("creates a 0% statePartyOrg row for the national chair and saves the budget", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "de", id: "BY", partyId: "2" }),
    });
    expect(response.status).toBe(200);

    // A statePartyOrg row was persisted at organization:0 — tolerant of either
    // a direct insertOne or an upsert via the shared ensure helper.
    const insertCalls = db.collectionMocks["statePartyOrg"]!.insertOne.mock.calls;
    const upsertCalls = db.collectionMocks["statePartyOrg"]!.updateOne.mock.calls.filter(
      (c) => c[2]?.upsert === true
    );
    const createdViaInsert = insertCalls.some((c) => c[0]?.organization === 0);
    const createdViaUpsert = upsertCalls.some(
      (c) =>
        (c[1] as { $setOnInsert?: { organization?: number } })?.$setOnInsert?.organization === 0
    );
    expect(createdViaInsert || createdViaUpsert).toBe(true);

    const { savePartyBudgetForScope } = await import("@/lib/partyBudgetGuards");
    expect(savePartyBudgetForScope).toHaveBeenCalled();
  });

  it("blocks the national chair when the party has no presence in the state", async () => {
    // Presence is universal: a national chair cannot organize a state the
    // party has not entered, even though they'd pay from the national pool.
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(false);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "de", id: "BY", partyId: "2" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/presence/i);

    // No row should be bootstrapped when presence is absent.
    const upsertCalls = db.collectionMocks["statePartyOrg"]!.updateOne.mock.calls.filter(
      (c) => c[2]?.upsert === true
    );
    expect(upsertCalls.length).toBe(0);
    expect(db.collectionMocks["statePartyOrg"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a cross-country actor (403), even an admin", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "foreignAdmin",
        isAdmin: true, // admins blocked too — guard precedes auth
        // Acting on a DE region (party 2 is DE) from a US character.
        character: { _id: new ObjectId(), name: "Foreigner", countryId: "US" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "de", id: "BY", partyId: "2" }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/another country/i);
  });
});
