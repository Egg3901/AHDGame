import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  annualDeathProbability,
  nppAgeAtYear,
  processNppMortality,
  randomReplacementBirthYear,
} from "@/lib/npp/mortality";
import type { NPP } from "@/lib/db/types/npp";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";

vi.mock("@/lib/nppAutonomy/featureFlag", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/nppAutonomy/featureFlag")>();
  return { ...mod, nppAutonomyAtLeast: vi.fn() };
});

function npp(over: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    countryId: "US",
    homeState: "CA",
    party: "1",
    currentOffice: { type: "house", state: "CA", seatsHeld: 1 },
    birthYear: 1950,
    gender: "male",
    ethnicity: "white",
    politicalInfluence: 10,
    favorability: 50,
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 50, ambition: 50, stubbornness: 40 },
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as NPP;
}

describe("nppAgeAtYear", () => {
  it("computes whole game years from birth year", () => {
    expect(nppAgeAtYear({ birthYear: 1930 }, 1991)).toBe(61);
    expect(nppAgeAtYear({ birthYear: 1947 }, 2019)).toBe(72);
  });

  it("returns null when no birth year is on record", () => {
    expect(nppAgeAtYear({}, 2019)).toBeNull();
    expect(nppAgeAtYear({ birthYear: null }, 2019)).toBeNull();
  });
});

describe("annualDeathProbability", () => {
  it("rises monotonically with age at actuarial orders of magnitude", () => {
    const p30 = annualDeathProbability(30);
    const p50 = annualDeathProbability(50);
    const p65 = annualDeathProbability(65);
    const p85 = annualDeathProbability(85);
    expect(p30).toBeGreaterThan(0);
    expect(p30).toBeLessThan(p50);
    expect(p50).toBeLessThan(p65);
    expect(p65).toBeLessThan(p85);
    expect(p30).toBeLessThan(0.005);
    expect(p65).toBeGreaterThan(0.005);
  });

  it("caps at 50% and rejects nonsense", () => {
    expect(annualDeathProbability(150)).toBe(0.5);
    expect(annualDeathProbability(-5)).toBe(0);
  });
});

describe("randomReplacementBirthYear", () => {
  it("mints a working-age adult (32-68)", () => {
    for (let i = 0; i < 200; i++) {
      const y = randomReplacementBirthYear(2019);
      expect(2019 - y).toBeGreaterThanOrEqual(32);
      expect(2019 - y).toBeLessThanOrEqual(68);
    }
  });
});

describe("processNppMortality", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function seedNpps(docs: NPP[]) {
    db.collection("npps");
    db.collectionMocks["npps"].find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(docs),
      }),
    });
  }

  function mintStub(dead: NPP) {
    return Promise.resolve(
      npp({
        _id: new ObjectId(),
        name: "Replacement Person",
        birthYear: 1975,
        currentOffice: dead.currentOffice,
      })
    );
  }

  it("retires the dead NPP, inserts an aged successor, and repoints the office", async () => {
    vi.mocked(nppAutonomyAtLeast).mockResolvedValue(true);
    const dead = npp({ birthYear: 1900 });
    db.collection("electedOfficials");
    seedNpps([dead]);

    const result = await processNppMortality(db as unknown as Db, {
      year: 2019,
      rng: () => 0, // certain death
      mintReplacement: mintStub,
    });

    expect(result).toEqual({ deaths: 1, replacements: 1 });
    const npps = db.collectionMocks["npps"];
    expect(npps.insertOne).toHaveBeenCalledTimes(1);
    expect(npps.updateOne).toHaveBeenCalledWith(
      { _id: dead._id },
      expect.objectContaining({ $set: expect.objectContaining({ currentOffice: null }) })
    );
    const retiredSet = npps.updateOne.mock.calls[0][1].$set;
    expect(retiredSet.retiredAt).toBeInstanceOf(Date);
    const officials = db.collectionMocks["electedOfficials"];
    expect(officials.updateMany).toHaveBeenCalledWith(
      { nppId: dead._id },
      expect.objectContaining({
        $set: expect.objectContaining({ characterName: "Replacement Person" }),
      })
    );
    const inserted = npps.insertOne.mock.calls[0][0];
    expect(inserted.birthYear).toBe(1975);
  });

  it("repoints head-of-government formation ids to the successor", async () => {
    vi.mocked(nppAutonomyAtLeast).mockResolvedValue(true);
    const dead = npp({ birthYear: 1900 });
    db.collection("governmentFormations");
    seedNpps([dead]);

    await processNppMortality(db as unknown as Db, {
      year: 2019,
      rng: () => 0,
      mintReplacement: mintStub,
    });

    const formations = db.collectionMocks["governmentFormations"];
    expect(formations.updateMany).toHaveBeenCalledTimes(3);
    for (const field of ["pmNppId", "presidentNppId", "hosNppId"]) {
      expect(formations.updateMany).toHaveBeenCalledWith(
        { [field]: dead._id },
        expect.objectContaining({
          $set: expect.objectContaining({ [field]: expect.any(ObjectId) }),
        })
      );
    }
  });

  it("leaves the young alive", async () => {
    vi.mocked(nppAutonomyAtLeast).mockResolvedValue(true);
    seedNpps([npp({ birthYear: 1980 })]);

    const result = await processNppMortality(db as unknown as Db, {
      year: 2019,
      rng: () => 0.9999999, // certain survival
      mintReplacement: mintStub,
    });

    expect(result).toEqual({ deaths: 0, replacements: 0 });
    expect(db.collectionMocks["npps"].insertOne).not.toHaveBeenCalled();
  });

  it("skips non-V5 countries, birth-year-less NPPs, and technocrats without rolling", async () => {
    const gate = vi.mocked(nppAutonomyAtLeast);
    gate.mockImplementation(async (_db, countryId) => countryId === "US");
    const rng = vi.fn(() => 0); // would kill anything rolled
    seedNpps([
      npp({ birthYear: 1900, countryId: "UK" }),
      npp({ birthYear: null }),
      npp({ birthYear: 1900, isTechnocrat: true }),
    ]);

    // Technocrats are filtered in the query; the other two reach the roll.
    const result = await processNppMortality(db as unknown as Db, {
      year: 2019,
      rng,
      mintReplacement: mintStub,
    });

    expect(result).toEqual({ deaths: 0, replacements: 0 });
    expect(rng).not.toHaveBeenCalled();
  });
});
