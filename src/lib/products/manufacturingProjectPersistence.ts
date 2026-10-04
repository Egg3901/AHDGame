/**
 * Persistence for the v2 manufacturing product project slot. The unique partial index protects
 * one active project per corporation on standalone Mongo without a transaction.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { advanceManufacturingProject } from "./manufacturingRules";
import {
  MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2,
  MANUFACTURING_PRODUCT_PROJECTS_V2,
  type ManufacturingProductProject,
  type ManufacturingDevelopmentCashReceiptV2,
} from "./manufacturingProject";

export async function ensureManufacturingProductProjectIndexesV2(db: Db): Promise<string> {
  await db.collection(MANUFACTURING_PRODUCT_PROJECTS_V2).createIndex(
    { activeCorporationId: 1 },
    {
      name: MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2,
      unique: true,
      partialFilterExpression: { activeCorporationId: { $exists: true } },
    }
  );
  return MANUFACTURING_PRODUCT_ACTIVE_INDEX_V2;
}

export function activeManufacturingProductProjectProjection() {
  return {
    _id: 1,
    corporationId: 1,
    activeCorporationId: 1,
    kindId: 1,
    stage: 1,
    stageStartedTurn: 1,
    allocations: 1,
    startedTurn: 1,
    lastProcessedTurn: 1,
    developmentPaidAnchor: 1,
    paidThresholdAnchor: 1,
    elapsedDevelopmentTurns: 1,
    elapsedThresholdTurns: 1,
  } as const satisfies Partial<Record<keyof ManufacturingProductProject, 1>>;
}

/**
 * Applies durable, project-bound R&D receipts once before the next turn can replace them.
 * The project write is a turn CAS; a receipt is cleared only after that write landed.
 */
export async function consumeManufacturingDevelopmentReceiptsV2(input: {
  db: Db;
  corporations: Corporation[];
  projectsByCorporationId: Map<string, ManufacturingProductProject>;
}): Promise<void> {
  const receiptByCorporationId = new Map<
    string,
    { corporation: Corporation; receipt: ManufacturingDevelopmentCashReceiptV2 }
  >();
  const projectOps = [];
  const projectedProgress = new Map<string, ReturnType<typeof advanceManufacturingProject>>();
  const staleReceipts = new Set<string>();

  for (const corporation of input.corporations) {
    const receipt = corporation.manufacturingProductDevelopmentReceiptV2;
    if (!receipt) continue;
    const corporationId = corporation._id.toString();
    const project = input.projectsByCorporationId.get(corporationId);
    if (!project || project._id !== receipt.projectId) {
      staleReceipts.add(corporationId);
      continue;
    }
    const progress = advanceManufacturingProject({ project, receipt });
    if (!progress) {
      staleReceipts.add(corporationId);
      continue;
    }
    receiptByCorporationId.set(corporationId, { corporation, receipt });
    projectedProgress.set(corporationId, progress);
    projectOps.push({
      updateOne: {
        filter: {
          _id: project._id,
          activeCorporationId: corporationId,
          $or: [
            { lastProcessedTurn: { $exists: false } },
            { lastProcessedTurn: { $lt: receipt.turn } },
          ],
        },
        update: {
          $set: {
            stage: progress.stage,
            stageStartedTurn: progress.stageStartedTurn,
            lastProcessedTurn: progress.lastProcessedTurn,
            developmentPaidAnchor: progress.developmentPaidAnchor,
            elapsedDevelopmentTurns: progress.elapsedDevelopmentTurns,
          },
          ...(progress.active ? {} : { $unset: { activeCorporationId: "" } }),
        },
      },
    });
  }

  let landedCorporations = new Set(receiptByCorporationId.keys());
  if (projectOps.length > 0) {
    const result = await input.db
      .collection<ManufacturingProductProject>(MANUFACTURING_PRODUCT_PROJECTS_V2)
      .bulkWrite(projectOps, { ordered: false });
    if (result.matchedCount !== projectOps.length) {
      const currentProjects = await input.db
        .collection<ManufacturingProductProject>(MANUFACTURING_PRODUCT_PROJECTS_V2)
        .find({ _id: { $in: [...receiptByCorporationId.values()].map(({ receipt }) => receipt.projectId) } })
        .project(activeManufacturingProductProjectProjection())
        .toArray();
      const currentById = new Map(currentProjects.map((project) => [project._id, project]));
      landedCorporations = new Set();
      for (const [corporationId, { receipt }] of receiptByCorporationId) {
        const project = currentById.get(receipt.projectId);
        if (project && project.lastProcessedTurn! >= receipt.turn) {
          landedCorporations.add(corporationId);
          input.projectsByCorporationId.set(corporationId, project);
        }
      }
    } else {
      for (const [corporationId, progress] of projectedProgress) {
        const previous = input.projectsByCorporationId.get(corporationId);
        if (!previous || !progress) continue;
        const updated: ManufacturingProductProject = { ...previous, ...progress };
        if (!progress.active) delete updated.activeCorporationId;
        input.projectsByCorporationId.set(corporationId, updated);
      }
    }
  }

  const clearCorporationIds = new Set([...staleReceipts, ...landedCorporations]);
  if (clearCorporationIds.size > 0) {
    await input.db.collection<Corporation>("corporations").bulkWrite(
      [...clearCorporationIds].flatMap((corporationId) => {
        const corporation = input.corporations.find(
          (candidate) => candidate._id.toString() === corporationId
        );
        const receipt = corporation?.manufacturingProductDevelopmentReceiptV2;
        return receipt
          ? [
              {
                updateOne: {
                  filter: {
                    _id: corporation!._id,
                    "manufacturingProductDevelopmentReceiptV2.projectId": receipt.projectId,
                    "manufacturingProductDevelopmentReceiptV2.turn": receipt.turn,
                  },
                  update: { $unset: { manufacturingProductDevelopmentReceiptV2: "" } },
                },
              },
            ]
          : [];
      })
    );
    for (const corporationId of clearCorporationIds) {
      const corporation = input.corporations.find(
        (candidate) => candidate._id.toString() === corporationId
      );
      if (corporation) delete corporation.manufacturingProductDevelopmentReceiptV2;
    }
  }
}
