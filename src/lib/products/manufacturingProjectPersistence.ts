/**
 * Persistence for the v2 manufacturing product project slot. The unique partial index protects
 * one active project per corporation on standalone Mongo without a transaction.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { tickManufacturingProject } from "./rules/manufacturingRules";
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
    lastDevelopmentReceiptTurn: 1,
    developmentPaidAnchor: 1,
    paidThresholdAnchor: 1,
    elapsedDevelopmentTurns: 1,
    elapsedThresholdTurns: 1,
  } as const satisfies Partial<Record<keyof ManufacturingProductProject, 1>>;
}

/**
 * Advances active projects from completed turns, even with no new cash. Paid
 * receipts retain their separate acknowledgment until the project CAS lands.
 */
export async function consumeManufacturingDevelopmentReceiptsV2(input: {
  db: Db;
  corporations: Corporation[];
  projectsByCorporationId: Map<string, ManufacturingProductProject>;
  completedTurn?: number;
}): Promise<void> {
  const projectOps: AnyBulkWriteOperation<ManufacturingProductProject>[] = [];
  const nextByCorporationId = new Map<string, ManufacturingProductProject>();
  const receiptsToClear = new Map<
    string,
    {
      corporation: Corporation;
      receipt: ManufacturingDevelopmentCashReceiptV2;
    }
  >();

  for (const corporation of input.corporations) {
    const corporationId = corporation._id.toString();
    const project = input.projectsByCorporationId.get(corporationId);
    const receipt = corporation.manufacturingProductDevelopmentReceiptV2;
    const completedTurn = input.completedTurn ?? receipt?.turn;
    if (completedTurn === undefined || !Number.isSafeInteger(completedTurn) || completedTurn < 0)
      continue;
    const completedReceipt =
      receipt && Number.isSafeInteger(receipt.turn) && receipt.turn <= completedTurn
        ? receipt
        : undefined;
    if (!project) {
      if (completedReceipt)
        receiptsToClear.set(corporationId, { corporation, receipt: completedReceipt });
      continue;
    }
    const cashWatermark = project.lastDevelopmentReceiptTurn ?? project.lastProcessedTurn ?? 0;
    if (
      completedReceipt &&
      (completedReceipt.projectId !== project._id || completedReceipt.turn <= cashWatermark)
    ) {
      receiptsToClear.set(corporationId, { corporation, receipt: completedReceipt });
    }
    const progress = tickManufacturingProject({
      project,
      receipt: completedReceipt,
      completedTurn,
    });
    if (!progress) continue;
    const { active, ...persistedProgress } = progress;
    const next = { ...project, ...persistedProgress };
    if (!active) delete next.activeCorporationId;
    nextByCorporationId.set(corporationId, next);
    projectOps.push({
      updateOne: {
        filter: {
          _id: project._id,
          activeCorporationId: corporationId,
          lastProcessedTurn: project.lastProcessedTurn ?? { $exists: false },
          lastDevelopmentReceiptTurn: project.lastDevelopmentReceiptTurn ?? { $exists: false },
          developmentPaidAnchor: project.developmentPaidAnchor,
        },
        update: {
          $set: persistedProgress,
          ...(active ? {} : { $unset: { activeCorporationId: 1 } }),
        },
      },
    });
  }

  if (projectOps.length > 0) {
    const result = await input.db
      .collection<ManufacturingProductProject>(MANUFACTURING_PRODUCT_PROJECTS_V2)
      .bulkWrite(projectOps, { ordered: false });
    if (result.matchedCount !== projectOps.length) {
      // A concurrent retirement or clock writer can win. Only the stored
      // acknowledgment allows its matching paid cash receipt to be cleared.
      const current = await input.db
        .collection<ManufacturingProductProject>(MANUFACTURING_PRODUCT_PROJECTS_V2)
        .find({ _id: { $in: [...nextByCorporationId.values()].map((project) => project._id) } })
        .project<ManufacturingProductProject>(activeManufacturingProductProjectProjection())
        .toArray();
      const currentById = new Map(current.map((project) => [project._id, project]));
      for (const [corporationId, next] of nextByCorporationId) {
        const stored = currentById.get(next._id);
        if (stored) input.projectsByCorporationId.set(corporationId, stored);
      }
    } else {
      for (const [corporationId, next] of nextByCorporationId)
        input.projectsByCorporationId.set(corporationId, next);
    }
  }

  for (const corporation of input.corporations) {
    const receipt = corporation.manufacturingProductDevelopmentReceiptV2;
    if (!receipt || (input.completedTurn !== undefined && receipt.turn > input.completedTurn))
      continue;
    const corporationId = corporation._id.toString();
    const stored = input.projectsByCorporationId.get(corporationId);
    const watermark = stored?.lastDevelopmentReceiptTurn ?? stored?.lastProcessedTurn ?? 0;
    if (stored?._id === receipt.projectId && receipt.turn <= watermark) {
      receiptsToClear.set(corporationId, { corporation, receipt });
    }
  }

  if (receiptsToClear.size === 0) return;
  const receiptOps: AnyBulkWriteOperation<Corporation>[] = [...receiptsToClear.values()].map(
    ({ corporation, receipt }) => ({
      updateOne: {
        filter: {
          _id: corporation._id,
          "manufacturingProductDevelopmentReceiptV2.projectId": receipt.projectId,
          "manufacturingProductDevelopmentReceiptV2.turn": receipt.turn,
          "manufacturingProductDevelopmentReceiptV2.amountAnchor": receipt.amountAnchor,
        },
        update: { $unset: { manufacturingProductDevelopmentReceiptV2: "" } },
      },
    })
  );
  const cleared = await input.db
    .collection<Corporation>("corporations")
    .bulkWrite(receiptOps, { ordered: false });
  let clearedIds = new Set(receiptsToClear.keys());
  if (cleared.matchedCount !== receiptOps.length) {
    const current = await input.db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: [...receiptsToClear.values()].map(({ corporation }) => corporation._id) } },
        { projection: { _id: 1, manufacturingProductDevelopmentReceiptV2: 1 } }
      )
      .toArray();
    clearedIds = new Set(
      current
        .filter((corp) => !corp.manufacturingProductDevelopmentReceiptV2)
        .map((corp) => corp._id.toString())
    );
  }
  for (const [corporationId, { corporation }] of receiptsToClear) {
    if (clearedIds.has(corporationId)) delete corporation.manufacturingProductDevelopmentReceiptV2;
  }
}
