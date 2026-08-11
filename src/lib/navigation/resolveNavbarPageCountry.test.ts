import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resolveNavbarPageCountry } from "./resolveNavbarPageCountry";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("resolveNavbarPageCountry", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("states");
    db.collection.mockClear();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("prefers explicit query-country search params", async () => {
    await expect(
      resolveNavbarPageCountry({ pathname: "/news", search: "?country=jp" })
    ).resolves.toBe("JP");
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("resolves country-scoped routes without database lookups", async () => {
    await expect(resolveNavbarPageCountry({ pathname: "/country/de/policy" })).resolves.toBe("DE");
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("resolves corporation pages from the corporation country", async () => {
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      sequentialId: 37,
      countryId: "UK",
    });

    await expect(resolveNavbarPageCountry({ pathname: "/corporation/37" })).resolves.toBe("UK");
  });

  it("prefers the sector country over the corporation fallback", async () => {
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      sequentialId: 37,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue({
      _id: new ObjectId("507f191e810c19729de860ea"),
      corporationId: new ObjectId("507f1f77bcf86cd799439011"),
      countryId: "JP",
      stateId: "TOK",
    });

    await expect(
      resolveNavbarPageCountry({ pathname: "/corporation/37/sector/507f191e810c19729de860ea" })
    ).resolves.toBe("JP");
  });

  it("falls back to the sector state country when the sector lacks countryId", async () => {
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      sequentialId: 37,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue({
      _id: new ObjectId("507f191e810c19729de860ea"),
      corporationId: new ObjectId("507f1f77bcf86cd799439011"),
      stateId: "BAV",
    });
    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "BAV",
      countryId: "DE",
    });

    await expect(
      resolveNavbarPageCountry({ pathname: "/corporation/37/sector/507f191e810c19729de860ea" })
    ).resolves.toBe("DE");
  });
});
