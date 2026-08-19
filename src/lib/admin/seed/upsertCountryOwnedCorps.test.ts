import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { upsertCountryOwnedCorpEntries } from "./upsertCountryOwnedCorps";
import type { CountryOwnedSeedData } from "@/lib/seeds/reference/budgets";

const CANONICAL_SOE = new ObjectId("700000000000000000001530");
const STALE_SOE = new ObjectId("700000000000000000000630");
const PRIMARY = new ObjectId("700000000000000000000091");
const PLAYER_CORP = new ObjectId("6a77b65918e42bc9dfb15aca");

function seedEntry(corpId: ObjectId, stateIds: string[]): CountryOwnedSeedData {
  return {
    corporation: {
      _id: corpId,
      name: "East German Automobiles Enterprise",
      countryId: "DD",
      countryOwnerId: "DD",
      type: "automobiles",
    },
    sectors: stateIds.map((stateId) => ({
      _id: new ObjectId(),
      corporationId: corpId,
      countryId: "DD",
      stateId,
      sectorType: "automobiles",
      revenue: 100,
    })),
  } as unknown as CountryOwnedSeedData;
}

/** The bare sovereign issuer: current id, but never a producing-sector owner. */
function issuerEntry(): CountryOwnedSeedData {
  return {
    corporation: {
      _id: PRIMARY,
      name: "East Germany",
      countryId: "DD",
      countryOwnerId: "DD",
      isPrimaryNationalCorporation: true,
    },
    sectors: [],
  } as unknown as CountryOwnedSeedData;
}

describe("upsertCountryOwnedCorpEntries", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    // Collection mocks are created lazily on first access.
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collectionMocks.corporations.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: CANONICAL_SOE }, { _id: STALE_SOE }, { _id: PRIMARY }]),
    });
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(0);
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("re-points a sector off a stale state-enterprise id instead of duplicating it", async () => {
    const result = await upsertCountryOwnedCorpEntries(db as unknown as Db, "DD", [
      issuerEntry(),
      seedEntry(CANONICAL_SOE, ["BEO"]),
    ]);

    expect(result.repointed).toBe(1);
    const [filter, update] = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ countryId: "DD", stateId: "BEO", sectorType: "automobiles" });
    expect(update).toEqual({ $set: { corporationId: CANONICAL_SOE } });
    // The stale enterprise AND the bare issuer are both candidates to move off.
    const staleIds = (filter.corporationId as { $in: ObjectId[] }).$in.map(String);
    expect(staleIds).toContain(String(STALE_SOE));
    expect(staleIds).toContain(String(PRIMARY));
    expect(staleIds).not.toContain(String(CANONICAL_SOE));
  });

  it("never moves a sector owned by a corporation the country does not own", async () => {
    await upsertCountryOwnedCorpEntries(db as unknown as Db, "DD", [
      seedEntry(CANONICAL_SOE, ["BEO"]),
    ]);

    const [filter] = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
    const staleIds = (filter.corporationId as { $in: ObjectId[] }).$in.map(String);
    expect(staleIds).not.toContain(String(PLAYER_CORP));
  });

  it("does not re-point when the canonical owner already holds that sector", async () => {
    db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(1);

    const result = await upsertCountryOwnedCorpEntries(db as unknown as Db, "DD", [
      seedEntry(CANONICAL_SOE, ["BEO"]),
    ]);

    expect(result.repointed).toBe(0);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });

  it("upserts every seeded sector at its canonical owner", async () => {
    const result = await upsertCountryOwnedCorpEntries(db as unknown as Db, "DD", [
      seedEntry(CANONICAL_SOE, ["BEO", "SN"]),
    ]);

    expect(result.sectors).toBe(2);
    expect(db.collectionMocks.corporations.bulkWrite).toHaveBeenCalled();
    const ops = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(ops[0].updateOne.filter).toMatchObject({ corporationId: CANONICAL_SOE });
    expect(ops[0].updateOne.upsert).toBe(true);
  });

  it("does nothing for a country with no country-owned seed entries", async () => {
    const result = await upsertCountryOwnedCorpEntries(db as unknown as Db, "DD", []);

    expect(result).toEqual({ corporations: 0, sectors: 0, repointed: 0 });
    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
  });
});
