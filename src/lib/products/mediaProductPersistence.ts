/**
 * Media product turn persistence applies project receipts once and releases the
 * development slot at launch. Receipt clearing follows the project compare-and-set.
 */
import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { TECH_TREE } from "@/lib/constants/techTree/nodes";
import { sectorCapacityBookAnchor } from "@/lib/corporations/sectorProfitBasis";
import { efficacyAdjustedAdvertising } from "@/lib/advertising/rules/coverage";
import { getMediaProductKind } from "./mediaProductCatalog";
import { MEDIA_PRODUCT_PROJECTS, type MediaProductProject } from "./mediaProduct";
import {
  advanceMediaProduct,
  chooseNppMediaProduct,
  mediaDevelopmentThresholdAnchor,
  shouldRetireChronicMediaDevelopment,
} from "./rules/mediaProductRules";

interface MediaProductReceiptCorp extends Pick<Corporation, "_id"> {
  mediaProductDevelopmentReceiptV1?: {
    projectId: string;
    turn: number;
    amountAnchor: number;
    deliveredAdvertisingAnchor: number;
  };
  mediaProductAdvertisingReceiptV1?: {
    projectId: string;
    turn: number;
    amountAnchor: number;
  };
  unlockedTechNodeIds?: string[];
}

/**
 * Advance every live catalog title once from funded R&D and ad settlement receipts.
 */
export async function processMediaProductProjectsV1(input: {
  db: Db;
  corporations: readonly MediaProductReceiptCorp[];
  projectsByCorporationId: Map<string, MediaProductProject[]>;
  currentTurn: number;
  sectorQualityBySectorId: ReadonlyMap<string, number>;
  /** Coverage efficacy from advertising agreements, by buyer; absent is neutral. */
  advertisingEfficacyByCorporationId?: ReadonlyMap<string, { turn: number; factor: number }>;
}): Promise<void> {
  const corporationsById = new Map(
    input.corporations.map((corporation) => [corporation._id.toString(), corporation])
  );
  const completedTurn = input.currentTurn - 1;
  if (completedTurn < 0) return;
  const projectOps: AnyBulkWriteOperation<MediaProductProject>[] = [];
  const progressedByCorp = new Map<string, MediaProductProject[]>();
  const projectsById = new Map<string, MediaProductProject>();
  const matchingReceiptCorpIds = new Set<string>();
  const matchingAdvertisingReceiptCorpIds = new Set<string>();

  for (const [corporationId, projects] of input.projectsByCorporationId) {
    const corporation = corporationsById.get(corporationId);
    const receipt = corporation?.mediaProductDevelopmentReceiptV1;
    const advertisingReceipt = corporation?.mediaProductAdvertisingReceiptV1;
    const nextProjects: MediaProductProject[] = [];
    for (const project of projects) {
      projectsById.set(project._id, project);
      if (project.startedTurn > completedTurn) {
        nextProjects.push(project);
        continue;
      }
      if (
        receipt?.projectId === project._id &&
        receipt.turn <= completedTurn &&
        receipt.turn <= (project.lastProcessedTurn ?? -1)
      ) {
        matchingReceiptCorpIds.add(corporationId);
      }
      if (
        advertisingReceipt?.projectId === project._id &&
        advertisingReceipt.turn <= completedTurn &&
        advertisingReceipt.turn <= (project.lastProcessedTurn ?? -1)
      ) {
        matchingAdvertisingReceiptCorpIds.add(corporationId);
      }
      if (project.lastProcessedTurn != null && project.lastProcessedTurn >= completedTurn) {
        nextProjects.push(project);
        continue;
      }
      const kind = getMediaProductKind(project.kindId);
      if (!kind) {
        nextProjects.push(project);
        continue;
      }
      const isDevelopment = project.stage === "development";
      const receiptMatches =
        isDevelopment &&
        receipt?.projectId === project._id &&
        receipt.turn <= completedTurn &&
        receipt.turn > (project.lastProcessedTurn ?? -1);
      const advertisingReceiptMatches =
        isDevelopment &&
        advertisingReceipt?.projectId === project._id &&
        advertisingReceipt.turn <= completedTurn &&
        advertisingReceipt.turn > (project.lastProcessedTurn ?? -1);
      const developmentReceipt = {
        projectId: project._id,
        turn: receiptMatches
          ? receipt.turn
          : advertisingReceiptMatches
            ? advertisingReceipt.turn
            : completedTurn,
        amountAnchor: receiptMatches ? receipt.amountAnchor : 0,
        deliveredAdvertisingAnchor: advertisingReceiptMatches
          ? efficacyAdjustedAdvertising(
              advertisingReceipt.amountAnchor,
              advertisingReceipt.turn,
              input.advertisingEfficacyByCorporationId?.get(corporationId)
            )
          : receiptMatches
            ? efficacyAdjustedAdvertising(
                receipt.deliveredAdvertisingAnchor,
                receipt.turn,
                input.advertisingEfficacyByCorporationId?.get(corporationId)
              )
            : 0,
      };
      const progressed = advanceMediaProduct({
        product: { ...project, id: project._id },
        kind,
        receipt: developmentReceipt,
        sectorQuality: input.sectorQualityBySectorId.get(project.sectorId) ?? null,
        relevantTechnologyUnlocked: (() => {
          if (!kind.technologyNodeName || !corporation) return false;
          const sectorType =
            project.operatingSectorType ??
            (kind.modelId === "film_studio" || kind.modelId === "music_label"
              ? "media_entertainment"
              : "media");
          const node = TECH_TREE[sectorType].find(
            (candidate) => candidate.name === kind.technologyNodeName
          );
          return node !== undefined && corporation.unlockedTechNodeIds?.includes(node.id) === true;
        })(),
      });
      if (!progressed) {
        nextProjects.push(project);
        continue;
      }
      const { id: _productId, ...progressedProduct } = progressed.product;
      const updated: MediaProductProject = {
        ...project,
        ...progressedProduct,
        _id: project._id,
        corporationId,
        sectorId: project.sectorId,
        title: project.title,
        allocationShare: project.allocationShare,
      };
      const chronicDevelopment = shouldRetireChronicMediaDevelopment({
        stage: updated.stage,
        elapsedDevelopmentTurns: updated.elapsedDevelopmentTurns,
        kind,
      });
      if (chronicDevelopment) updated.stage = "retired";
      if (!progressed.activeDevelopment || chronicDevelopment)
        delete updated.activeDevelopmentCorporationId;
      nextProjects.push(updated);
      if (receiptMatches) matchingReceiptCorpIds.add(corporationId);
      if (advertisingReceiptMatches) matchingAdvertisingReceiptCorpIds.add(corporationId);
      projectOps.push({
        updateOne: {
          filter: {
            _id: project._id,
            corporationId,
            stage: project.stage,
            ...(project.activeDevelopmentCorporationId
              ? { activeDevelopmentCorporationId: project.activeDevelopmentCorporationId }
              : { activeDevelopmentCorporationId: { $exists: false } }),
            ...(project.lastProcessedTurn === undefined
              ? { lastProcessedTurn: { $exists: false } }
              : { lastProcessedTurn: project.lastProcessedTurn }),
          },
          update: {
            $set: {
              stage: updated.stage,
              stageStartedTurn: updated.stageStartedTurn,
              lastProcessedTurn: updated.lastProcessedTurn,
              developmentPaidAnchor: updated.developmentPaidAnchor,
              elapsedDevelopmentTurns: updated.elapsedDevelopmentTurns,
              developmentAdvertisingAnchor: updated.developmentAdvertisingAnchor,
              developmentAdvertisingTurns: updated.developmentAdvertisingTurns,
              ...(updated.launchQuality !== undefined
                ? { launchQuality: updated.launchQuality }
                : {}),
              ...(updated.qualityBonus !== undefined ? { qualityBonus: updated.qualityBonus } : {}),
              ...(updated.productBrand !== undefined ? { productBrand: updated.productBrand } : {}),
            },
            ...(progressed.activeDevelopment && !chronicDevelopment
              ? {}
              : { $unset: { activeDevelopmentCorporationId: 1 } }),
          },
        },
      });
    }
    progressedByCorp.set(corporationId, nextProjects);
  }

  const projectResult =
    projectOps.length > 0
      ? await input.db
          .collection<MediaProductProject>(MEDIA_PRODUCT_PROJECTS)
          .bulkWrite(projectOps, { ordered: false })
      : null;
  if (!projectResult || projectResult.matchedCount === projectOps.length) {
    for (const [corporationId, projects] of progressedByCorp) {
      input.projectsByCorporationId.set(corporationId, projects);
    }
  } else if (projectResult) {
    const projectIds = projectOps.flatMap((op) => {
      if ("updateOne" in op && typeof op.updateOne.filter._id === "string") {
        return [op.updateOne.filter._id];
      }
      return [];
    });
    const currentProjects = await input.db
      .collection<MediaProductProject>(MEDIA_PRODUCT_PROJECTS)
      .find({ _id: { $in: projectIds } })
      .project<MediaProductProject>({
        _id: 1,
        corporationId: 1,
        activeDevelopmentCorporationId: 1,
        sectorId: 1,
        kindId: 1,
        title: 1,
        allocationShare: 1,
        stage: 1,
        startedTurn: 1,
        stageStartedTurn: 1,
        lastProcessedTurn: 1,
        developmentPaidAnchor: 1,
        paidThresholdAnchor: 1,
        elapsedDevelopmentTurns: 1,
        elapsedThresholdTurns: 1,
        developmentAdvertisingAnchor: 1,
        developmentAdvertisingTurns: 1,
        launchQuality: 1,
        qualityBonus: 1,
        productBrand: 1,
      })
      .toArray();
    const currentById = new Map(currentProjects.map((project) => [project._id, project]));
    const attemptedProjectIds = new Set(projectIds);
    const persistedThroughTurnByProject = new Map<string, number>();
    for (const project of currentProjects) {
      persistedThroughTurnByProject.set(project._id, project.lastProcessedTurn ?? -1);
    }
    for (const project of projectsById.values()) {
      if (attemptedProjectIds.has(project._id)) continue;
      persistedThroughTurnByProject.set(
        project._id,
        Math.max(
          persistedThroughTurnByProject.get(project._id) ?? -1,
          project.lastProcessedTurn ?? -1
        )
      );
    }
    for (const projectId of attemptedProjectIds) {
      const persisted = currentById.get(projectId);
      if (persisted) projectsById.set(projectId, persisted);
      else projectsById.delete(projectId);
    }
    for (const [corporationId, existing] of input.projectsByCorporationId) {
      if (!existing.some((project) => attemptedProjectIds.has(project._id))) continue;
      input.projectsByCorporationId.set(
        corporationId,
        existing.flatMap((project) => {
          const persisted = currentById.get(project._id);
          if (persisted) return [persisted];
          return attemptedProjectIds.has(project._id) ? [] : [project];
        })
      );
    }
    for (const corporationId of [...matchingReceiptCorpIds]) {
      const receipt = corporationsById.get(corporationId)?.mediaProductDevelopmentReceiptV1;
      if (receipt && (persistedThroughTurnByProject.get(receipt.projectId) ?? -1) < receipt.turn) {
        matchingReceiptCorpIds.delete(corporationId);
      }
    }
    for (const corporationId of [...matchingAdvertisingReceiptCorpIds]) {
      const receipt = corporationsById.get(corporationId)?.mediaProductAdvertisingReceiptV1;
      if (receipt && (persistedThroughTurnByProject.get(receipt.projectId) ?? -1) < receipt.turn) {
        matchingAdvertisingReceiptCorpIds.delete(corporationId);
      }
    }
  }

  const receiptClearOps: AnyBulkWriteOperation<Corporation>[] = [];
  for (const [corporationId, corporation] of corporationsById) {
    const receipt = corporation.mediaProductDevelopmentReceiptV1;
    if (receipt) {
      const project = projectsById.get(receipt.projectId);
      const progressed = matchingReceiptCorpIds.has(corporationId);
      const orphaned =
        !project || project.corporationId !== corporationId || project.stage === "retired";
      if (progressed || orphaned) {
        receiptClearOps.push({
          updateOne: {
            filter: {
              _id: corporation._id,
              "mediaProductDevelopmentReceiptV1.projectId": receipt.projectId,
              "mediaProductDevelopmentReceiptV1.turn": receipt.turn,
            },
            update: { $unset: { mediaProductDevelopmentReceiptV1: "" } },
          },
        });
        delete corporation.mediaProductDevelopmentReceiptV1;
      }
    }
    const advertisingReceipt = corporation.mediaProductAdvertisingReceiptV1;
    if (!advertisingReceipt) continue;
    const advertisingProject = projectsById.get(advertisingReceipt.projectId);
    const advertisingProgressed = matchingAdvertisingReceiptCorpIds.has(corporationId);
    const advertisingOrphaned =
      !advertisingProject ||
      advertisingProject.corporationId !== corporationId ||
      advertisingProject.stage !== "development";
    if (!advertisingProgressed && !advertisingOrphaned) continue;
    receiptClearOps.push({
      updateOne: {
        filter: {
          _id: corporation._id,
          "mediaProductAdvertisingReceiptV1.projectId": advertisingReceipt.projectId,
          "mediaProductAdvertisingReceiptV1.turn": advertisingReceipt.turn,
        },
        update: { $unset: { mediaProductAdvertisingReceiptV1: "" } },
      },
    });
    delete corporation.mediaProductAdvertisingReceiptV1;
  }
  if (receiptClearOps.length > 0) {
    await input.db.collection<Corporation>("corporations").bulkWrite(receiptClearOps, {
      ordered: false,
    });
  }
}

/** Seed one bounded next title for eligible NPP media firms using existing lanes. */
export async function startNppMediaProductsV1(input: {
  db: Db;
  corporations: readonly Pick<Corporation, "_id" | "ceoType">[];
  sectorsByCorp: ReadonlyMap<string, CorporateSector[]>;
  projectsByCorporationId: Map<string, MediaProductProject[]>;
  currentYear: number;
  currentTurn: number;
}): Promise<MediaProductProject[]> {
  const newProjects: MediaProductProject[] = [];
  for (const corporation of input.corporations) {
    const corporationId = corporation._id.toString();
    const projects = input.projectsByCorporationId.get(corporationId) ?? [];
    const activeDevelopment = projects.some((project) => project.stage === "development");
    const kindCounts = new Map<string, number>();
    for (const project of projects) {
      kindCounts.set(project.kindId, (kindCounts.get(project.kindId) ?? 0) + 1);
    }
    const sectors = input.sectorsByCorp.get(corporationId) ?? [];
    const selected = chooseNppMediaProduct({
      enabled: true,
      isNpp: corporation.ceoType === "npp",
      currentYear: input.currentYear,
      hasActiveDevelopment: activeDevelopment,
      liveTitleCount: projects.filter((project) => project.stage !== "retired").length,
      existingKindCounts: kindCounts,
      sectors: sectors.map((sector) => ({
        sectorId: sector._id.toString(),
        sectorType: sector.sectorType,
        strategyId: sector.strategyId,
        capitalStock: sector.capitalStock ?? 0,
        revenue: sector.revenue ?? 0,
      })),
    });
    if (!selected) continue;
    const sector = sectors.find((candidate) => candidate._id.toString() === selected.sectorId);
    if (!sector) continue;
    const project: MediaProductProject = {
      _id: new ObjectId().toString(),
      corporationId,
      activeDevelopmentCorporationId: corporationId,
      sectorId: selected.sectorId,
      operatingSectorType:
        sector.mediaDiscriminator === "entertainment" ? "media_entertainment" : "media",
      kindId: selected.kind.id,
      title: `${selected.kind.label} ${input.currentYear}`,
      allocationShare: 0.25,
      stage: "development",
      startedTurn: input.currentTurn,
      stageStartedTurn: input.currentTurn,
      developmentPaidAnchor: 0,
      paidThresholdAnchor: mediaDevelopmentThresholdAnchor(
        sectorCapacityBookAnchor(sector, input.currentYear, 1)
      ),
      elapsedDevelopmentTurns: 0,
      elapsedThresholdTurns: selected.kind.durations.development ?? 1,
      developmentAdvertisingAnchor: 0,
      developmentAdvertisingTurns: 0,
    };
    newProjects.push(project);
  }
  if (newProjects.length === 0) return newProjects;
  await input.db.collection<MediaProductProject>(MEDIA_PRODUCT_PROJECTS).insertMany(newProjects, {
    ordered: false,
  });
  for (const project of newProjects) {
    const projects = input.projectsByCorporationId.get(project.corporationId) ?? [];
    projects.push(project);
    input.projectsByCorporationId.set(project.corporationId, projects);
  }
  return newProjects;
}
