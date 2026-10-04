import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import {
  quoteFundedProductAdvertising,
  productAdvertisingDenominationWitness,
} from "./rules/productAdvertising";
import { settleProductAdvertisingObligations } from "./mediaProductAdvertisingSettlement";
import { consumeManufacturingDevelopmentReceiptsV2 } from "./manufacturingProjectPersistence";
import {
  MANUFACTURING_PRODUCT_PROJECTS_V2,
  type ManufacturingProductProject,
} from "./manufacturingProject";

function fixture() {
  const db = createInMemoryDb();
  const buyer = makeCorporation({
    liquidCapital: 2000,
    liquidCurrencyCode: "USD",
    countryId: "US",
  });
  const seller = makeCorporation({ liquidCapital: 0, liquidCurrencyCode: "EUR", countryId: "DE" });
  const project: ManufacturingProductProject = {
    _id: "plant-product",
    corporationId: buyer._id.toString(),
    activeCorporationId: buyer._id.toString(),
    kindId: "passenger_car",
    stage: "development",
    stageStartedTurn: 1,
    startedTurn: 1,
    allocations: [{ sectorId: "plant", share: 1 }],
    developmentPaidAnchor: 1000,
    paidThresholdAnchor: 1000,
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: 12,
  };
  const quote = quoteFundedProductAdvertising({
    amountAnchor: 120,
    buyer: {
      corporationId: buyer._id.toString(),
      currencyCode: "USD",
      localPerAnchor: 1,
      ...productAdvertisingDenominationWitness(buyer),
    },
    sellers: [
      {
        corporationId: seller._id.toString(),
        currencyCode: "EUR",
        localPerAnchor: 2,
        deliveredValueAnchor: 120,
        ...productAdvertisingDenominationWitness(seller),
      },
    ],
  });
  if (!quote) throw new Error("Missing funded quote");
  const obligation = { projectId: project._id, turn: 1, ...quote };
  db.seed("corporations", [
    { ...buyer, manufacturingProductAdvertisingObligationsV2: [obligation] },
    { ...seller },
  ]);
  db.seed(MANUFACTURING_PRODUCT_PROJECTS_V2, [{ ...project }]);
  return { db, buyer, seller, project, obligation };
}

describe("manufacturing product paid advertising", () => {
  it("credits brand only after balanced native cash settles and acknowledges it once", async () => {
    const { db, buyer, seller, project } = fixture();
    const store = db as unknown as Db;
    const projects = new Map([[buyer._id.toString(), project]]);
    await settleProductAdvertisingObligations(store, [buyer._id], 1, "manufacturing");
    await settleProductAdvertisingObligations(store, [buyer._id], 1, "manufacturing");
    expect(
      db.collection("corporations").docs.find((row) => String(row._id) === buyer._id.toString())
        ?.liquidCapital
    ).toBe(1880);
    expect(
      db.collection("corporations").docs.find((row) => String(row._id) === seller._id.toString())
        ?.liquidCapital
    ).toBe(240);
    for (let completedTurn = 1; completedTurn <= 12; completedTurn++) {
      const current = await store
        .collection<typeof buyer>("corporations")
        .findOne({ _id: buyer._id });
      if (!current) throw new Error("Missing buyer");
      await consumeManufacturingDevelopmentReceiptsV2({
        db: store,
        corporations: [current],
        projectsByCorporationId: projects,
        completedTurn,
      });
      await consumeManufacturingDevelopmentReceiptsV2({
        db: store,
        corporations: [current],
        projectsByCorporationId: projects,
        completedTurn,
      });
    }
    expect(projects.get(buyer._id.toString())).toMatchObject({
      stage: "launch",
      productBrand: 10,
      developmentAdvertisingAnchor: 120,
      developmentAdvertisingTurns: 12,
      lastAdvertisingReceiptTurn: 1,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(
      db.collection("corporations").docs.find((row) => String(row._id) === buyer._id.toString())
        ?.manufacturingProductAdvertisingReceiptV2
    ).toBeUndefined();
  });

  it("refuses an unfunded changed-denomination order before seller cash or product brand", async () => {
    const { db, buyer, seller, project } = fixture();
    await db
      .collection("corporations")
      .updateOne({ _id: buyer._id }, { $set: { liquidCurrencyCode: "CAD" } });
    const store = db as unknown as Db;
    await settleProductAdvertisingObligations(store, [buyer._id], 1, "manufacturing");
    const current = await store
      .collection<typeof buyer>("corporations")
      .findOne({ _id: buyer._id });
    if (!current) throw new Error("Missing buyer");
    const projects = new Map([[buyer._id.toString(), project]]);
    await consumeManufacturingDevelopmentReceiptsV2({
      db: store,
      corporations: [current],
      projectsByCorporationId: projects,
      completedTurn: 1,
    });
    expect(current.liquidCapital).toBe(2000);
    expect(
      db.collection("corporations").docs.find((row) => String(row._id) === seller._id.toString())
        ?.liquidCapital
    ).toBe(0);
    expect(projects.get(buyer._id.toString())?.productBrand).toBe(0);
    expect(current.manufacturingProductAdvertisingReceiptV2).toBeUndefined();
  });
});
