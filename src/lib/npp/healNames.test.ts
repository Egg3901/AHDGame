import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { planNppNameHeal, applyNppNameHeal, type NppRename } from "./healNames";
import { generateUniqueNPPNameAndGender, isNameFromCountryPool } from "./nameGenerator";

function nppDoc(countryId: string, name: string, extra: Record<string, unknown> = {}) {
  return { _id: new ObjectId(), name, countryId, ...extra };
}

function mockDbWithNpps(docs: ReturnType<typeof nppDoc>[]): MockDb {
  const db = createMockDb();
  // Collection mocks are created lazily on first access.
  db.collection("npps");
  db.collection("electedOfficials");
  db.collectionMocks.npps.find.mockReturnValue({
    project: () => ({ toArray: async () => docs }),
  });
  db.collectionMocks.electedOfficials.updateMany.mockResolvedValue({ modifiedCount: 1 });
  return db;
}

describe("isNameFromCountryPool", () => {
  it("rejects US-pool names for countries that have their own pool", () => {
    // These are the names the live database actually holds for those chambers.
    expect(isNameFromCountryPool("Carmen Washington", "IT")).toBe(false);
    expect(isNameFromCountryPool("Joshua Liu", "FR")).toBe(false);
    expect(isNameFromCountryPool("Christopher Polk Sr.", "RU")).toBe(false);
    expect(isNameFromCountryPool("Ethan Jenkins", "TR")).toBe(false);
  });

  it("accepts names the country's own pool could have produced", () => {
    expect(isNameFromCountryPool("Giuseppe Russo", "IT")).toBe(true);
    expect(isNameFromCountryPool("Jean Dubois", "FR")).toBe(true);
    expect(isNameFromCountryPool("Mehmet Yilmaz", "TR")).toBe(true);
    expect(isNameFromCountryPool("Sergey Ivanov", "RU")).toBe(true);
    // Feminine Russian surnames are derived, so they must be recognised too.
    expect(isNameFromCountryPool("Olga Ivanova", "RU")).toBe(true);
    // Spanish double surnames.
    expect(isNameFromCountryPool("Ana Garcia Moreno", "ES")).toBe(true);
    // Chinese names are surname-first.
    expect(isNameFromCountryPool("Wang Wei", "CN")).toBe(true);
    // MULTI-TOKEN surnames. The Italian pool stores "De Luca" and "De Santis";
    // checking token by token asked whether "De" and "Luca" were surnames,
    // found neither, and called a name the generator had just produced foreign.
    expect(isNameFromCountryPool("Sergio De Luca", "IT")).toBe(true);
    expect(isNameFromCountryPool("Chiara De Santis", "IT")).toBe(true);
  });

  it("still rejects a foreign given name attached to a real compound surname", () => {
    // The compound-surname fix must not turn the predicate into "any token
    // matches something": the given name still has to belong to the pool.
    expect(isNameFromCountryPool("Brandon De Luca", "IT")).toBe(false);
  });

  it("accepts every name the generator produces for its own pool", () => {
    // This is the property the heal depends on. It used to fail for ~3% of
    // Italian names, which made the heal rename them on every run, to another
    // name that could be compound again. Exhaustive over the pools rather than
    // sampled, so it cannot pass by luck the way the randomised heal test did.
    for (const countryId of ["IT", "FR", "PL", "ES", "RU", "SE", "TR", "CN", "JP"]) {
      for (let i = 0; i < 300; i++) {
        const generated = generateUniqueNPPNameAndGender([], 200, countryId);
        if (!generated) continue;
        expect(
          isNameFromCountryPool(generated.name, countryId),
          `${countryId}: generated "${generated.name}" fails its own pool`
        ).toBe(true);
      }
    }
  });

  it("treats every name as correct for countries with no pool of their own", () => {
    // These fall back to the US pool by design, so nothing can be wrong.
    // (PL used to be the example here; it has its own pool now.)
    expect(isNameFromCountryPool("Carmen Washington", "GR")).toBe(true);
    expect(isNameFromCountryPool("Carmen Washington", undefined)).toBe(true);
  });

  it("routes East Germany through the German pool", () => {
    expect(isNameFromCountryPool("Klaus Mueller", "DD")).toBe(true);
    expect(isNameFromCountryPool("Carmen Washington", "DD")).toBe(false);
  });
});

describe("planNppNameHeal", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("plans a rename for every NPP named from the wrong pool, and no others", async () => {
    db = mockDbWithNpps([
      nppDoc("IT", "Carmen Washington"),
      nppDoc("IT", "Giuseppe Russo"),
      nppDoc("FR", "Joshua Liu"),
      // PL has its own pool now, so a US-pool name there is a heal target too.
      nppDoc("PL", "Brandon Miller"),
      nppDoc("PL", "Anna Kowalska"),
      nppDoc("GR", "Brandon Miller"),
    ]);

    const { scanned, renames } = await planNppNameHeal(db as unknown as Db);

    expect(scanned).toBe(6);
    expect(renames).toHaveLength(3);
    expect(renames.map((r) => r.oldName).sort()).toEqual([
      "Brandon Miller",
      "Carmen Washington",
      "Joshua Liu",
    ]);
    expect(renames.filter((r) => r.countryId === "GR")).toHaveLength(0);
    for (const rename of renames) {
      expect(isNameFromCountryPool(rename.newName, rename.countryId)).toBe(true);
    }
  });

  it("never proposes a name another NPP already holds", async () => {
    const docs = Array.from({ length: 40 }, () => nppDoc("SE", "Lisa Banks"));
    docs.push(nppDoc("SE", "Anna Andersson"));
    db = mockDbWithNpps(docs);

    const { renames } = await planNppNameHeal(db as unknown as Db);

    const proposed = renames.map((r) => r.newName);
    expect(new Set(proposed).size).toBe(proposed.length);
    expect(proposed).not.toContain("Anna Andersson");
  });

  it("honours the limit and countryId filters", async () => {
    db = mockDbWithNpps([nppDoc("IT", "Carmen Washington"), nppDoc("IT", "Susan Ortiz")]);

    const { renames } = await planNppNameHeal(db as unknown as Db, { limit: 1 });
    expect(renames).toHaveLength(1);

    await planNppNameHeal(db as unknown as Db, { countryId: "IT" });
    expect(db.collectionMocks.npps.find).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "IT", retiredAt: null })
    );
  });

  it("leaves technocrats alone — their name pool is a design choice, not a fallback", async () => {
    db = mockDbWithNpps([
      nppDoc("TR", "Hannah Castellan", { isTechnocrat: true }),
      nppDoc("TR", "Ethan Jenkins"),
    ]);

    const { renames } = await planNppNameHeal(db as unknown as Db);

    expect(renames).toHaveLength(1);
    expect(renames[0].oldName).toBe("Ethan Jenkins");
  });

  it("skips NPPs with no countryId rather than renaming them from the US pool", async () => {
    const doc = nppDoc("IT", "Carmen Washington") as Record<string, unknown>;
    delete doc.countryId;
    db = mockDbWithNpps([doc as ReturnType<typeof nppDoc>]);

    const { renames } = await planNppNameHeal(db as unknown as Db);
    expect(renames).toHaveLength(0);
  });
});

describe("applyNppNameHeal", () => {
  it("writes the new name and gender, and updates denormalized name snapshots", async () => {
    const db = createMockDb();
    db.collection("npps");
    db.collection("electedOfficials");
    db.collection("electionCandidates");
    db.collectionMocks.npps.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.electedOfficials.updateMany.mockResolvedValue({ modifiedCount: 2 });
    db.collectionMocks.electionCandidates.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const rename: NppRename = {
      nppId: new ObjectId(),
      countryId: "IT",
      oldName: "Carmen Washington",
      newName: "Giuseppe Russo",
      gender: "male",
      avatarUrl: "/api/images/npp-politicians/it-someone",
    };

    const result = await applyNppNameHeal(db as unknown as Db, [rename]);

    expect(result).toEqual({ renamed: 1, officialsUpdated: 2, candidaciesUpdated: 1 });
    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalledWith(
      { _id: rename.nppId },
      expect.objectContaining({
        $set: expect.objectContaining({
          name: "Giuseppe Russo",
          gender: "male",
          avatarUrl: "/api/images/npp-politicians/it-someone",
        }),
      })
    );
    expect(db.collectionMocks.electedOfficials.updateMany).toHaveBeenCalledWith(
      { nppId: rename.nppId },
      { $set: { characterName: "Giuseppe Russo" } }
    );
    expect(db.collectionMocks.electionCandidates.updateMany).toHaveBeenCalledWith(
      { nppId: rename.nppId },
      { $set: { characterName: "Giuseppe Russo" } }
    );
  });
});
