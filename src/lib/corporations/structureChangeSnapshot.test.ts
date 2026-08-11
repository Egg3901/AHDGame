import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { buildStructureChangeHolderList } from "./structureChangeSnapshot";

describe("buildStructureChangeHolderList", () => {
  it("captures character, imperial, and corporation holders with correct percents", () => {
    const char = new ObjectId();
    const imp = new ObjectId();
    const corp = new ObjectId();
    const holders = [
      { characterId: char, shares: 500_000 },
      { imperialCharacterId: imp, shares: 300_000 },
      { corporationId: corp, shares: 200_000 },
    ];
    const out = buildStructureChangeHolderList(holders, 1_000_000, 0, {
      characters: new Map([[char.toString(), "Jane Politician"]]),
      imperial: new Map([[imp.toString(), "The Emperor"]]),
      corporations: new Map([[corp.toString(), "Acme Holdings"]]),
    });
    expect(out).toHaveLength(3);
    const charRow = out.find((r) => r.kind === "character")!;
    expect(charRow.ownerId).toBe(char.toString());
    expect(charRow.name).toBe("Jane Politician");
    expect(charRow.shares).toBe(500_000);
    expect(charRow.percent).toBeCloseTo(0.5, 6);
    const impRow = out.find((r) => r.kind === "imperial")!;
    expect(impRow.name).toBe("The Emperor");
    expect(impRow.percent).toBeCloseTo(0.3, 6);
    const corpRow = out.find((r) => r.kind === "corporation")!;
    expect(corpRow.name).toBe("Acme Holdings");
    expect(corpRow.percent).toBeCloseTo(0.2, 6);
  });

  it("captures fund holders with correct percent and name", () => {
    const fund = new ObjectId();
    const char = new ObjectId();
    const out = buildStructureChangeHolderList(
      [
        { characterId: char, shares: 600_000 },
        { fundId: fund, shares: 400_000 },
      ],
      1_000_000,
      0,
      {
        characters: new Map([[char.toString(), "X"]]),
        imperial: new Map(),
        corporations: new Map(),
        funds: new Map([[fund.toString(), "Global Logistics Index"]]),
      }
    );
    const fundRow = out.find((r) => r.kind === "fund")!;
    expect(fundRow).toBeDefined();
    expect(fundRow.ownerId).toBe(fund.toString());
    expect(fundRow.name).toBe("Global Logistics Index");
    expect(fundRow.shares).toBe(400_000);
    expect(fundRow.percent).toBeCloseTo(0.4, 6);
  });

  it("emits a public_float row when float > 0", () => {
    const char = new ObjectId();
    const out = buildStructureChangeHolderList(
      [{ characterId: char, shares: 800_000 }],
      1_000_000,
      200_000,
      {
        characters: new Map([[char.toString(), "X"]]),
        imperial: new Map(),
        corporations: new Map(),
      }
    );
    const float = out.find((r) => r.kind === "public_float")!;
    expect(float).toBeDefined();
    expect(float.ownerId).toBeUndefined();
    expect(float.name).toBe("Public Float");
    expect(float.shares).toBe(200_000);
    expect(float.percent).toBeCloseTo(0.2, 6);
  });

  it("omits public_float row when float is zero", () => {
    const char = new ObjectId();
    const out = buildStructureChangeHolderList(
      [{ characterId: char, shares: 1_000_000 }],
      1_000_000,
      0,
      {
        characters: new Map([[char.toString(), "X"]]),
        imperial: new Map(),
        corporations: new Map(),
      }
    );
    expect(out.find((r) => r.kind === "public_float")).toBeUndefined();
  });

  it("falls back to a generic label when a name lookup is missing", () => {
    const corp = new ObjectId();
    const out = buildStructureChangeHolderList([{ corporationId: corp, shares: 100 }], 100, 0, {
      characters: new Map(),
      imperial: new Map(),
      corporations: new Map(),
    });
    expect(out[0]!.name).toMatch(/Corporation/);
    expect(out[0]!.ownerId).toBe(corp.toString());
  });

  it("treats totalShares=0 as 0% percents (does not divide by zero)", () => {
    const char = new ObjectId();
    const out = buildStructureChangeHolderList([{ characterId: char, shares: 0 }], 0, 0, {
      characters: new Map([[char.toString(), "X"]]),
      imperial: new Map(),
      corporations: new Map(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips zero-share entries so before/after lists don't carry dead rows", () => {
    const char = new ObjectId();
    const ghost = new ObjectId();
    const out = buildStructureChangeHolderList(
      [
        { characterId: char, shares: 1_000_000 },
        { corporationId: ghost, shares: 0 },
      ],
      1_000_000,
      0,
      {
        characters: new Map([[char.toString(), "X"]]),
        imperial: new Map(),
        corporations: new Map(),
      }
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("character");
  });
});
