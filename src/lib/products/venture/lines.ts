/**
 * Which product lines a corporation can develop, and which of its sectors a
 * released product lifts. Media lines come from the owned media operating
 * models. Manufacturing lines come from what owned plants actually produce,
 * so a corporation that only builds vehicles cannot release a washing machine.
 */
import { getOperatingSectorType, SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import { getMediaOperatingModel } from "@/lib/mediaOperatingModels/catalog";
import { MEDIA_PRODUCT_KINDS } from "../mediaProductCatalog";
import { MANUFACTURING_PRODUCT_KINDS, getManufacturingProductKind } from "../manufacturingCatalog";
import {
  legalManufacturingProductKinds,
  type ManufacturingPlant,
  type ManufacturingProductEligibilityOptions,
} from "../rules/manufacturingEligibility";
import type { VentureDomain } from "./types";

export interface VentureLine {
  id: string;
  domain: VentureDomain;
  label: string;
  /** Plain-language requirement shown to the CEO. */
  requirement: string;
}

export interface VentureLineStatus {
  line: VentureLine;
  available: boolean;
  /** Why the line is locked, when it is. */
  reason?: string;
}

export interface VentureSector {
  sectorId: string;
  sectorType: string;
  industryModel?: ManufacturingPlant["industryModel"];
  strategyId?: string | null;
  mediaDiscriminator?: string | null;
  capitalStock?: number;
  plantCount?: number;
  mothballed?: boolean;
}

function commodityLabel(commodity: string): string {
  return commodity.replace(/_/g, " ");
}

export function ventureLines(domain: VentureDomain): VentureLine[] {
  if (domain === "media") {
    return MEDIA_PRODUCT_KINDS.map((kind) => ({
      id: kind.id,
      domain,
      label: kind.label,
      requirement: `Needs a media sector running the ${
        getMediaOperatingModel(kind.modelId)?.name ?? kind.modelId
      } model.`,
    }));
  }
  return MANUFACTURING_PRODUCT_KINDS.map((kind) => ({
    id: kind.id,
    domain,
    label: kind.label,
    requirement: `Needs a plant that produces ${commodityLabel(kind.outputCommodity)}.`,
  }));
}

export function getVentureLine(domain: VentureDomain, lineId: string): VentureLine | undefined {
  return ventureLines(domain).find((line) => line.id === lineId);
}

function toPlant(sector: VentureSector, corporationId: string): ManufacturingPlant {
  return {
    sectorId: sector.sectorId,
    corporationId,
    sectorType: sector.sectorType,
    industryModel: sector.industryModel,
    strategyId: sector.strategyId,
    capitalStock: sector.capitalStock ?? 0,
    plantCount: sector.plantCount ?? 0,
    mothballed: sector.mothballed,
  };
}

export function availableVentureLines(input: {
  domain: VentureDomain;
  corporationId: string;
  sectors: readonly VentureSector[];
  currentYear?: number;
  eligibility?: ManufacturingProductEligibilityOptions;
}): VentureLineStatus[] {
  const lines = ventureLines(input.domain);
  if (input.domain === "media") {
    const mediaSectors = input.sectors.filter((sector) => sector.sectorType === "media");
    return lines.map((line) => {
      const kind = MEDIA_PRODUCT_KINDS.find((candidate) => candidate.id === line.id);
      const model = kind ? getMediaOperatingModel(kind.modelId) : undefined;
      const owned = kind && mediaSectors.some((sector) => sector.strategyId === kind.modelId);
      if (!owned) return { line, available: false, reason: line.requirement };
      if (
        input.currentYear !== undefined &&
        input.currentYear < (model?.availableFromYear ?? Number.MAX_SAFE_INTEGER)
      ) {
        return {
          line,
          available: false,
          reason: `Not available before ${model?.availableFromYear ?? "its era"}.`,
        };
      }
      return { line, available: true };
    });
  }
  const plants = input.sectors.map((sector) => toPlant(sector, input.corporationId));
  const legal = new Set(
    legalManufacturingProductKinds(plants, input.eligibility).map((kind) => kind.id)
  );
  return lines.map((line) =>
    legal.has(line.id)
      ? { line, available: true }
      : { line, available: false, reason: line.requirement }
  );
}

/** Sectors a released product of this line lifts. */
export function liftedSectorIds(input: {
  domain: VentureDomain;
  lineId: string;
  corporationId: string;
  sectors: readonly VentureSector[];
}): string[] {
  if (input.domain === "media") {
    return input.sectors
      .filter((sector) => sector.sectorType === "media" && !sector.mothballed)
      .map((sector) => sector.sectorId);
  }
  const kind = getManufacturingProductKind(input.lineId);
  if (!kind) return [];
  return input.sectors
    .filter((sector) => {
      if (sector.mothballed) return false;
      const operating = getOperatingSectorType(sector.sectorType, sector.industryModel);
      if (!kind.sectorTypes.includes(operating as OperatingSectorType)) return false;
      const strategy = SECTOR_STRATEGIES[operating as keyof typeof SECTOR_STRATEGIES]?.find(
        (candidate) => candidate.id === (sector.strategyId ?? "standard")
      );
      return !!strategy && (strategy.supply[kind.outputCommodity] ?? 0) > 0;
    })
    .map((sector) => sector.sectorId);
}
