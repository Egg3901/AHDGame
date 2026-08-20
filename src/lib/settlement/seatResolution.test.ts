import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/headOfGovernment", () => ({ findCountryHeadedBy: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

describe("resolveSettlementSeat", () => {
  let db: MockDb;
  const characterId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { findCountryHeadedBy } = await import("@/lib/api/headOfGovernment");
    vi.mocked(findCountryHeadedBy).mockResolvedValue(null);
  });

  it("claims the seat for a head of government of a seat country", async () => {
    const { findCountryHeadedBy } = await import("@/lib/api/headOfGovernment");
    vi.mocked(findCountryHeadedBy).mockResolvedValue("DD");
    const { resolveSettlementSeat } = await import("./seatResolution");
    await expect(resolveSettlementSeat(db as unknown as Db, characterId)).resolves.toEqual({
      seatId: "DD",
      role: "headOfGovernment",
    });
  });

  it("claims the seat for a foreign minister of a seat country", async () => {
    prime(db, "cabinetMembers").findOne.mockResolvedValue({
      countryId: "UK",
      positionId: "foreign_secretary",
      characterId,
    });
    const { resolveSettlementSeat } = await import("./seatResolution");
    await expect(resolveSettlementSeat(db as unknown as Db, characterId)).resolves.toEqual({
      seatId: "UK",
      role: "foreignMinister",
    });
  });

  it("prefers the head-of-government claim when a character somehow holds both", async () => {
    const { findCountryHeadedBy } = await import("@/lib/api/headOfGovernment");
    vi.mocked(findCountryHeadedBy).mockResolvedValue("US");
    prime(db, "cabinetMembers").findOne.mockResolvedValue({
      countryId: "US",
      positionId: "secretary_of_state",
      characterId,
    });
    const { resolveSettlementSeat } = await import("./seatResolution");
    const claim = await resolveSettlementSeat(db as unknown as Db, characterId);
    expect(claim).toEqual({ seatId: "US", role: "headOfGovernment" });
  });

  it("returns null for a head of government of a country with no seat", async () => {
    // Japan, Ireland, France… lead countries but hold no delegation here.
    const { findCountryHeadedBy } = await import("@/lib/api/headOfGovernment");
    vi.mocked(findCountryHeadedBy).mockResolvedValue("JP");
    const { resolveSettlementSeat } = await import("./seatResolution");
    await expect(resolveSettlementSeat(db as unknown as Db, characterId)).resolves.toBeNull();
  });

  it("returns null for an ordinary character", async () => {
    const { resolveSettlementSeat } = await import("./seatResolution");
    await expect(resolveSettlementSeat(db as unknown as Db, characterId)).resolves.toBeNull();
  });

  it("looks the foreign-affairs seats up in a single query", async () => {
    const cabinet = prime(db, "cabinetMembers");
    const { resolveSettlementSeat } = await import("./seatResolution");
    await resolveSettlementSeat(db as unknown as Db, characterId);
    expect(cabinet.findOne).toHaveBeenCalledTimes(1);
  });

  it("scopes that query to the four seat countries and their own position ids", async () => {
    const cabinet = prime(db, "cabinetMembers");
    const { resolveSettlementSeat } = await import("./seatResolution");
    await resolveSettlementSeat(db as unknown as Db, characterId);
    const filter = cabinet.findOne.mock.calls[0][0];
    expect(filter.characterId).toBe(characterId);
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { countryId: "US", positionId: "secretary_of_state" },
        { countryId: "UK", positionId: "foreign_secretary" },
        { countryId: "RU", positionId: "minister_of_foreign_affairs" },
        { countryId: "DD", positionId: "minister_of_foreign_affairs" },
      ])
    );
    expect(filter.$or).toHaveLength(4);
  });

  it("pairs country to position rather than crossing the two lists", async () => {
    // RU and DD share `minister_of_foreign_affairs`, so an `$in` on each field
    // would also match pairings that do not exist, e.g. US + that id.
    const cabinet = prime(db, "cabinetMembers");
    const { resolveSettlementSeat } = await import("./seatResolution");
    await resolveSettlementSeat(db as unknown as Db, characterId);
    const filter = cabinet.findOne.mock.calls[0][0];
    expect(filter.$or).not.toContainEqual({
      countryId: "US",
      positionId: "minister_of_foreign_affairs",
    });
  });

  it("does not match a vacant or NPP-held cabinet seat", async () => {
    // Those rows carry a null characterId, so the query itself excludes them —
    // the mock returning null is what a real query would do.
    prime(db, "cabinetMembers").findOne.mockResolvedValue(null);
    const { resolveSettlementSeat } = await import("./seatResolution");
    await expect(resolveSettlementSeat(db as unknown as Db, characterId)).resolves.toBeNull();
  });
});
