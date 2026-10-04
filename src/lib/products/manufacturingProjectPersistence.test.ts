import { describe, expect, it, vi } from "vitest";
import {
  consumeManufacturingDevelopmentReceiptsV2,
  ensureManufacturingProductProjectIndexesV2,
} from "./manufacturingProjectPersistence";
import {
  MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2,
  MANUFACTURING_PRODUCT_PROJECTS_V2,
} from "./manufacturingProject";

describe("manufacturing product project persistence v2", () => {
  it("registers a standalone-safe unique partial active-project slot", async () => {
    const createIndex = vi.fn().mockResolvedValue(MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2);
    const db = { collection: vi.fn().mockReturnValue({ createIndex }) };

    await expect(ensureManufacturingProductProjectIndexesV2(db as never)).resolves.toBe(
      MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2
    );
    expect(db.collection).toHaveBeenCalledWith(MANUFACTURING_PRODUCT_PROJECTS_V2);
    expect(createIndex).toHaveBeenCalledWith(
      { activeCorporationId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { activeCorporationId: { $exists: true } },
      })
    );
  });

  it("consumes an atomic cash receipt once and advances the in-memory project", async () => {
    const corporationId = "corp-1";
    const project = {
      _id: "project-1",
      corporationId,
      activeCorporationId: corporationId,
      kindId: "passenger_car",
      stage: "development" as const,
      stageStartedTurn: 5,
      allocations: [{ sectorId: "sector-1", share: 1 }],
      startedTurn: 5,
      lastProcessedTurn: 5,
      developmentPaidAnchor: 900,
      paidThresholdAnchor: 1000,
      elapsedDevelopmentTurns: 1,
      elapsedThresholdTurns: 2,
    };
    const projectBulkWrite = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const corporationBulkWrite = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: vi.fn((name: string) =>
        name === MANUFACTURING_PRODUCT_PROJECTS_V2
          ? { bulkWrite: projectBulkWrite }
          : { bulkWrite: corporationBulkWrite }
      ),
    };
    const corporation = {
      _id: { toString: () => corporationId },
      manufacturingProductDevelopmentReceiptV2: {
        projectId: "project-1",
        turn: 6,
        amountAnchor: 100,
      },
    };
    const projects = new Map([[corporationId, project]]);

    await consumeManufacturingDevelopmentReceiptsV2({
      db: db as never,
      corporations: [corporation] as never,
      projectsByCorporationId: projects,
    });

    const projectWrite = projectBulkWrite.mock.calls[0][0][0];
    expect(projectWrite.updateOne.filter).toMatchObject({
      _id: "project-1",
      activeCorporationId: corporationId,
      $or: [
        { lastProcessedTurn: { $exists: false } },
        { lastProcessedTurn: { $lt: 6 } },
      ],
    });
    expect(projectWrite.updateOne.update.$set).toMatchObject({
      stage: "launch",
      developmentPaidAnchor: 1000,
      elapsedDevelopmentTurns: 2,
      lastProcessedTurn: 6,
    });
    expect(corporationBulkWrite.mock.calls[0][0][0].updateOne.update).toEqual({
      $unset: { manufacturingProductDevelopmentReceiptV2: "" },
    });
    expect(projects.get(corporationId)?.stage).toBe("launch");
    expect(corporation.manufacturingProductDevelopmentReceiptV2).toBeUndefined();
  });

  it("clears an old project's receipt without transferring it to the active project", async () => {
    const projectBulkWrite = vi.fn();
    const corporationBulkWrite = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: vi.fn((name: string) =>
        name === MANUFACTURING_PRODUCT_PROJECTS_V2
          ? { bulkWrite: projectBulkWrite }
          : { bulkWrite: corporationBulkWrite }
      ),
    };
    const corporation = {
      _id: { toString: () => "corp-1" },
      manufacturingProductDevelopmentReceiptV2: {
        projectId: "project-old",
        turn: 6,
        amountAnchor: 500,
      },
    };

    await consumeManufacturingDevelopmentReceiptsV2({
      db: db as never,
      corporations: [corporation] as never,
      projectsByCorporationId: new Map([
        [
          "corp-1",
          {
            _id: "project-new",
            corporationId: "corp-1",
            activeCorporationId: "corp-1",
            kindId: "passenger_car",
            stage: "development",
            stageStartedTurn: 7,
            allocations: [],
            startedTurn: 7,
            developmentPaidAnchor: 0,
            paidThresholdAnchor: 1000,
            elapsedDevelopmentTurns: 0,
            elapsedThresholdTurns: 2,
          },
        ],
      ]),
    });

    expect(projectBulkWrite).not.toHaveBeenCalled();
    expect(corporationBulkWrite).toHaveBeenCalledOnce();
    expect(corporation.manufacturingProductDevelopmentReceiptV2).toBeUndefined();
  });
});
