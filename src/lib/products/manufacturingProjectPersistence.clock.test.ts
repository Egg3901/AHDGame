import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { consumeManufacturingDevelopmentReceiptsV2 } from "./manufacturingProjectPersistence";
import {
  MANUFACTURING_PRODUCT_PROJECTS_V2,
  type ManufacturingProductProject,
} from "./manufacturingProject";

function world(overrides: Partial<ManufacturingProductProject> = {}) {
  const db = createInMemoryDb();
  const corporation = makeCorporation({ _id: new ObjectId("650000000000000000000081") });
  const corporationId = corporation._id.toString();
  const project: ManufacturingProductProject = {
    _id: "project",
    corporationId,
    activeCorporationId: corporationId,
    kindId: "passenger_car",
    allocations: [{ sectorId: "plant", share: 1 }],
    stage: "development",
    startedTurn: 1,
    stageStartedTurn: 1,
    developmentPaidAnchor: 1000,
    paidThresholdAnchor: 1000,
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: 12,
    ...overrides,
  };
  db.seed("corporations", [{ ...corporation }]);
  db.seed(MANUFACTURING_PRODUCT_PROJECTS_V2, [{ ...project }]);
  const projects = new Map([[corporationId, project]]);
  const tick = (completedTurn: number, store: Db = db as unknown as Db) =>
    consumeManufacturingDevelopmentReceiptsV2({
      db: store,
      corporations: [corporation],
      projectsByCorporationId: projects,
      completedTurn,
    });
  return { db, corporation, projects, tick };
}

describe("manufacturing completed-turn lifecycle persistence", () => {
  it("launches an already funded project after 12 zero-cash completed turns and ignores repeated calls", async () => {
    const { db, projects, tick } = world();
    for (let turn = 1; turn <= 12; turn++) {
      await tick(turn);
      await tick(turn);
    }
    expect([...projects.values()][0]).toMatchObject({
      stage: "launch",
      elapsedDevelopmentTurns: 12,
      developmentPaidAnchor: 1000,
      stageStartedTurn: 12,
    });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(1_000_000);
  });

  it("averages actual paid advertising across zero-spend development turns and freezes the window at launch", async () => {
    const { db, corporation, projects, tick } = world();
    const paid = { projectId: "project", turn: 1, amountAnchor: 120 };
    corporation.manufacturingProductAdvertisingReceiptV2 = paid;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductAdvertisingReceiptV2: paid } }
      );
    await tick(1);
    await tick(1);
    expect([...projects.values()][0]).toMatchObject({
      developmentAdvertisingAnchor: 120,
      developmentAdvertisingTurns: 1,
      productBrand: 120,
      lastAdvertisingReceiptTurn: 1,
    });
    expect(corporation.manufacturingProductAdvertisingReceiptV2).toBeUndefined();
    for (let turn = 2; turn <= 12; turn++) await tick(turn);
    expect([...projects.values()][0]).toMatchObject({
      stage: "launch",
      productBrand: 10,
      developmentAdvertisingTurns: 12,
      developmentCompletedTurn: 12,
    });
    // A late funded development order can be acknowledged without including
    // subsequent marketing in the launched product's frozen development window.
    const late = { projectId: "project", turn: 11, amountAnchor: 120 };
    corporation.manufacturingProductAdvertisingReceiptV2 = late;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductAdvertisingReceiptV2: late } }
      );
    await tick(13);
    expect([...projects.values()][0]).toMatchObject({
      productBrand: 20,
      developmentAdvertisingTurns: 12,
      lastAdvertisingReceiptTurn: 11,
    });
    await tick(35);
    const postlaunch = { projectId: "project", turn: 20, amountAnchor: 99999 };
    corporation.manufacturingProductAdvertisingReceiptV2 = postlaunch;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductAdvertisingReceiptV2: postlaunch } }
      );
    await tick(36);
    expect([...projects.values()][0]).toMatchObject({
      stage: "growth",
      productBrand: 20,
      developmentAdvertisingTurns: 12,
      developmentCompletedTurn: 12,
    });
    expect(corporation.manufacturingProductAdvertisingReceiptV2).toBeUndefined();
  });

  it("keeps paid advertising evidence across a project CAS race and acknowledges it on the next turn", async () => {
    const { db, corporation, projects, tick } = world({
      lastProcessedTurn: 10,
      elapsedDevelopmentTurns: 10,
    });
    const paid = { projectId: "project", turn: 10, amountAnchor: 110 };
    corporation.manufacturingProductAdvertisingReceiptV2 = paid;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductAdvertisingReceiptV2: paid } }
      );
    const collection = db.collection(MANUFACTURING_PRODUCT_PROJECTS_V2);
    const original = collection.bulkWrite.bind(collection);
    vi.spyOn(collection, "bulkWrite").mockImplementationOnce(async () => {
      await collection.updateOne(
        { _id: "project" },
        { $set: { lastProcessedTurn: 11, elapsedDevelopmentTurns: 11 } }
      );
      return { matchedCount: 0 } as never;
    });
    await tick(11);
    expect(corporation.manufacturingProductAdvertisingReceiptV2).toEqual(paid);
    expect([...projects.values()][0]?.developmentAdvertisingAnchor).toBeUndefined();
    vi.mocked(collection.bulkWrite).mockImplementation(original);
    await tick(12);
    expect([...projects.values()][0]).toMatchObject({
      developmentAdvertisingAnchor: 110,
      developmentAdvertisingTurns: 12,
      lastAdvertisingReceiptTurn: 10,
    });
    expect(corporation.manufacturingProductAdvertisingReceiptV2).toBeUndefined();
  });

  it("keeps zero-budget development unlaunched despite the completed-turn clock", async () => {
    const { projects, tick } = world({ developmentPaidAnchor: 0 });
    for (let turn = 1; turn <= 20; turn++) await tick(turn);
    expect([...projects.values()][0]).toMatchObject({
      stage: "development",
      elapsedDevelopmentTurns: 20,
      developmentPaidAnchor: 0,
    });
  });

  it("progresses every postlaunch stage without new R&D and releases the active slot on retirement", async () => {
    const { db, projects, tick } = world({
      stage: "launch",
      stageStartedTurn: 12,
      lastProcessedTurn: 12,
      elapsedDevelopmentTurns: 12,
    });
    for (const [turn, stage] of [
      [35, "growth"],
      [82, "mature"],
      [201, "decline"],
      [260, "retired"],
    ] as const) {
      await tick(turn);
      await tick(turn);
      expect([...projects.values()][0]?.stage).toBe(stage);
    }
    expect(
      db.collection(MANUFACTURING_PRODUCT_PROJECTS_V2).docs[0]?.activeCorporationId
    ).toBeUndefined();
    expect([...projects.values()][0]?.activeCorporationId).toBeUndefined();
  });

  it("acknowledges a delayed paid receipt independently from the later lifecycle clock", async () => {
    const { db, corporation, projects, tick } = world({
      developmentPaidAnchor: 900,
      elapsedDevelopmentTurns: 10,
      lastProcessedTurn: 10,
      lastDevelopmentReceiptTurn: 8,
    });
    const receipt = { projectId: "project", turn: 9, amountAnchor: 100 };
    corporation.manufacturingProductDevelopmentReceiptV2 = receipt;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductDevelopmentReceiptV2: receipt } }
      );
    await tick(11);
    await tick(11);
    await tick(12);
    expect([...projects.values()][0]).toMatchObject({
      stage: "launch",
      developmentPaidAnchor: 1000,
      lastDevelopmentReceiptTurn: 9,
      elapsedDevelopmentTurns: 12,
    });
    expect(
      db.collection("corporations").docs[0]?.manufacturingProductDevelopmentReceiptV2
    ).toBeUndefined();
  });

  it("retains future receipts and treats a legacy processed receipt as already paid", async () => {
    const { db, corporation, projects, tick } = world({
      developmentPaidAnchor: 1000,
      lastProcessedTurn: 9,
      elapsedDevelopmentTurns: 9,
    });
    const receipt = { projectId: "project", turn: 12, amountAnchor: 100 };
    corporation.manufacturingProductDevelopmentReceiptV2 = receipt;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductDevelopmentReceiptV2: receipt } }
      );
    await tick(10);
    expect(corporation.manufacturingProductDevelopmentReceiptV2).toEqual(receipt);
    expect([...projects.values()][0]?.developmentPaidAnchor).toBe(1000);
    corporation.manufacturingProductDevelopmentReceiptV2 = { ...receipt, turn: 9 };
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductDevelopmentReceiptV2: { ...receipt, turn: 9 } } }
      );
    await tick(11);
    expect([...projects.values()][0]?.developmentPaidAnchor).toBe(1000);
    expect(corporation.manufacturingProductDevelopmentReceiptV2).toBeUndefined();
  });

  it("resumes after a crash between the project acknowledgment and receipt removal", async () => {
    const { db, corporation, projects, tick } = world({
      developmentPaidAnchor: 900,
      elapsedDevelopmentTurns: 11,
      lastProcessedTurn: 11,
    });
    const receipt = { projectId: "project", turn: 12, amountAnchor: 100 };
    corporation.manufacturingProductDevelopmentReceiptV2 = receipt;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductDevelopmentReceiptV2: receipt } }
      );
    const crash = withInjectedCrash(db, {
      collection: MANUFACTURING_PRODUCT_PROJECTS_V2,
      op: "bulkWrite",
      onCall: 1,
      afterWrite: true,
    });
    await expect(tick(12, crash.db)).rejects.toBeInstanceOf(InjectedCrash);
    expect(corporation.manufacturingProductDevelopmentReceiptV2).toEqual(receipt);
    await tick(12);
    await tick(12);
    expect([...projects.values()][0]).toMatchObject({
      stage: "launch",
      developmentPaidAnchor: 1000,
      lastDevelopmentReceiptTurn: 12,
    });
    expect(
      db.collection("corporations").docs[0]?.manufacturingProductDevelopmentReceiptV2
    ).toBeUndefined();
  });

  it("keeps unacknowledged paid cash when a concurrent project write defeats the clock CAS", async () => {
    const { db, corporation, tick } = world({
      developmentPaidAnchor: 900,
      lastProcessedTurn: 10,
      elapsedDevelopmentTurns: 10,
    });
    const receipt = { projectId: "project", turn: 11, amountAnchor: 100 };
    corporation.manufacturingProductDevelopmentReceiptV2 = receipt;
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { manufacturingProductDevelopmentReceiptV2: receipt } }
      );
    const collection = db.collection(MANUFACTURING_PRODUCT_PROJECTS_V2);
    const write = vi.spyOn(collection, "bulkWrite").mockImplementationOnce(async () => {
      await collection.updateOne(
        { _id: "project" },
        {
          $set: {
            lastProcessedTurn: 11,
            lastDevelopmentReceiptTurn: 10,
            elapsedDevelopmentTurns: 11,
          },
        }
      );
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedIds: {} };
    });
    await tick(11);
    expect(corporation.manufacturingProductDevelopmentReceiptV2).toEqual(receipt);
    write.mockRestore();
    await tick(12);
    expect(db.collection(MANUFACTURING_PRODUCT_PROJECTS_V2).docs[0]).toMatchObject({
      developmentPaidAnchor: 1000,
      lastDevelopmentReceiptTurn: 11,
      stage: "launch",
    });
  });
});
