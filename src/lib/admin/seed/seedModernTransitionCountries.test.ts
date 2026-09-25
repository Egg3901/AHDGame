import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  metricsToBaselines,
  seedModernTransitionBaselines,
  seedModernTransitionCountry,
  seedModernTransitionDemographics,
  seedModernTransitionParties,
  seedModernTransitionRegions,
  seedModernTransitionStateMetrics,
  seedModernTransitionStatePartyOrg,
  type ModernTransitionCountryId,
} from "./seedModernTransitionCountries";
import { plParties } from "@/lib/countries/pl/data/plParties";
import { roParties } from "@/lib/countries/ro/data/roParties";
import { selectPartyRosterForPreset } from "@/lib/seeds/ensureDefaultParties";

function makeDb(
  seedParties: Array<{ name: string; countryId: string; sequentialId: number }> = []
) {
  const collections: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  let seq = 0;
  const coll = (name: string) => {
    collections[name] ??= {
      bulkWrite: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      updateOne: vi.fn().mockResolvedValue({}),
      insertOne: vi.fn().mockResolvedValue({}),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(seedParties) }),
      findOneAndUpdate: vi.fn().mockImplementation(async () => ({ seq: ++seq })),
    };
    return collections[name]!;
  };
  const db = { collection: vi.fn((name: string) => coll(name)) } as unknown as Db;
  return { db, collections };
}

const noop = () => {};

describe("modern transition regions", () => {
  it("seeds 8 PL regions with Sejm 460 / Senate 100 apportionment", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionRegions(db, true, noop, "2027-default", "PL");
    expect(collections["states"]!.deleteMany).toHaveBeenCalledWith({ countryId: "PL" });
    expect(collections["states"]!.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = collections["states"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: { houseDistricts: number; stateSenateSeats: number } };
      };
    }>;
    expect(ops).toHaveLength(8);
    expect(ops.reduce((s, o) => s + o.updateOne.update.$set.houseDistricts, 0)).toBe(460);
    expect(ops.reduce((s, o) => s + o.updateOne.update.$set.stateSenateSeats, 0)).toBe(100);
  });

  it("seeds 7 RO regions with Chamber 331 / Senate 134 apportionment", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionRegions(db, true, noop, "2027-default", "RO");
    const ops = collections["states"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set: { houseDistricts: number; stateSenateSeats: number } } };
    }>;
    expect(ops).toHaveLength(7);
    expect(ops.reduce((s, o) => s + o.updateOne.update.$set.houseDistricts, 0)).toBe(331);
    expect(ops.reduce((s, o) => s + o.updateOne.update.$set.stateSenateSeats, 0)).toBe(134);
  });
});

describe("modern transition parties", () => {
  it("seeds the 5-party October 2023 PKW roster for PL", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionParties(db, noop, "2027-default", "PL");
    expect(collections["politicalParties"]!.insertOne).toHaveBeenCalledTimes(5);
    const names = collections["politicalParties"]!.insertOne.mock.calls.map(
      (c) => (c[0] as { abbreviation: string }).abbreviation
    );
    expect(names).toEqual(["PiS", "KO", "TD", "LEWICA", "KONF"]);
  });

  it("seeds the 7-party December 2024 ROAEP/BEC roster for RO", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionParties(db, noop, "2027-default", "RO");
    expect(collections["politicalParties"]!.insertOne).toHaveBeenCalledTimes(7);
    const names = collections["politicalParties"]!.insertOne.mock.calls.map(
      (c) => (c[0] as { abbreviation: string }).abbreviation
    );
    expect(names).toEqual(["PSD", "AUR", "PNL", "USR", "SOS", "POT", "UDMR"]);
  });

  it("prunes the Cold-War ruling party on a 2027 reset (no stale PZPR)", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionParties(db, noop, "2027-default", "PL");
    expect(collections["politicalParties"]!.deleteMany).toHaveBeenCalled();
    const filter = collections["politicalParties"]!.deleteMany.mock.calls[0]![0] as {
      $or: Array<{ name: string }>;
    };
    expect(filter.$or.map((e) => e.name)).toContain("Polska Zjednoczona Partia Robotnicza");
  });

  it("keeps 1953/1979 rosters: PZPR then, modern roster only in 2027", () => {
    expect(
      selectPartyRosterForPreset(plParties, "1953-default").map((p) => p.abbreviation)
    ).toEqual(["PZPR"]);
    expect(
      selectPartyRosterForPreset(plParties, "1979-default").map((p) => p.abbreviation)
    ).toEqual(["PZPR"]);
    const modern = selectPartyRosterForPreset(plParties, "2027-default");
    expect(modern).toHaveLength(5);
    expect(modern.map((p) => p.abbreviation)).not.toContain("PZPR");
  });

  it("keeps era-specific RO identity: PMR in 1953, PCR in 1979, modern roster only in 2027", () => {
    expect(
      selectPartyRosterForPreset(roParties, "1953-default").map((p) => p.abbreviation)
    ).toEqual(["PMR"]);
    expect(
      selectPartyRosterForPreset(roParties, "1979-default").map((p) => p.abbreviation)
    ).toEqual(["PCR"]);
    const modern = selectPartyRosterForPreset(roParties, "2027-default");
    expect(modern).toHaveLength(7);
    expect(modern.map((p) => p.abbreviation)).not.toContain("PMR");
    expect(modern.map((p) => p.abbreviation)).not.toContain("PCR");
  });
});

describe("modern transition demographics", () => {
  it("seeds a modern PL voter category and 8 region demographics, never communist archetypes", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionDemographics(db, true, noop, "2027-default", "PL");
    expect(collections["demographicCategories"]!.deleteMany).toHaveBeenCalled();
    expect(collections["demographicCategories"]!.updateOne).toHaveBeenCalledTimes(1);
    const catSet = collections["demographicCategories"]!.updateOne.mock.calls[0]![1] as {
      $set: { groups: Array<{ id: string }> };
    };
    const groupIds = catSet.$set.groups.map((g) => g.id);
    expect(groupIds).toEqual([
      "rural_conservative",
      "urban_civic",
      "agrarian_centre",
      "progressive_left",
      "libertarian_nationalist",
      "silesian_minority",
    ]);
    expect(groupIds).not.toContain("party_nomenklatura");
    expect(collections["stateDemographics"]!.updateOne).toHaveBeenCalledTimes(8);
  });

  it("seeds a modern RO voter category and 7 region demographics", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionDemographics(db, true, noop, "2027-default", "RO");
    const catSet = collections["demographicCategories"]!.updateOne.mock.calls[0]![1] as {
      $set: { groups: Array<{ id: string }> };
    };
    expect(catSet.$set.groups.map((g) => g.id)).toEqual([
      "social_rural",
      "urban_reformist",
      "nationalist_populist",
      "liberal_centre",
      "hungarian_minority",
      "green_youth",
    ]);
    expect(collections["stateDemographics"]!.updateOne).toHaveBeenCalledTimes(7);
  });
});

describe("modern transition metrics and baselines", () => {
  it("seeds 8 PL transitional metric sets with income anchored to authored region GDP", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionStateMetrics(db, true, noop, "2027-default", "PL");
    expect(collections["macroMetrics"]!.bulkWrite).toHaveBeenCalledTimes(1);
    const docs = collections["macroMetrics"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string } };
    }>;
    expect(docs).toHaveLength(8);
  });

  it("derives RO baselines 1:1 from the authored 2027 metrics", async () => {
    const { roStateMetrics2027 } = await import("@/lib/countries/ro/data/roStateMetrics2027");
    const { roStateBaselines2027 } = await import("@/lib/countries/ro/data/roStateBaselines2027");
    expect(metricsToBaselines(roStateMetrics2027)).toEqual(roStateBaselines2027);
  });

  it("seeds 7 RO baselines from the authored bundle", async () => {
    const { db, collections } = makeDb();
    await seedModernTransitionBaselines(db, true, noop, "2027-default", "RO");
    expect(collections["stateBaselines"]!.deleteMany).toHaveBeenCalled();
    expect(collections["stateBaselines"]!.updateOne).toHaveBeenCalledTimes(7);
  });
});

describe("modern transition state party org", () => {
  it("registers every 2027 party in every region (PL: 8 x 5)", async () => {
    const parties = ["PiS", "KO", "TD", "LEWICA", "KONF"].map((name, i) => ({
      name,
      countryId: "PL",
      sequentialId: i + 1,
    }));
    const { db, collections } = makeDb(parties);
    await seedModernTransitionStatePartyOrg(db, true, noop, "2027-default", "PL");
    expect(collections["statePartyOrg"]!.deleteMany).toHaveBeenCalledWith({ countryId: "PL" });
    expect(collections["statePartyOrg"]!.updateOne).toHaveBeenCalledTimes(40);
    const first = collections["statePartyOrg"]!.updateOne.mock.calls[0]!;
    expect(first[0]).toEqual({ _id: "PL_MAZ_1" });
    expect((first[1] as { $set: { registration: number } }).$set.registration).toBe(50);
  });
});

describe("1991 and Cold-War preset isolation", () => {
  const cases: Array<{ preset: string; country: ModernTransitionCountryId }> = [
    { preset: "1991-default", country: "PL" },
    { preset: "1991-default", country: "RO" },
    { preset: "1953-default", country: "PL" },
    { preset: "1979-default", country: "RO" },
  ];
  for (const { preset, country } of cases) {
    it(`writes nothing for ${country} on ${preset}`, async () => {
      const { db, collections } = makeDb();
      await seedModernTransitionCountry(db, true, noop, preset, country);
      for (const coll of Object.values(collections)) {
        expect(coll.bulkWrite).not.toHaveBeenCalled();
        expect(coll.insertOne).not.toHaveBeenCalled();
        expect(coll.updateOne).not.toHaveBeenCalled();
        expect(coll.deleteMany).not.toHaveBeenCalled();
      }
    });
  }
});

describe("full 2027 driver", () => {
  it("runs every substrate step for PL and RO", async () => {
    for (const country of ["PL", "RO"] as ModernTransitionCountryId[]) {
      const { db, collections } = makeDb();
      await seedModernTransitionCountry(db, false, noop, "2027-default", country);
      expect(collections["states"]!.bulkWrite).toHaveBeenCalledTimes(1);
      expect(collections["politicalParties"]!.insertOne).toHaveBeenCalled();
      expect(collections["demographicCategories"]!.updateOne).toHaveBeenCalledTimes(1);
      expect(collections["stateDemographics"]!.updateOne).toHaveBeenCalled();
      expect(collections["macroMetrics"]!.bulkWrite).toHaveBeenCalledTimes(1);
      expect(collections["stateBaselines"]!.updateOne).toHaveBeenCalled();
    }
  });
});
