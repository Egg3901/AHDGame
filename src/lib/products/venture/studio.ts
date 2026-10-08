/**
 * Builds the Product Studio view from already-loaded documents. Every money
 * figure is in anchor currency; the client formats it in the corporation's
 * currency. No database access here so the numbers are easy to test.
 */
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { ManufacturingProductEligibilityOptions } from "../rules/manufacturingEligibility";
import {
  VENTURE_BOOST_TURNS,
  VENTURE_DEVELOPMENT_TURNS,
  VENTURE_FUNDING_TIERS,
  VENTURE_MAX_BOOST,
  VENTURE_MIN_BOOST,
  brandQualityBonus,
  getVentureEvent,
  qualityFromInvestment,
  referenceFundingPerTurn,
  ventureOdds,
  ventureTargetAnchor,
  hitProbability,
  boostFractionForQuality,
} from "./engine";
import {
  availableVentureLines,
  getVentureLine,
  liftedSectorIds,
  type VentureLineStatus,
} from "./lines";
import { sectorTurnRevenueAnchor } from "./revenue";
import { ventureSector } from "./turn";
import type { ProductVenture, VentureDomain } from "./types";

export interface VentureEventView {
  eventId: string;
  title: string;
  body: string;
  deadlineTurn: number;
  choices: Array<{ id: string; label: string; detail: string; isDefault: boolean }>;
}

export interface VentureView {
  id: string;
  domain: VentureDomain;
  lineId: string;
  lineLabel: string;
  name: string;
  stage: ProductVenture["stage"];
  startedTurn: number;
  endTurn: number;
  turnsRemaining: number;
  fundingPerTurnAnchor: number;
  referenceFundingPerTurnAnchor: number;
  targetAnchor: number;
  investedAnchor: number;
  spentAnchor: number;
  pendingChargeAnchor: number;
  currentQuality: number;
  odds: ReturnType<typeof ventureOdds> | null;
  pendingEvents: VentureEventView[];
  resolvedEvents: Array<{ title: string; choiceLabel: string; auto: boolean }>;
  outcome?: "hit" | "flop";
  finalQuality?: number;
  boostFraction?: number;
  boostTurnsRemaining?: number;
  upliftPerTurnAnchor?: number;
  upliftToDateAnchor?: number;
  /** Lifted revenue minus all money spent, in anchor currency. */
  netReturnAnchor?: number;
  liftedSectorCount: number;
}

export interface LineView {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
  liftedSectorCount: number;
  baselineRevenueAnchor: number;
  targetAnchor: number;
  referenceFundingPerTurnAnchor: number;
  /** Hit chance at each funding tier, as [low, high] fractions. */
  oddsByTier: Array<{
    id: string;
    label: string;
    multiple: number;
    fundingPerTurnAnchor: number;
    hitChance: number;
    boostFraction: number;
  }>;
}

export interface DomainView {
  domain: VentureDomain;
  enabled: boolean;
  hasSectors: boolean;
  lines: LineView[];
  active: VentureView | null;
  recent: VentureView[];
}

export interface StudioView {
  isCeo: boolean;
  currentTurn: number;
  developmentTurns: number;
  boostTurns: number;
  boostRange: [number, number];
  liquidCurrencyCode: string | null;
  domains: DomainView[];
}

export function ventureView(input: {
  venture: ProductVenture;
  corporation: Pick<Corporation, "averageQuality" | "countryId" | "liquidCurrencyCode">;
  sectors: readonly CorporateSector[];
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  turn: number;
}): VentureView {
  const { venture, corporation, turn } = input;
  const line = getVentureLine(venture.domain, venture.lineId);
  const lifted = new Set(
    liftedSectorIds({
      domain: venture.domain,
      lineId: venture.lineId,
      corporationId: venture.corporationId,
      sectors: input.sectors.map(ventureSector),
    })
  );
  const inDevelopment = venture.stage === "development";
  const pendingEvents: VentureEventView[] = inDevelopment
    ? venture.events.flatMap((record) => {
        const def = getVentureEvent(record.eventId);
        if (!def || record.choiceId || record.offeredTurn === undefined) return [];
        return [
          {
            eventId: def.id,
            title: def.title,
            body: def.body,
            deadlineTurn: record.deadlineTurn ?? venture.endTurn,
            choices: def.choices.map((choice) => ({
              id: choice.id,
              label: choice.label,
              detail: choice.detail,
              isDefault: choice.id === def.defaultChoiceId,
            })),
          },
        ];
      })
    : [];
  const resolvedEvents = venture.events.flatMap((record) => {
    const def = getVentureEvent(record.eventId);
    const choice = def?.choices.find((candidate) => candidate.id === record.choiceId);
    return def && choice
      ? [{ title: def.title, choiceLabel: choice.label, auto: record.auto === true }]
      : [];
  });
  let upliftPerTurn: number | undefined;
  if (venture.stage === "released") {
    upliftPerTurn = venture.lastUpliftAnchor ?? 0;
    if (!upliftPerTurn) {
      // Before the first lifted turn lands, quote from current revenue.
      const revenue = input.sectors
        .filter((sector) => lifted.has(sector._id.toString()))
        .reduce(
          (sum, sector) => sum + sectorTurnRevenueAnchor(sector, corporation, input.fxByCurrency),
          0
        );
      upliftPerTurn = revenue * (venture.boostFraction ?? 0);
    }
  }
  const finished = venture.stage === "released" || venture.stage === "expired";
  return {
    id: venture._id,
    domain: venture.domain,
    lineId: venture.lineId,
    lineLabel: line?.label ?? venture.lineId,
    name: venture.name,
    stage: venture.stage,
    startedTurn: venture.startedTurn,
    endTurn: venture.endTurn,
    turnsRemaining: inDevelopment ? Math.max(0, venture.endTurn - turn) : 0,
    fundingPerTurnAnchor: venture.fundingPerTurnAnchor,
    referenceFundingPerTurnAnchor: referenceFundingPerTurn(venture.targetAnchor),
    targetAnchor: venture.targetAnchor,
    investedAnchor: venture.investedAnchor,
    spentAnchor: venture.spentAnchor,
    pendingChargeAnchor: venture.pendingChargeAnchor,
    currentQuality:
      Math.round(
        Math.max(
          0,
          Math.min(
            100,
            qualityFromInvestment(venture.investedAnchor, venture.targetAnchor) +
              venture.qualityShift +
              brandQualityBonus(corporation.averageQuality)
          )
        ) * 10
      ) / 10,
    odds: inDevelopment ? ventureOdds(venture, turn, corporation.averageQuality) : null,
    pendingEvents,
    resolvedEvents,
    outcome: venture.outcome,
    finalQuality: venture.finalQuality,
    boostFraction: venture.boostFraction,
    boostTurnsRemaining:
      venture.stage === "released" ? Math.max(0, (venture.boostEndsTurn ?? 0) - turn) : undefined,
    upliftPerTurnAnchor: upliftPerTurn,
    upliftToDateAnchor: finished ? (venture.upliftToDateAnchor ?? 0) : undefined,
    netReturnAnchor: finished ? (venture.upliftToDateAnchor ?? 0) - venture.spentAnchor : undefined,
    liftedSectorCount: lifted.size,
  };
}

export function buildStudioView(input: {
  isCeo: boolean;
  corporation: Pick<Corporation, "_id" | "averageQuality" | "countryId" | "liquidCurrencyCode">;
  sectors: readonly CorporateSector[];
  ventures: readonly ProductVenture[];
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  turn: number;
  currentYear?: number;
  eligibility?: ManufacturingProductEligibilityOptions;
  enabled: Record<VentureDomain, boolean>;
}): StudioView {
  const corporationId = input.corporation._id.toString();
  const plain = input.sectors.map(ventureSector);
  const domains: DomainView[] = (["media", "manufacturing"] as const).map((domain) => {
    const statuses: VentureLineStatus[] = availableVentureLines({
      domain,
      corporationId,
      sectors: plain,
      currentYear: input.currentYear,
      eligibility: input.eligibility,
    });
    const lines: LineView[] = statuses.map(({ line, available, reason }) => {
      const liftedIds = new Set(
        liftedSectorIds({ domain, lineId: line.id, corporationId, sectors: plain })
      );
      const baseline = input.sectors
        .filter((sector) => liftedIds.has(sector._id.toString()))
        .reduce(
          (sum, sector) =>
            sum + sectorTurnRevenueAnchor(sector, input.corporation, input.fxByCurrency),
          0
        );
      const target = ventureTargetAnchor(baseline);
      const reference = referenceFundingPerTurn(target);
      return {
        id: line.id,
        label: line.label,
        available,
        reason,
        liftedSectorCount: liftedIds.size,
        baselineRevenueAnchor: baseline,
        targetAnchor: target,
        referenceFundingPerTurnAnchor: reference,
        oddsByTier: VENTURE_FUNDING_TIERS.map((tier) => {
          const quality = qualityFromInvestment(target * tier.multiple, target);
          return {
            id: tier.id,
            label: tier.label,
            multiple: tier.multiple,
            fundingPerTurnAnchor: reference * tier.multiple,
            hitChance: Math.round(hitProbability(quality) * 1000) / 1000,
            boostFraction: Math.round(boostFractionForQuality(quality) * 1000) / 1000,
          };
        }),
      };
    });
    const mine = input.ventures.filter((venture) => venture.domain === domain);
    const view = (venture: ProductVenture) =>
      ventureView({
        venture,
        corporation: input.corporation,
        sectors: input.sectors,
        fxByCurrency: input.fxByCurrency,
        turn: input.turn,
      });
    const active = mine.find((venture) => venture.stage === "development");
    return {
      domain,
      enabled: input.enabled[domain],
      hasSectors: plain.some((sector) =>
        domain === "media"
          ? sector.sectorType === "media"
          : sector.sectorType === "manufacturing" || sector.sectorType === "automobiles"
      ),
      lines,
      active: active ? view(active) : null,
      recent: mine
        .filter((venture) => venture.stage !== "development")
        .sort((a, b) => (b.releasedTurn ?? b.startedTurn) - (a.releasedTurn ?? a.startedTurn))
        .slice(0, 8)
        .map(view),
    };
  });
  return {
    isCeo: input.isCeo,
    currentTurn: input.turn,
    developmentTurns: VENTURE_DEVELOPMENT_TURNS,
    boostTurns: VENTURE_BOOST_TURNS,
    boostRange: [VENTURE_MIN_BOOST, VENTURE_MAX_BOOST],
    liquidCurrencyCode: input.corporation.liquidCurrencyCode ?? null,
    domains,
  };
}
