/**
 * Media titles progress from paid development through launch, growth, catalog tail, and retirement.
 * `advanceMediaProduct` is deterministic and receives only settled owner spending.
 */
import type { MediaProductKind } from "../mediaProductCatalog";
import { MEDIA_PRODUCT_KINDS, tailDemandFactor } from "../mediaProductCatalog";
import { getMediaOperatingModel } from "@/lib/mediaOperatingModels/catalog";
import { advanceProductLifecycle, type ProductLifecycleStage } from "./productLifecycle";

export interface MediaProductState {
  id: string;
  kindId: string;
  stage: ProductLifecycleStage;
  startedTurn: number;
  stageStartedTurn: number;
  lastProcessedTurn?: number;
  developmentPaidAnchor: number;
  paidThresholdAnchor: number;
  elapsedDevelopmentTurns: number;
  elapsedThresholdTurns: number;
  developmentAdvertisingAnchor: number;
  developmentAdvertisingTurns: number;
  launchQuality?: number;
  qualityBonus?: number;
  productBrand?: number;
}

export interface MediaProductReceipt {
  projectId: string;
  turn: number;
  amountAnchor: number;
  deliveredAdvertisingAnchor: number;
}

export interface MediaProductProgress {
  product: MediaProductState;
  activeDevelopment: boolean;
  advanced: boolean;
}

const ANCHOR_CAP = 1e15;
const MAX_QUALITY_BONUS = 10;
const MAX_TECH_BONUS = 5;
const BRAND_REF_ANCHOR = 10_000;
export const MAX_LIVE_NPP_MEDIA_TITLES = 4;

const STAGE_QUALITY_FACTOR: Partial<Record<ProductLifecycleStage, number>> = {
  launch: 0.25,
  growth: 0.6,
  mature: 1,
  decline: 0.4,
};

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(ANCHOR_CAP, Math.max(0, value))
    : 0;
}

function clampQuality(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** Five percent of the sector's monetary paid/list book basis, with a one-anchor minimum. */
export function mediaDevelopmentThresholdAnchor(capacityBookAnchor: number): number {
  return Math.max(1, nonNegative(capacityBookAnchor) * 0.05);
}

/** Only funded commercial advertising can contribute to a title's brand receipt. */
export function settledMediaAdvertisingAnchor(input: {
  requestedAnchor: number;
  availableCashAnchor: number;
  deliveredValueAnchor: number;
}): number {
  const requested = nonNegative(input.requestedAnchor);
  const cash = nonNegative(input.availableCashAnchor);
  const delivered = nonNegative(input.deliveredValueAnchor);
  return Math.min(requested, cash, delivered);
}

export function mediaProductAdvertisingReceiptAnchor(
  paidMarketingAnchor: number,
  allocationShare: number
): number {
  const share = Number.isFinite(allocationShare) ? Math.min(1, Math.max(0, allocationShare)) : 0;
  return nonNegative(paidMarketingAnchor) * share;
}

/** Retire development that remains unpaid after four full model cadences. */
export function shouldRetireChronicMediaDevelopment(input: {
  stage: ProductLifecycleStage;
  elapsedDevelopmentTurns: number;
  kind: MediaProductKind;
}): boolean {
  const elapsed = Number.isSafeInteger(input.elapsedDevelopmentTurns)
    ? Math.max(0, input.elapsedDevelopmentTurns)
    : 0;
  const expected = input.kind.durations.development ?? 1;
  return input.stage === "development" && elapsed >= expected * 4;
}

/** Select one deterministic NPP title only when catalog capacity remains. */
export function chooseNppMediaProduct(input: {
  enabled: boolean;
  isNpp: boolean;
  currentYear: number;
  hasActiveDevelopment: boolean;
  liveTitleCount: number;
  sectors: readonly {
    sectorId: string;
    sectorType: string;
    strategyId?: string | null;
    capitalStock: number;
    revenue: number;
  }[];
  existingKindCounts: ReadonlyMap<string, number>;
}): { kind: MediaProductKind; sectorId: string } | null {
  if (
    !input.enabled ||
    !input.isNpp ||
    input.hasActiveDevelopment ||
    input.liveTitleCount >= MAX_LIVE_NPP_MEDIA_TITLES
  ) {
    return null;
  }
  const candidates = input.sectors
    .filter(
      (sector) =>
        sector.sectorType === "media" &&
        Number.isFinite(sector.capitalStock) &&
        sector.capitalStock > 0 &&
        typeof sector.strategyId === "string" &&
        Number.isFinite(sector.revenue)
    )
    .flatMap((sector) => {
      const availableKinds = MEDIA_PRODUCT_KINDS.filter((kind) => {
        const model = getMediaOperatingModel(kind.modelId);
        return (
          kind.modelId === sector.strategyId &&
          model !== undefined &&
          input.currentYear >= model.availableFromYear
        );
      }).sort(
        (a, b) =>
          (input.existingKindCounts.get(a.id) ?? 0) - (input.existingKindCounts.get(b.id) ?? 0) ||
          a.id.localeCompare(b.id)
      );
      const kind = availableKinds[0];
      return kind ? [{ kind, sectorId: sector.sectorId, revenue: sector.revenue }] : [];
    })
    .sort((a, b) => b.revenue - a.revenue || a.sectorId.localeCompare(b.sectorId));
  const selected = candidates[0];
  return selected ? { kind: selected.kind, sectorId: selected.sectorId } : null;
}

/** Quality adds product R&D and its model technology once to current four-pillar quality. */
export function mediaLaunchQuality(input: {
  sectorQuality: number | null;
  developmentPaidAnchor: number;
  paidThresholdAnchor: number;
  relevantTechnologyUnlocked: boolean;
}): { quality: number; bonus: number } {
  const base = Number.isFinite(input.sectorQuality) ? (input.sectorQuality as number) : 50;
  const paidShare =
    nonNegative(input.paidThresholdAnchor) > 0
      ? Math.min(
          1,
          nonNegative(input.developmentPaidAnchor) / nonNegative(input.paidThresholdAnchor)
        )
      : 0;
  const researchBonus = MAX_QUALITY_BONUS * Math.sqrt(paidShare);
  const technologyBonus = input.relevantTechnologyUnlocked ? MAX_TECH_BONUS : 0;
  const bonus = Math.min(MAX_QUALITY_BONUS + MAX_TECH_BONUS, researchBonus + technologyBonus);
  return { quality: clampQuality(base + bonus), bonus: Math.round(bonus * 10) / 10 };
}

/** Brand is the average actual commercial advertising paid by the title's owner during development. */
export function mediaProductBrand(
  developmentAdvertisingAnchor: number,
  developmentAdvertisingTurns: number
): number {
  const turns = Number.isSafeInteger(developmentAdvertisingTurns)
    ? Math.max(0, developmentAdvertisingTurns)
    : 0;
  return turns > 0 ? nonNegative(developmentAdvertisingAnchor) / turns : 0;
}

/** Bounded loyalty points from actual paid brand investment and model audience coverage. */
export function mediaProductBrandBonus(productBrand: number, coverage: number): number {
  const brand = nonNegative(productBrand);
  const audience = Number.isFinite(coverage) ? Math.min(1, Math.max(0, coverage)) : 0;
  return Math.round(Math.min(10, (10 * brand) / (brand + BRAND_REF_ANCHOR)) * audience * 10) / 10;
}

/** Resolve a new durable product from one eligible sector, without inventing costs or output. */
export function startMediaProduct(input: {
  enabled: boolean;
  activeDevelopment: MediaProductState | null;
  kind: MediaProductKind;
  title: string;
  productId: string;
  turn: number;
  capacityBookAnchor: number;
  allocationShare: number;
}): MediaProductState | null {
  if (
    input.enabled !== true ||
    input.activeDevelopment ||
    !input.title.trim() ||
    input.title.trim().length > 80 ||
    !input.productId ||
    !Number.isSafeInteger(input.turn) ||
    input.turn < 0 ||
    nonNegative(input.capacityBookAnchor) <= 0 ||
    !Number.isFinite(input.allocationShare) ||
    input.allocationShare <= 0 ||
    input.allocationShare > 1
  ) {
    return null;
  }
  return {
    id: input.productId,
    kindId: input.kind.id,
    stage: "development",
    startedTurn: input.turn,
    stageStartedTurn: input.turn,
    developmentPaidAnchor: 0,
    paidThresholdAnchor: mediaDevelopmentThresholdAnchor(input.capacityBookAnchor),
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: input.kind.durations.development ?? 1,
    developmentAdvertisingAnchor: 0,
    developmentAdvertisingTurns: 0,
  };
}

/** Advances once from its owner receipt; duplicate, stale, foreign, or invalid cash is inert. */
export function advanceMediaProduct(input: {
  product: MediaProductState;
  kind: MediaProductKind;
  receipt: MediaProductReceipt;
  sectorQuality: number | null;
  relevantTechnologyUnlocked: boolean;
}): MediaProductProgress | null {
  const receipt = input.receipt;
  if (
    !Number.isFinite(receipt.amountAnchor) ||
    receipt.amountAnchor < 0 ||
    !Number.isFinite(receipt.deliveredAdvertisingAnchor) ||
    receipt.deliveredAdvertisingAnchor < 0
  ) {
    return null;
  }
  const progress = advanceProductLifecycle({
    product: {
      id: input.product.id,
      stage: input.product.stage,
      stageStartedTurn: input.product.stageStartedTurn,
      startedTurn: input.product.startedTurn,
      lastProcessedTurn: input.product.lastProcessedTurn,
      developmentPaidAnchor: input.product.developmentPaidAnchor,
      paidThresholdAnchor: input.product.paidThresholdAnchor,
      elapsedDevelopmentTurns: input.product.elapsedDevelopmentTurns,
      elapsedThresholdTurns: input.product.elapsedThresholdTurns,
    },
    receipt: {
      productId: receipt.projectId,
      turn: receipt.turn,
      paidDevelopmentAnchor: receipt.amountAnchor,
    },
    durations: input.kind.durations,
  });
  if (!progress) return null;
  const next: MediaProductState = {
    ...input.product,
    stage: progress.stage,
    stageStartedTurn: progress.stageStartedTurn,
    lastProcessedTurn: progress.lastProcessedTurn,
    developmentPaidAnchor: progress.developmentPaidAnchor,
    elapsedDevelopmentTurns: progress.elapsedDevelopmentTurns,
  };
  if (input.product.stage === "development") {
    next.developmentAdvertisingAnchor = Math.min(
      ANCHOR_CAP,
      nonNegative(input.product.developmentAdvertisingAnchor) +
        nonNegative(receipt.deliveredAdvertisingAnchor)
    );
    next.developmentAdvertisingTurns = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(0, input.product.developmentAdvertisingTurns) + 1
    );
  }
  if (input.product.stage === "development" && progress.stage === "launch") {
    const quality = mediaLaunchQuality({
      sectorQuality: input.sectorQuality,
      developmentPaidAnchor: progress.developmentPaidAnchor,
      paidThresholdAnchor: input.product.paidThresholdAnchor,
      relevantTechnologyUnlocked: input.relevantTechnologyUnlocked,
    });
    next.launchQuality = quality.quality;
    next.qualityBonus = quality.bonus;
    next.productBrand = mediaProductBrand(
      next.developmentAdvertisingAnchor,
      next.developmentAdvertisingTurns
    );
  }
  return { product: next, activeDevelopment: progress.stage === "development", advanced: true };
}

/** Product effects preserve the sector's baseline and fade through model-specific lifecycle stages. */
export function mediaProductQualityForStage(
  baseQuality: number | null,
  project: Pick<MediaProductState, "stage" | "qualityBonus"> & { kind: MediaProductKind }
): number | null {
  const factor =
    project.stage === "decline"
      ? tailDemandFactor(project.stage, project.kind.tail)
      : (STAGE_QUALITY_FACTOR[project.stage] ?? 0);
  if (factor <= 0) return baseQuality;
  const base = Number.isFinite(baseQuality) ? (baseQuality as number) : 50;
  return clampQuality(base + nonNegative(project.qualityBonus) * factor);
}

export interface MediaProductSectorEffectInput {
  project: MediaProductState & { allocationShare: number };
  kind: MediaProductKind;
}

/** Blend all live titles over their bounded share of one sector's existing output. */
export function aggregateMediaProductSectorEffects(input: {
  projects: readonly MediaProductSectorEffectInput[];
  baseQuality: number | null;
}): { quality: number | null; loyaltyBonus: number; allocatedShare: number } {
  const candidates = input.projects
    .filter(
      ({ project, kind }) =>
        project.stage !== "development" &&
        project.stage !== "retired" &&
        kind.outputCommodities.length > 0 &&
        Number.isFinite(project.allocationShare) &&
        project.allocationShare > 0
    )
    .sort((a, b) => a.project.id.localeCompare(b.project.id));
  let remaining = 1;
  let allocatedShare = 0;
  let qualityDelta = 0;
  let loyaltyBonus = 0;
  for (const { project, kind } of candidates) {
    if (remaining <= 0) break;
    const share = Math.min(remaining, project.allocationShare);
    remaining -= share;
    allocatedShare += share;
    const stageFactor =
      project.stage === "decline"
        ? tailDemandFactor(project.stage, kind.tail)
        : (STAGE_QUALITY_FACTOR[project.stage] ?? 0);
    qualityDelta += nonNegative(project.qualityBonus) * stageFactor * share * kind.coverage;
    loyaltyBonus +=
      mediaProductBrandBonus(project.productBrand ?? 0, kind.coverage) * stageFactor * share;
  }
  const quality =
    allocatedShare > 0
      ? clampQuality(
          (Number.isFinite(input.baseQuality) ? (input.baseQuality as number) : 50) + qualityDelta
        )
      : input.baseQuality;
  return {
    quality,
    loyaltyBonus: Math.round(Math.min(10, loyaltyBonus) * 10) / 10,
    allocatedShare: Math.round(allocatedShare * 10_000) / 10_000,
  };
}
