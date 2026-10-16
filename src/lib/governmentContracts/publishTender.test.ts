import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { publishTender } from "./commands";
import { tenders } from "./persistence";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import * as defenceEconomics from "@/lib/military/defenceLotEconomics";
import { lotProductionCost, lotPriceBand } from "@/lib/military/defenceLotEconomics";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
const world = vi.hoisted(() => ({ preset: "1953-default" }));
vi.mock("@/lib/gameState", () => ({
  getGameState: async () => ({ currentTurn: 1, preset: world.preset }),
}));
vi.mock("@/lib/turn/ensureFederalBudget", () => ({
  ensureFederalBudget: async (db: Db, countryId: string) =>
    db.collection("federalBudget").findOne({ countryId }),
}));
const government = { userId: "admin", isAdmin: true, hasCharacter: false } as AuthUserWithCharacter;
const now = new Date("2026-10-14T12:00:00Z");
let db: Db;
beforeEach(async () => {
  world.preset = "1953-default";
  db = createInMemoryDb() as unknown as Db;
  await db.collection("federalBudget").insertOne({
    countryId: "US",
    gdp: 387e9,
    spending: { byCategory: { defense: 1e12 } },
    defenseAppropriation: { balance: 1e12, encumbered: 0, accruedThroughTurn: 1, arrearsRatio: 0 },
  });
});
describe("defence tender publication price floor", () => {
  async function floor(strategy: string, grade = 0) {
    const budget = (await db.collection("federalBudget").findOne({ countryId: "US" }))!;
    const anchor = lotPrice(
      "US",
      militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp)
    )!;
    return lotPriceBand({
      anchorPrice: anchor,
      productionCost: lotProductionCost(strategy, anchor, await loadDefencePriceRatios(db))!,
      grade,
    })!.floor;
  }
  function publish(
    maximumPricePerLot: number,
    component: "ground" | "air" | "space" = "ground",
    grade = 0
  ) {
    return publishTender(
      db,
      "US",
      {
        title: "Equipment procurement",
        description: "Synthetic equipment procurement",
        closesTurn: 3,
        awardDeadlineTurn: 6,
        terms: { type: "defence", component, lots: 1, grade, maximumPricePerLot },
      },
      government,
      1,
      now
    );
  }
  async function expectNoReservation() {
    expect(await tenders(db).countDocuments({})).toBe(0);
    expect(await db.collection("defenceProcurementAllocations").countDocuments({})).toBe(0);
    const budget = (await db.collection("federalBudget").findOne({ countryId: "US" }))!;
    expect(budget.defenseAppropriation.encumbered).toBe(0);
    expect(budget.defenseAppropriation.governmentTenderReservations).toBeUndefined();
  }
  async function unevenPrices() {
    const ratios: Partial<Record<CommodityType, number>> = {
      energy: 0.01,
      freight: 0.01,
      construction_services: 0.01,
      vehicles: 0.01,
      rare_earth: 0.01,
      electronics: 1.69,
      software: 1.69,
      chemicals: 1.69,
    };
    await db.collection("commodityPrices").insertMany(
      Object.entries(ratios).map(([commodity, ratio]) => ({
        commodity,
        globalPrice: COMMODITY_BASE_PRICES[commodity as CommodityType] * ratio,
      }))
    );
  }
  it("rejects a cap of one before inserting a tender or reserving any budget or quota", async () => {
    await expect(publish(1)).rejects.toThrow(/maximum price per lot.*at least.*budget units/i);
    await expectNoReservation();
  });
  it("accepts equality at the nominal floor without a price book or any domestic supplier", async () => {
    await db.collection("corporations").deleteMany({});
    await db.collection("corporateSectors").deleteMany({});
    const minimum = await floor("standard");
    const id = await publish(minimum);
    const tender = (await tenders(db).findOne({ _id: id }))!;
    expect(tender.status).toBe("open");
    expect(tender.reservedAmount).toBe(minimum);
    expect(tender.bids).toEqual({});
    const budget = (await db.collection("federalBudget").findOne({ countryId: "US" }))!;
    expect(budget.defenseAppropriation.encumbered).toBe(minimum);
  });
  it("uses the cheapest compatible strategy even when it is neither standard nor munitions", async () => {
    await unevenPrices();
    const minimum = await floor("heavy_armor");
    expect(minimum).toBeLessThan(await floor("standard"));
    expect(minimum).toBeLessThan(await floor("munitions"));
    await expect(publish(minimum - 1)).rejects.toThrow(String(minimum));
    await expectNoReservation();
    const id = await publish(minimum);
    expect((await tenders(db).findOne({ _id: id }))?.status).toBe("open");
  });
  it("includes directed energy for air while excluding cheaper ground strategies", async () => {
    await unevenPrices();
    const minimum = await floor("directed_energy");
    expect(await floor("heavy_armor")).toBeLessThan(minimum);
    expect(minimum).toBeLessThan(await floor("standard"));
    expect(minimum).toBeLessThan(await floor("aerospace"));
    await expect(publish(await floor("heavy_armor"), "air")).rejects.toThrow(String(minimum));
    await expectNoReservation();
    const id = await publish(minimum, "air");
    expect((await tenders(db).findOne({ _id: id }))?.status).toBe("open");
  });
  it("rejects cheaper incompatible strategies for a single-strategy component", async () => {
    await unevenPrices();
    const minimum = await floor("aerospace");
    expect(await floor("directed_energy")).toBeLessThan(minimum);
    await expect(publish(await floor("directed_energy"), "space")).rejects.toThrow(String(minimum));
    await expectNoReservation();
    const id = await publish(minimum, "space");
    expect((await tenders(db).findOne({ _id: id }))?.status).toBe("open");
  });
  it("prices an existing grown budget without a baseline from its current GDP", async () => {
    world.preset = "2019-default";
    await db.collection("federalBudget").updateOne(
      { countryId: "US" },
      {
        $set: { gdp: 7e12 },
        $unset: { militaryPriceBaselineGdp: "" },
      }
    );
    const minimum = await floor("standard", 2);
    expect(minimum).toBeGreaterThan(1);
    await expect(publish(minimum - 1, "ground", 2)).rejects.toThrow(String(minimum));
    await expectNoReservation();
    const id = await publish(minimum, "ground", 2);
    expect((await tenders(db).findOne({ _id: id }))?.reservedAmount).toBe(minimum);
  });
  it("uses the saved GDP baseline when the economy has grown", async () => {
    await db.collection("federalBudget").updateOne(
      { countryId: "US" },
      {
        $set: { gdp: 774e9, militaryPriceBaselineGdp: 387e9 },
      }
    );
    const minimum = await floor("standard");
    await expect(publish(minimum - 1)).rejects.toThrow(String(minimum));
    await expectNoReservation();
    const id = await publish(minimum);
    expect((await tenders(db).findOne({ _id: id }))?.reservedAmount).toBe(minimum);
  });
  it.each([0, 1])(
    "applies the same floor with a supplier founded on turn %i",
    async (foundedTurn) => {
      const corporationId = new ObjectId();
      await db.collection("corporations").insertOne({
        _id: corporationId,
        countryId: "US",
        type: "defense",
        name: "Synthetic supplier",
      });
      await db.collection("corporateSectors").insertOne({
        corporationId,
        countryId: "US",
        sectorType: "defense",
        strategyId: "standard",
        revenue: 1e9,
        foundedTurn,
      });
      const minimum = await floor("standard");
      await expect(publish(1)).rejects.toThrow(String(minimum));
      await expectNoReservation();
      const id = await publish(minimum);
      expect((await tenders(db).findOne({ _id: id }))?.status).toBe("open");
    }
  );
  it.each([0, 1, 2, 3])(
    "applies the existing grade %i scale on the first publication",
    async (grade) => {
      world.preset = "2019-default";
      const minimum = await floor("standard", grade);
      await expect(publish(minimum - 1, "ground", grade)).rejects.toThrow(String(minimum));
      await expectNoReservation();
      const id = await publish(minimum, "ground", grade);
      expect((await tenders(db).findOne({ _id: id }))?.terms).toMatchObject({
        grade,
        maximumPricePerLot: minimum,
      });
    }
  );
  it.each(["1953-default", "2019-default"])(
    "validates a newly seeded %s budget without suppliers or a price book",
    async (preset) => {
      world.preset = preset;
      const seed = getInitialNationalBudgetsForPreset(preset).find((b) => b.countryId === "US")!;
      await db.collection("federalBudget").updateOne(
        { countryId: "US" },
        {
          $set: { gdp: seed.gdp, militaryPriceBaselineGdp: seed.gdp },
        }
      );
      await db.collection("corporations").deleteMany({});
      await db.collection("corporateSectors").deleteMany({});
      const minimum = await floor("standard");
      await expect(publish(1)).rejects.toThrow(String(minimum));
      await expectNoReservation();
      const id = await publish(minimum);
      expect((await tenders(db).findOne({ _id: id }))?.status).toBe("open");
    }
  );
  it.each([undefined, 0, -1, NaN, Infinity])(
    "refuses unusable GDP %s before persistence",
    async (gdp) => {
      if (gdp === undefined) {
        await db
          .collection("federalBudget")
          .updateOne({ countryId: "US" }, { $unset: { gdp: "" } });
      } else {
        await db.collection("federalBudget").updateOne({ countryId: "US" }, { $set: { gdp } });
      }
      await expect(publish(1)).rejects.toThrow(/price.*unavailable|unusable.*price/i);
      await expectNoReservation();
    }
  );
  it("refuses publication when no compatible strategy has a usable band", async () => {
    const cost = vi.spyOn(defenceEconomics, "lotProductionCost").mockReturnValue(null);
    try {
      await expect(publish(1)).rejects.toThrow(/price.*unavailable|usable.*price/i);
      await expectNoReservation();
    } finally {
      cost.mockRestore();
    }
  });
});
