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
  return new Request("http://localhost/api/country/us/region/CA/party/1/ps-spend-scope");
}

describe("GET ps-spend-scope", () => {
  let db: MockDb;
  let dualId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePartyOrg");
    db.collection("politicalParties");
    dualId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "dual",
        isAdmin: false,
        character: { _id: dualId, name: "Dual", countryId: "US" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Spender",
      chairId: dualId, // national chair
      viceChairId: new ObjectId(),
      politicalStrength: 540,
    } as never);

    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: dualId, // state chair too → dual
      politicalStrength: 120,
    });
  });

  it("returns dual eligibility and both pool balances", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.eligibleScopes).toEqual({ state: true, national: true });
    expect(body.statePoolPS).toBe(120);
    expect(body.nationalPoolPS).toBe(540);
  });

  it("rejects a cross-country viewer", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "abroad",
        isAdmin: false,
        character: { _id: new ObjectId(), name: "Abroad", countryId: "CN" },
      },
    } as never);
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("cross-country");
  });

  it("state-only chair → { state:true, national:false }", async () => {
    const stateOnlyId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "stateonly",
        isAdmin: false,
        character: { _id: stateOnlyId, name: "State Only", countryId: "US" },
      },
    } as never);
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: stateOnlyId,
      politicalStrength: 50,
    });
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    const body = await res.json();
    expect(body.eligibleScopes).toEqual({ state: true, national: false });
  });

  // Admin eligibility is role-based (fixed commit 59978b832) — no blanket override.
  it("admin with no party role → { state:false, national:false }", async () => {
    const adminId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "admin-no-role",
        isAdmin: true,
        character: { _id: adminId, name: "Admin No Role", countryId: "US" },
      },
    } as never);
    // statePartyOrg row belongs to someone else; national party chair is someone else
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: new ObjectId(), // not adminId
      politicalStrength: 50,
    });
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Spender",
      chairId: new ObjectId(), // not adminId
      viceChairId: new ObjectId(),
      politicalStrength: 540,
    } as never);
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    const body = await res.json();
    expect(body.eligibleScopes).toEqual({ state: false, national: false });
  });

  it("admin who is national chair → { state:false, national:true }", async () => {
    const adminChairId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "admin-nat-chair",
        isAdmin: true,
        character: { _id: adminChairId, name: "Admin Nat Chair", countryId: "US" },
      },
    } as never);
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: new ObjectId(), // not adminChairId — no state role
      politicalStrength: 50,
    });
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Spender",
      chairId: adminChairId, // IS national chair
      viceChairId: new ObjectId(),
      politicalStrength: 540,
    } as never);
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    const body = await res.json();
    expect(body.eligibleScopes).toEqual({ state: false, national: true });
  });

  it("admin who is national chair + state chair → { state:true, national:true }", async () => {
    const adminDualId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "admin-dual",
        isAdmin: true,
        character: { _id: adminDualId, name: "Admin Dual", countryId: "US" },
      },
    } as never);
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: adminDualId, // IS state chair
      politicalStrength: 50,
    });
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Spender",
      chairId: adminDualId, // IS national chair
      viceChairId: new ObjectId(),
      politicalStrength: 540,
    } as never);
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    const body = await res.json();
    expect(body.eligibleScopes).toEqual({ state: true, national: true });
  });
});
