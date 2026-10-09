import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { NPP_PRIVATIZATION_MARKET } from "@/lib/turn/npp/rules/privatizationSponsorship";
import { PRIVATIZE_MARKET_CONTROL_CAP } from "@/lib/nationalization/constants";
import type { CountryId } from "@/lib/constants/countries";

vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn(async () => ({ governmentType: "parliamentary" })),
}));
const marketShare = vi.hoisted(() => ({ pct: 100 }));
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchSectorMarketSharePercent: vi.fn(async () => marketShare.pct),
}));

import { proposeNppPrivatizationBill } from "../proposeNppPrivatizationBill";

const NATCORP_ID = new ObjectId();

interface World {
  bills: Record<string, unknown>[];
  corporations: Record<string, unknown>[];
  sectors: Record<string, unknown>[];
  strategic: Record<string, unknown>[];
  persistedLevel?: number;
}

function makeDb(world: World) {
  const inserted: Record<string, unknown>[] = [];
  const touched: string[] = [];
  const findAll = (rows: Record<string, unknown>[]) => () => ({ toArray: async () => rows });
  const db = {
    collection: (name: string) => {
      touched.push(name);
      switch (name) {
        case "bills":
          return {
            find: findAll(world.bills),
            insertOne: async (doc: Record<string, unknown>) => {
              inserted.push(doc);
              return { insertedId: new ObjectId() };
            },
          };
        case "corporations":
          return {
            find: (filter: { name?: { $regex: string } }) => ({
              toArray: async () =>
                filter.name
                  ? world.corporations.filter((c) =>
                      new RegExp(filter.name!.$regex, "i").test(String(c.name))
                    )
                  : world.corporations.filter((c) => c.countryOwnerId),
            }),
            findOne: async (filter: { _id: ObjectId }) =>
              world.corporations.find((c) => String(c._id) === String(filter._id)) ?? null,
          };
        case "corporateSectors":
          return { find: findAll(world.sectors) };
        case "strategicSectorDesignations":
          return { find: findAll(world.strategic) };
        case "gameState":
          return { findOne: async () => ({ currentYear: 1995 }) };
        case "federalBudget":
          return {
            find: () => ({
              toArray: async () =>
                world.persistedLevel === undefined
                  ? []
                  : [{ _id: "RU", economicFactors: { marketizationLevel: world.persistedLevel } }],
            }),
          };
        default:
          return { find: findAll([]), findOne: async () => null };
      }
    },
  } as unknown as import("mongodb").Db;
  return { db, inserted, touched };
}

function sectorRow(sectorType: string, margin: number) {
  return {
    _id: new ObjectId(),
    corporationId: NATCORP_ID,
    countryId: "RU",
    stateId: "RU-MOW",
    sectorType,
    revenue: 1000,
    effectiveProfitMargin: margin,
  };
}

function baseWorld(): World {
  return {
    bills: [],
    corporations: [
      { _id: NATCORP_ID, name: "Soviet Union", countryOwnerId: "RU", ownershipState: "stateOwned" },
    ],
    sectors: [
      sectorRow("retail", -5),
      sectorRow("agriculture", 1),
      sectorRow("defense", -50),
      sectorRow("energy", 30),
    ],
    strategic: [{ countryId: "RU", sectorType: "energy" }],
  };
}

function args(countryId: CountryId, level: number) {
  const nppId = new ObjectId();
  return {
    countryId,
    npp: { _id: nppId, name: "Sponsor", party: "1" },
    official: { countryId, nppId, officeType: getLowerChamberOfficeType(countryId) },
    marketizationLevel: level,
    currentTurn: 1000,
    now: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("proposeNppPrivatizationBill", () => {
  beforeEach(() => {
    marketShare.pct = 100;
  });

  it("does nothing, and reads nothing, below the command ceiling", async () => {
    const { db, inserted, touched } = makeDb(baseWorld());
    const result = await proposeNppPrivatizationBill(db, args("RU", 10));
    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(touched).toHaveLength(0);
  });

  it("does nothing in a market country that owns a National Corporation", async () => {
    const { db, inserted, touched } = makeDb(baseWorld());
    const result = await proposeNppPrivatizationBill(db, args("US", 100));
    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(touched).toHaveLength(0);
  });

  it("files a state-ownership privatization bill in the market band", async () => {
    const world = { ...baseWorld(), persistedLevel: 85 };
    const { db, inserted } = makeDb(world);
    const result = await proposeNppPrivatizationBill(db, args("RU", 85));
    expect(result).toMatchObject({ ok: true, sectors: 3 });
    expect(inserted).toHaveLength(1);
    const bill = inserted[0] as {
      category: string;
      nppSponsored: boolean;
      provisions: Array<{
        type: string;
        newCorpName: string;
        goldenSharePercent: number;
        method: string;
        selections: Array<{ carveFraction: number }>;
      }>;
    };
    expect(bill.category).toBe("state ownership");
    expect(bill.nppSponsored).toBe(true);
    expect(bill.provisions.every((p) => p.type === "privatize" && p.method === "ipo")).toBe(true);
    // Defence is never sold; strategic energy goes last with a golden share.
    expect(bill.provisions.map((p) => p.newCorpName)).toEqual([
      "Soviet Union Retail Company",
      "Soviet Union Agriculture Company",
      "Soviet Union Energy Company",
    ]);
    expect(bill.provisions[2].goldenSharePercent).toBeGreaterThan(0);
    // A 100%-share holding is pre-clamped from the market carve to the cap.
    expect(NPP_PRIVATIZATION_MARKET.carveFraction).toBeGreaterThan(PRIVATIZE_MARKET_CONTROL_CAP);
    for (const p of bill.provisions) {
      expect(p.selections[0].carveFraction).toBeCloseTo(PRIVATIZE_MARKET_CONTROL_CAP);
    }
  });

  it("files a one-sector bill in the low dual-track band", async () => {
    const world = { ...baseWorld(), persistedLevel: 32 };
    const { db, inserted } = makeDb(world);
    const result = await proposeNppPrivatizationBill(db, args("RU", 32));
    expect(result).toMatchObject({ ok: true, sectors: 1 });
    const bill = inserted[0] as { provisions: Array<{ newCorpName: string }> };
    expect(bill.provisions.map((p) => p.newCorpName)).toEqual(["Soviet Union Retail Company"]);
  });

  it("holds while an NPP privatization bill is still active", async () => {
    const world = baseWorld();
    world.bills = [
      {
        status: "active",
        nppSponsored: true,
        votingEndsOnTurn: 1010,
        provisions: [{ type: "privatize", selections: [] }],
      },
    ];
    const { db, inserted } = makeDb({ ...world, persistedLevel: 85 });
    const result = await proposeNppPrivatizationBill(db, args("RU", 85));
    expect(result).toEqual({ ok: false, reason: "active_bill" });
    expect(inserted).toHaveLength(0);
  });

  it("numbers a new company name that is already taken", async () => {
    const world = baseWorld();
    world.sectors = [sectorRow("retail", -5)];
    world.corporations.push({ _id: new ObjectId(), name: "Soviet Union Retail Company" });
    const { db, inserted } = makeDb({ ...world, persistedLevel: 85 });
    await proposeNppPrivatizationBill(db, args("RU", 85));
    const bill = inserted[0] as { provisions: Array<{ newCorpName: string }> };
    expect(bill.provisions[0].newCorpName).toBe("Soviet Union Retail Company 2");
  });
});
