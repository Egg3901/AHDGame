/**
 * Tests for seedRUGovernmentFormation (D5): RU seeds a FORMED government
 * linking the NPC Premier via pmNppId, with thresholds derived from the
 * seeded Union chamber's houseDistricts sum (D11).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { seedRUGovernmentFormation } from "./seedRU";

type Doc = Record<string, unknown>;

function makeDb(states: Doc[], premierOfficial: Doc | null, chairmanOfficial: Doc | null = null) {
  const upserts: Array<{ filter: Doc; update: Doc }> = [];
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "states") {
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }),
        };
      }
      if (name === "electedOfficials") {
        return {
          findOne: vi.fn().mockImplementation((filter: Doc) => {
            if (filter.officeType === "premier") return Promise.resolve(premierOfficial);
            if (filter.officeType === "chairmanOfPresidium")
              return Promise.resolve(chairmanOfficial);
            return Promise.resolve(null);
          }),
        };
      }
      if (name === "governmentFormations") {
        return {
          updateOne: vi.fn().mockImplementation((filter: Doc, update: Doc) => {
            upserts.push({ filter, update });
            return Promise.resolve({});
          }),
        };
      }
      return {};
    }),
  };
  return { db, upserts };
}

const RU_STATES_1953 = [
  { _id: "CEN", houseDistricts: 400 },
  { _id: "UKR", houseDistricts: 300 },
  { _id: "BLT", houseDistricts: 8 },
]; // sums 708

beforeEach(() => vi.clearAllMocks());

describe("seedRUGovernmentFormation", () => {
  it("seeds a FORMED government linking the Premier + Chairman NPPs, thresholds from houseDistricts", async () => {
    const nppId = new ObjectId();
    const chairmanNppId = new ObjectId();
    const { db, upserts } = makeDb(
      RU_STATES_1953,
      {
        countryId: "RU",
        officeType: "premier",
        nppId,
        characterName: "Test Premier",
      },
      {
        countryId: "RU",
        officeType: "chairmanOfPresidium",
        nppId: chairmanNppId,
        characterName: "Test Chairman",
      }
    );
    const log = vi.fn();
    await seedRUGovernmentFormation(db as never, log);

    expect(upserts).toHaveLength(1);
    const set = (upserts[0].update as { $set: Doc }).$set;
    expect(set.status).toBe("formed");
    expect(set.pmNppId).toBe(nppId);
    expect(set.pmCharacterId).toBeNull();
    expect(set.pmName).toBe("Test Premier");
    expect(set.hosNppId).toBe(chairmanNppId);
    expect(set.hosCharacterId).toBeNull();
    expect(set.hosName).toBe("Test Chairman");
    expect(set.totalSeats).toBe(708);
    expect(set.majorityThreshold).toBe(355);
    expect(set.governingPartyId).toBe("1");
  });

  it("degrades to pending when no Premier official exists yet", async () => {
    const { db, upserts } = makeDb(RU_STATES_1953, null);
    await seedRUGovernmentFormation(db as never, vi.fn());
    const set = (upserts[0].update as { $set: Doc }).$set;
    expect(set.status).toBe("pending");
    expect(set.pmNppId).toBeNull();
    expect(set.hosNppId).toBeNull();
  });

  it("skips entirely when the preset seeds no RU regions", async () => {
    const { db, upserts } = makeDb([], null);
    const log = vi.fn();
    await seedRUGovernmentFormation(db as never, log);
    expect(upserts).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped"));
  });
});
