import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

async function callPost(code: string, regionId: string, body: Record<string, unknown>) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://t/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code, id: regionId }) }
  );
}

describe("POST region assign-seat — config-driven", () => {
  let db: MockDb;
  const charId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("electedOfficials");
    db.collection("characters");
    db.collection("npps");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);

    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "CN-XB",
      countryId: "CN",
      name: "Xibei",
      houseDistricts: 320,
      stateSenateSeats: 232,
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: charId,
      name: "Cai Min",
      party: "NPP",
    });
    // No existing officials by default (find → [], findOne → null).
    db.collectionMocks.electedOfficials!.find.mockReturnValue(cursor([]));
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null);
  });

  it("assigns CN NPC delegate seats (multi lower chamber): inserts npcDelegate official + sets currentOffice", async () => {
    const res = await callPost("cn", "CN-XB", {
      seatType: "npcDelegate",
      entityId: charId.toHexString(),
      entityType: "player",
      seatsToAssign: 5,
    });
    expect(res.status).toBe(200);

    const inserted = db.collectionMocks.electedOfficials!.insertOne.mock.calls[0][0];
    // countryId must be stamped — the JP/IE/DE exec hubs query electedOfficials
    // by { countryId, officeType } and would miss appointees without it.
    expect(inserted).toMatchObject({
      state: "CN-XB",
      officeType: "npcDelegate",
      seatsHeld: 5,
      countryId: "CN",
    });

    const charSet = db.collectionMocks.characters!.updateOne.mock.calls[0][1].$set;
    expect(charSet.currentOffice).toMatchObject({
      type: "npcDelegate",
      state: "CN-XB",
      seatsHeld: 5,
    });
  });

  it("rejects over-allocation against the region's seat total", async () => {
    // 320 districts, 318 already filled → only 2 vacant.
    db.collectionMocks.electedOfficials!.find.mockReturnValue(
      cursor([{ _id: "x", state: "CN-XB", officeType: "npcDelegate", seatsHeld: 318, nppId: "n" }])
    );
    const res = await callPost("cn", "CN-XB", {
      seatType: "npcDelegate",
      entityId: charId.toHexString(),
      entityType: "player",
      seatsToAssign: 5,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an office that is not appointable in this country (stateSenate on CN)", async () => {
    const res = await callPost("cn", "CN-XB", {
      seatType: "stateSenate",
      entityId: charId.toHexString(),
      entityType: "player",
      seatsToAssign: 1,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error).toLowerCase()).toContain("seat");
  });

  it("sizes CN People's Congress against CN_PEOPLES_CONGRESS_SEATS, not stateSenateSeats (bug #0853)", async () => {
    // Dongbei's elected People's Congress holds 321 seats
    // (CN_PEOPLES_CONGRESS_SEATS.DB), while stateSenateSeats=175 is the separate,
    // appointed CPPCC allocation. Assigning 300 seats must succeed against the 321
    // chamber — it would wrongly fail (only 175 available) if the cap were read
    // from stateSenateSeats.
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "DB",
      countryId: "CN",
      name: "Dongbei",
      houseDistricts: 238,
      stateSenateSeats: 175,
    });
    const res = await callPost("cn", "DB", {
      seatType: "peoplesCongress",
      entityId: charId.toHexString(),
      entityType: "player",
      seatsToAssign: 300,
    });
    expect(res.status).toBe(200);
    const inserted = db.collectionMocks.electedOfficials!.insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({ officeType: "peoplesCongress", seatsHeld: 300 });
  });

  it("governor (executive) upserts with countryId stamped on insert", async () => {
    const res = await callPost("cn", "CN-XB", {
      seatType: "governor",
      entityId: charId.toHexString(),
      entityType: "player",
    });
    expect(res.status).toBe(200);
    const call = db.collectionMocks.electedOfficials!.updateOne.mock.calls[0];
    expect(call[0]).toMatchObject({ state: "CN-XB", officeType: "governor" });
    expect(call[1].$setOnInsert).toMatchObject({ countryId: "CN", officeType: "governor" });
  });

  it("US senate still upserts a class-scoped senate official", async () => {
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      houseDistricts: 52,
      stateSenateSeats: 40,
    });
    const res = await callPost("us", "CA", {
      seatType: "senate",
      senateClass: 1,
      entityId: charId.toHexString(),
      entityType: "player",
    });
    expect(res.status).toBe(200);
    const call = db.collectionMocks.electedOfficials!.updateOne.mock.calls[0];
    expect(call[0]).toMatchObject({ state: "CA", officeType: "senate", senateClass: 1 });
  });
});
