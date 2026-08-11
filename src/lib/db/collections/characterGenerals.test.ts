import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

import { vi } from "vitest";
import { listCountryGenerals } from "./characterGenerals";

describe("listCountryGenerals", () => {
  it("maps the country's commissioned generals to commander refs", async () => {
    const db = createMockDb();
    db.collection("characters");
    db.collection("characterGenerals");
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: vi.fn().mockResolvedValue([{ _id: "char_1", name: "Gen. Real" }]),
      }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: "char_1",
          general: { name: "Gen. Real", spec: "armor", level: 2, traits: [] },
        },
      ]),
    });
    const refs = await listCountryGenerals(db as unknown as Db, "US");
    // This general has trained nothing, so their derived spec reads "No specialisation" — a
    // stored `spec` is ignored, and no discipline is credited that was not earned.
    expect(refs).toEqual([
      { id: "char_1", name: "Gen. Real", spec: "No specialisation", level: 2, fit: 66 },
    ]);
  });

  it("names the derived discipline for a general who has trained into one", async () => {
    const db = createMockDb();
    db.collection("characters");
    db.collection("characterGenerals");
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: vi.fn().mockResolvedValue([{ _id: "char_1", name: "Gen. Real" }]),
      }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: "char_1",
          general: { name: "Gen. Real", level: 2, xp: 0, pts: 0, gtraits: ["ar1", "ar2"] },
        },
      ]),
    });
    const refs = await listCountryGenerals(db as unknown as Db, "US");
    expect(refs[0].spec).toBe("Armor Officer");
  });

  it("returns [] when the country has no characters", async () => {
    const db = createMockDb();
    db.collection("characters");
    db.collection("characterGenerals");
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    expect(await listCountryGenerals(db as unknown as Db, "US")).toEqual([]);
    expect(db.collectionMocks.characterGenerals.find).not.toHaveBeenCalled();
  });
});

import { loadGeneralsById, getCharacterCommission } from "./characterGenerals";

const profile = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Gen. Real",
  chop: "GR",
  spec: "armor",
  level: 2,
  xp: 0,
  traits: [],
  pts: 1,
  ...over,
});

function poolDb(docs: unknown[]) {
  const db = createMockDb();
  db.collection("characters");
  db.collection("characterGenerals");
  db.collectionMocks.characters.find.mockReturnValue({
    project: () => ({
      toArray: vi.fn().mockResolvedValue([
        { _id: "c1", name: "Alpha" },
        { _id: "c2", name: "Bravo" },
      ]),
    }),
  });
  db.collectionMocks.characterGenerals.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
  });
  return db;
}

describe("commission filtering", () => {
  it("excludes a dismissed general from the assignable pool", async () => {
    const db = poolDb([{ characterId: "c1", general: profile(), commissioned: false }]);
    expect(await listCountryGenerals(db as unknown as Db, "US")).toEqual([]);
  });

  it("excludes a commissioned-but-unspecced character from the pool", async () => {
    const db = poolDb([{ characterId: "c1", general: null, commissioned: true }]);
    expect(await listCountryGenerals(db as unknown as Db, "US")).toEqual([]);
  });

  // The load-bearing filter: without it a dismissed general keeps buffing the units
  // they led — commanding from beyond their dismissal.
  it("keeps a dismissed general out of battle math", async () => {
    const db = poolDb([
      { characterId: "c1", general: profile(), commissioned: false },
      { characterId: "c2", general: profile({ id: "c2" }), commissioned: true },
    ]);
    expect(Object.keys(await loadGeneralsById(db as unknown as Db, "US"))).toEqual(["c2"]);
  });

  it("keeps an unspecced character out of battle math", async () => {
    const db = poolDb([{ characterId: "c1", general: null, commissioned: true }]);
    expect(await loadGeneralsById(db as unknown as Db, "US")).toEqual({});
  });

  // Grandfathering: docs predating commissioning have no field, and must read as
  // commissioned so nobody loses a commission they already hold.
  it("treats an absent commissioned field as commissioned in battle math", async () => {
    const db = poolDb([{ characterId: "c1", general: profile() }]);
    expect(Object.keys(await loadGeneralsById(db as unknown as Db, "US"))).toEqual(["c1"]);
  });
});

describe("getCharacterCommission", () => {
  function commissionDb(doc: unknown) {
    const db = createMockDb();
    db.collection("characterGenerals");
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue(doc);
    return db;
  }

  it("reports a character with no doc as not commissioned", async () => {
    const db = commissionDb(null);
    expect(await getCharacterCommission(db as unknown as Db, "c1")).toEqual({
      commissioned: false,
      general: null,
    });
  });

  it("reports a commissioned unspecced character", async () => {
    const db = commissionDb({ characterId: "c1", general: null, commissioned: true });
    expect(await getCharacterCommission(db as unknown as Db, "c1")).toEqual({
      commissioned: true,
      general: null,
    });
  });

  it("reports a dismissed general as uncommissioned but keeps their record", async () => {
    const db = commissionDb({ characterId: "c1", general: profile(), commissioned: false });
    const r = await getCharacterCommission(db as unknown as Db, "c1");
    expect(r.commissioned).toBe(false);
    expect(r.general?.level).toBe(2); // preserved for re-appointment
  });

  it("treats an absent commissioned field as commissioned", async () => {
    const db = commissionDb({ characterId: "c1", general: profile() });
    expect((await getCharacterCommission(db as unknown as Db, "c1")).commissioned).toBe(true);
  });
});
