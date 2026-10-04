import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { MediaProductProject } from "./mediaProduct";
import { processMediaProductProjectsV1, startNppMediaProductsV1 } from "./mediaProductPersistence";

function project(overrides: Partial<MediaProductProject> = {}): MediaProductProject {
  return {
    _id: "project-1",
    corporationId: "corp-1",
    activeDevelopmentCorporationId: "corp-1",
    sectorId: "sector-1",
    operatingSectorType: "media",
    kindId: "newspaper_edition",
    title: "Daily Record",
    allocationShare: 0.5,
    stage: "development",
    startedTurn: 10,
    stageStartedTurn: 10,
    developmentPaidAnchor: 0,
    paidThresholdAnchor: 10,
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: 2,
    developmentAdvertisingAnchor: 0,
    developmentAdvertisingTurns: 0,
    ...overrides,
  };
}

function database(options?: { matchedCount?: number; rows?: MediaProductProject[] }) {
  const projectCollection = {
    bulkWrite: vi.fn().mockResolvedValue({ matchedCount: options?.matchedCount ?? 1 }),
    insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
    find: vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(options?.rows ?? []),
    }),
  };
  const corporationCollection = { bulkWrite: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
  const db = {
    collection: vi.fn((name: string) =>
      name === "mediaProductProjectsV1" ? projectCollection : corporationCollection
    ),
  };
  return { db: db as unknown as Db, projectCollection, corporationCollection };
}

describe("processMediaProductProjectsV1", () => {
  it("consumes only a persisted receipt for the completed turn and clears it after project progress", async () => {
    const { db, projectCollection, corporationCollection } = database();
    const corporationId = new ObjectId();
    const corporation = {
      _id: corporationId,
      mediaProductDevelopmentReceiptV1: {
        projectId: "project-1",
        turn: 11,
        amountAnchor: 5,
        deliveredAdvertisingAnchor: 120,
      },
    } as Corporation;
    const projects = new Map([
      [corporationId.toString(), [project({ corporationId: corporationId.toString() })]],
    ]);

    await processMediaProductProjectsV1({
      db,
      corporations: [corporation],
      projectsByCorporationId: projects,
      currentTurn: 12,
      sectorQualityBySectorId: new Map([["sector-1", 60]]),
    });

    const operation = projectCollection.bulkWrite.mock.calls[0]?.[0][0];
    expect(operation).toMatchObject({
      updateOne: {
        filter: {
          _id: "project-1",
          corporationId: corporationId.toString(),
          stage: "development",
          activeDevelopmentCorporationId: "corp-1",
          lastProcessedTurn: { $exists: false },
        },
        update: { $set: { lastProcessedTurn: 11, developmentPaidAnchor: 5 } },
      },
    });
    expect(corporationCollection.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: {
              _id: corporation._id,
              "mediaProductDevelopmentReceiptV1.projectId": "project-1",
              "mediaProductDevelopmentReceiptV1.turn": 11,
            },
            update: { $unset: { mediaProductDevelopmentReceiptV1: "" } },
          },
        },
      ],
      { ordered: false }
    );
    expect(corporation.mediaProductDevelopmentReceiptV1).toBeUndefined();
  });

  it("does not replay an already processed receipt and clears its durable retry marker", async () => {
    const { db, projectCollection, corporationCollection } = database();
    const corporationId = new ObjectId();
    const corporation = {
      _id: corporationId,
      mediaProductDevelopmentReceiptV1: {
        projectId: "project-1",
        turn: 11,
        amountAnchor: 5,
        deliveredAdvertisingAnchor: 120,
      },
    } as Corporation;

    await processMediaProductProjectsV1({
      db,
      corporations: [corporation],
      projectsByCorporationId: new Map([
        [
          corporationId.toString(),
          [project({ corporationId: corporationId.toString(), lastProcessedTurn: 11 })],
        ],
      ]),
      currentTurn: 12,
      sectorQualityBySectorId: new Map(),
    });

    expect(projectCollection.bulkWrite).not.toHaveBeenCalled();
    expect(corporationCollection.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("keeps the paid receipt when the project compare-and-set did not persist", async () => {
    const corporationId = new ObjectId();
    const { db, projectCollection, corporationCollection } = database({
      matchedCount: 0,
      rows: [project({ lastProcessedTurn: 10, corporationId: corporationId.toString() })],
    });
    const receipt = {
      projectId: "project-1",
      turn: 11,
      amountAnchor: 5,
      deliveredAdvertisingAnchor: 120,
    };
    const corporation = {
      _id: corporationId,
      mediaProductDevelopmentReceiptV1: receipt,
    } as Corporation;

    await processMediaProductProjectsV1({
      db,
      corporations: [corporation],
      projectsByCorporationId: new Map([
        [corporationId.toString(), [project({ corporationId: corporationId.toString() })]],
      ]),
      currentTurn: 12,
      sectorQualityBySectorId: new Map(),
    });

    expect(projectCollection.find).toHaveBeenCalledTimes(1);
    expect(corporationCollection.bulkWrite).not.toHaveBeenCalled();
    expect(corporation.mediaProductDevelopmentReceiptV1).toEqual(receipt);
  });

  it("consumes a guarded paid advertising receipt without requiring positive R&D", async () => {
    const { db, projectCollection, corporationCollection } = database();
    const corporationId = new ObjectId();
    const corporation = {
      _id: corporationId,
      mediaProductAdvertisingReceiptV1: {
        projectId: "project-1",
        turn: 11,
        amountAnchor: 300,
      },
    } as Corporation;
    const projects = new Map([
      [
        corporationId.toString(),
        [project({ corporationId: corporationId.toString(), elapsedDevelopmentTurns: 1 })],
      ],
    ]);

    await processMediaProductProjectsV1({
      db,
      corporations: [corporation],
      projectsByCorporationId: projects,
      currentTurn: 12,
      sectorQualityBySectorId: new Map(),
    });

    expect(projectCollection.bulkWrite.mock.calls[0]?.[0][0]).toMatchObject({
      updateOne: {
        update: { $set: { developmentAdvertisingAnchor: 300, developmentAdvertisingTurns: 1 } },
      },
    });
    expect(corporationCollection.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: {
              _id: corporation._id,
              "mediaProductAdvertisingReceiptV1.projectId": "project-1",
              "mediaProductAdvertisingReceiptV1.turn": 11,
            },
            update: { $unset: { mediaProductAdvertisingReceiptV1: "" } },
          },
        },
      ],
      { ordered: false }
    );
  });

  it("refreshes a CAS loser before downstream sector effects use the project snapshot", async () => {
    const corporationId = new ObjectId();
    const retired = project({
      corporationId: corporationId.toString(),
      stage: "retired",
      activeDevelopmentCorporationId: undefined,
      lastProcessedTurn: 10,
    });
    const { db, projectCollection } = database({ matchedCount: 0, rows: [retired] });
    const projects = new Map([
      [corporationId.toString(), [project({ corporationId: corporationId.toString() })]],
    ]);

    await processMediaProductProjectsV1({
      db,
      corporations: [
        {
          _id: corporationId,
          mediaProductAdvertisingReceiptV1: {
            projectId: "project-1",
            turn: 11,
            amountAnchor: 300,
          },
        } as Corporation,
      ],
      projectsByCorporationId: projects,
      currentTurn: 12,
      sectorQualityBySectorId: new Map(),
    });

    expect(projectCollection.find).toHaveBeenCalledTimes(1);
    expect(projects.get(corporationId.toString())?.[0]).toMatchObject({
      stage: "retired",
      activeDevelopmentCorporationId: undefined,
      lastProcessedTurn: 10,
    });
  });

  it("releases the active development slot when chronic unpaid development retires", async () => {
    const { db, projectCollection } = database();
    const corporationId = new ObjectId();
    const chronic = project({
      corporationId: corporationId.toString(),
      elapsedDevelopmentTurns: 7,
      elapsedThresholdTurns: 2,
      lastProcessedTurn: 10,
    });

    await processMediaProductProjectsV1({
      db,
      corporations: [{ _id: corporationId } as Corporation],
      projectsByCorporationId: new Map([[corporationId.toString(), [chronic]]]),
      currentTurn: 12,
      sectorQualityBySectorId: new Map(),
    });

    const operation = projectCollection.bulkWrite.mock.calls[0]?.[0][0];
    expect(operation).toMatchObject({
      updateOne: {
        filter: {
          stage: "development",
          activeDevelopmentCorporationId: "corp-1",
          lastProcessedTurn: 10,
        },
        update: {
          $set: { stage: "retired", lastProcessedTurn: 11 },
          $unset: { activeDevelopmentCorporationId: 1 },
        },
      },
    });
  });

  it("lets an NPP reuse slate capacity released by retired titles", async () => {
    const { db, projectCollection } = database();
    const corporationId = new ObjectId();
    const retiredProjects = Array.from({ length: 4 }, (_, index) =>
      project({
        _id: `retired-${index}`,
        corporationId: corporationId.toString(),
        stage: "retired",
        activeDevelopmentCorporationId: undefined,
      })
    );
    const projectsByCorporationId = new Map([[corporationId.toString(), retiredProjects]]);
    const sectorId = new ObjectId();

    const started = await startNppMediaProductsV1({
      db,
      corporations: [{ _id: corporationId, ceoType: "npp" } as Corporation],
      sectorsByCorp: new Map([
        [
          corporationId.toString(),
          [
            {
              _id: sectorId,
              sectorType: "media",
              strategyId: "newspaper",
              capitalStock: 10_000,
              revenue: 10_000,
            } as unknown as CorporateSector,
          ],
        ],
      ]),
      projectsByCorporationId,
      currentYear: 1991,
      currentTurn: 100,
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      corporationId: corporationId.toString(),
      stage: "development",
      sectorId: sectorId.toString(),
    });
    expect(projectCollection.insertMany).toHaveBeenCalledTimes(1);
  });
});
