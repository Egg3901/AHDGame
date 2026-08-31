import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { listBattleReportsForCountry } from "./battleReports";

describe("listBattleReportsForCountry", () => {
  it("queries reports where the country is a principal OR a coalition ally, newest first", async () => {
    const db = createMockDb();
    db.collection("battleReports");
    const toArray = vi.fn().mockResolvedValue([{ turn: 9 }]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit });
    db.collectionMocks.battleReports.find.mockReturnValue({ sort });

    const r = await listBattleReportsForCountry(db as unknown as Db, "US", 10);

    // `attackers`/`defenders` matter because an ally in a merged offensive is
    // neither the declarer nor the target of the report it fought in.
    expect(db.collectionMocks.battleReports.find).toHaveBeenCalledWith({
      $or: [
        { declarerCountry: "US" },
        { targetCountry: "US" },
        { attackers: "US" },
        { defenders: "US" },
      ],
    });
    expect(sort).toHaveBeenCalledWith({ turn: -1 });
    expect(limit).toHaveBeenCalledWith(10);
    expect(r).toEqual([{ turn: 9 }]);
  });
});

import { listRecentBattleReports } from "./battleReports";

describe("listRecentBattleReports", () => {
  it("filters reports at or after the given turn", async () => {
    const db = createMockDb();
    db.collection("battleReports");
    const toArray = vi.fn().mockResolvedValue([{ turn: 30 }]);
    db.collectionMocks.battleReports.find.mockReturnValue({ toArray });
    const r = await listRecentBattleReports(db as unknown as Db, 20);
    expect(db.collectionMocks.battleReports.find).toHaveBeenCalledWith({ turn: { $gte: 20 } });
    expect(r).toEqual([{ turn: 30 }]);
  });
});

import { casualtiesByTheater } from "./battleReports";

describe("casualtiesByTheater", () => {
  function wire(rows: unknown[]) {
    const db = createMockDb();
    db.collection("battleReports");
    db.collectionMocks.battleReports.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
    return db;
  }

  it("sums both sides' losses per theater", async () => {
    const db = wire([
      { _id: "front-a", total: 1500 },
      { _id: "front-b", total: 40 },
    ]);
    const out = await casualtiesByTheater(db as unknown as Db, ["front-a", "front-b"]);
    expect(out).toEqual({ "front-a": 1500, "front-b": 40 });
  });

  // A theater with no engagements must read as 0, not absent — the caller should
  // never have to tell "none yet" apart from "unknown".
  it("reports zero for a theater with no engagements", async () => {
    const db = wire([]);
    expect(await casualtiesByTheater(db as unknown as Db, ["quiet"])).toEqual({ quiet: 0 });
  });

  it("does not query at all for an empty id list", async () => {
    const db = wire([]);
    expect(await casualtiesByTheater(db as unknown as Db, [])).toEqual({});
    expect(db.collectionMocks.battleReports.aggregate).not.toHaveBeenCalled();
  });

  // No-contact reports carry `result: null` and must not count toward casualties.
  it("filters to reports that actually resolved", async () => {
    const db = wire([]);
    await casualtiesByTheater(db as unknown as Db, ["front-a"]);
    const pipeline = db.collectionMocks.battleReports.aggregate.mock.calls[0][0];
    expect(JSON.stringify(pipeline)).toContain('"result"');
    expect(JSON.stringify(pipeline)).toContain("$ne");
  });

  it("scopes the aggregation to the requested theaters", async () => {
    const db = wire([]);
    await casualtiesByTheater(db as unknown as Db, ["front-a", "front-b"]);
    const pipeline = db.collectionMocks.battleReports.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.theaterId).toEqual({ $in: ["front-a", "front-b"] });
  });
});

import { foldCasualtiesByCountry, type ReportSides } from "./battleReports";

describe("foldCasualtiesByCountry", () => {
  /** The live T420 report: DD led, RU joined, US defended. */
  const coalition: ReportSides = {
    att: {
      country: "DD",
      power: 5000,
      loss: 16299,
      contingents: [
        { country: "DD", power: 1650, loss: 5360 },
        { country: "RU", power: 3350, loss: 10939 },
      ],
    },
    def: {
      country: "US",
      power: 2000,
      loss: 2313,
      contingents: [{ country: "US", power: 2000, loss: 2313 }],
    },
  };

  it("credits each ally with its own dead instead of the principal with all of them", () => {
    expect(foldCasualtiesByCountry([coalition])).toEqual({
      DD: 5360,
      RU: 10939,
      US: 2313,
    });
  });

  it("falls back to the principal on a pre-coalition report", () => {
    const legacy: ReportSides = {
      att: { country: "US", power: 4444, loss: 300 },
      def: { country: "CN", power: 9999, loss: 900 },
    };
    expect(foldCasualtiesByCountry([legacy])).toEqual({ US: 300, CN: 900 });
  });

  it("accumulates a nation across the front's whole history", () => {
    const legacy: ReportSides = {
      att: { country: "DD", power: 100, loss: 40 },
      def: { country: "US", power: 100, loss: 60 },
    };
    expect(foldCasualtiesByCountry([coalition, legacy])).toEqual({
      DD: 5400,
      RU: 10939,
      US: 2373,
    });
  });

  it("skips no-contact reports, which carry no sides at all", () => {
    expect(foldCasualtiesByCountry([null, coalition, null])).toEqual({
      DD: 5360,
      RU: 10939,
      US: 2313,
    });
  });
});
