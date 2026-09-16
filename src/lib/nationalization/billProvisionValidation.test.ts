import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";
import { stubMarketizationDb } from "@/lib/test-utils/stubMarketizationDb";

describe("validateNationalizationProvisions", () => {
  let db: MockDb;
  const corpId = new ObjectId();
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["corporations", "corporateSectors"]) db.collection(n);
  });

  it("validates a whole-corp nationalize against a same-country corp", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "US",
    } as unknown as Corporation);
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      db as unknown as Db,
      [{ type: "nationalize", targetCorporationId: corpId.toHexString() }],
      "US"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.provisions).toHaveLength(1);
      expect(res.provisions[0]).toMatchObject({ type: "nationalize" });
    }
  });

  it("validates an industry-wide sector-type nationalize with carve + scope", async () => {
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      db as unknown as Db,
      [
        {
          type: "nationalize",
          targetSectorType: "technology",
          sectorCarveFraction: 0.4,
          sectorScope: "unowned",
        },
      ],
      "US"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.provisions[0]).toMatchObject({
        type: "nationalize",
        targetSectorType: "technology",
        sectorCarveFraction: 0.4,
        sectorScope: "unowned",
      });
    }
  });

  it("rejects a nationalize providing both a corp and a sector type", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "US",
    } as unknown as Corporation);
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const both = await validateNationalizationProvisions(
      db as unknown as Db,
      [
        {
          type: "nationalize",
          targetCorporationId: corpId.toHexString(),
          targetSectorType: "technology",
        },
      ],
      "US"
    );
    expect(both.ok).toBe(false);
  });

  it("rejects a nationalize whose corp is in another country", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "UK",
    } as unknown as Corporation);
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      db as unknown as Db,
      [{ type: "nationalize", targetCorporationId: corpId.toHexString() }],
      "US"
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a designate provision with an unknown sector type", async () => {
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      db as unknown as Db,
      [{ type: "designate_strategic_sector", sectorType: "not_a_sector" }],
      "US"
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a privatize whose source is not a NatCorp of the country", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      db as unknown as Db,
      [
        {
          type: "privatize",
          sourceNationalCorporationId: corpId.toHexString(),
          selections: [{ sectorId: new ObjectId().toHexString(), carveFraction: 0.2 }],
          newCorpName: "NewCo",
          goldenSharePercent: 0,
          method: "ipo",
        },
      ],
      "US"
    );
    expect(res.ok).toBe(false);
  });

  it("requires at least one provision", async () => {
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(db as unknown as Db, [], "US");
    expect(res.ok).toBe(false);
  });
});

describe("validateNationalizationProvisions - command economy", () => {
  /**
   * Regression guard for leak L3. `privatizeAsset` refuses a command economy and
   * `legislativePrivatize` swallows that throw so one bad provision cannot abort a
   * bill's enactment. Without this authoring-time check a USSR privatization bill
   * would pass its vote and then silently do nothing, with no feedback to anyone.
   */
  it("rejects a privatize provision in a command economy with a 403", async () => {
    const db = stubMarketizationDb({ currentYear: 1970, base: createMockDb() as unknown as Db });
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      db,
      [
        {
          type: "privatize",
          sourceNationalCorporationId: new ObjectId().toHexString(),
          selections: [{ sectorId: new ObjectId().toHexString(), carveFraction: 1 }],
          newCorpName: "Soviet Spin Out",
        },
      ],
      "RU"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toContain("command economy");
    }
  });

  it("rejects in China too, which is dial-governed and never carried a config flag", async () => {
    const db = stubMarketizationDb({ currentYear: 1970, base: createMockDb() as unknown as Db });
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      db,
      [
        {
          type: "privatize",
          sourceNationalCorporationId: new ObjectId().toHexString(),
          selections: [{ sectorId: new ObjectId().toHexString(), carveFraction: 1 }],
          newCorpName: "Beijing Spin Out",
        },
      ],
      "CN"
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it("does NOT reject a nationalize provision in a command economy", async () => {
    // Taking things INTO state hands is exactly what a command economy does.
    const mock = createMockDb();
    const corpId = new ObjectId();
    mock.collection("corporations");
    mock.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "RU",
    } as unknown as Corporation);
    const { validateNationalizationProvisions } = await import("./billProvisionValidation");
    const res = await validateNationalizationProvisions(
      mock as unknown as Db,
      [{ type: "nationalize", targetCorporationId: corpId.toHexString() }],
      "RU"
    );
    expect(res.ok).toBe(true);
  });
});
