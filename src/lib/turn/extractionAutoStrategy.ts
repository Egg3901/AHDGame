import type { Db, ObjectId } from "mongodb";
import type {
  CommodityPrice,
  Corporation,
  CorporateSector,
  SectorBuildOrder,
  StateResourceCapacity,
} from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import { EXTRACTABLE_RESOURCES, type ExtractableResource } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES, STRATEGY_COOLDOWN_TURNS } from "@/lib/constants/sectorStrategies";
import {
  getExtractionStrategyResources,
  isExtractionStrategyZeroYield,
} from "@/lib/corporations/extractionStrategyAvailability";
import {
  decideExtractionStrategySwitch,
  type CapacityHeadroomFn,
  type LaggedPriceRatioFn,
} from "@/lib/turn/npp/strategyExpectedRevenue";
import { retoolRescaleFields } from "@/lib/corporations/retoolRescale";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";

/**
 * Lagged price ratio for auto-strategy scoring: host reachable book, then
 * national, then global. Unpriced commodities return null and the scorer
 * treats that as a neutral 1.
 */
type ExtractionPriceDoc = Pick<
  CommodityPrice,
  | "commodity"
  | "globalSupply"
  | "globalDemand"
  | "stateSupply"
  | "globalPrice"
  | "basePrice"
  | "nationalPrices"
  | "reachablePrices"
>;

function laggedPriceRatioForCountry(
  doc: ExtractionPriceDoc | undefined,
  countryId: string | undefined
): number | null {
  if (!doc || !doc.basePrice) return null;
  const price =
    (countryId ? doc.reachablePrices?.[countryId] : undefined) ??
    (countryId ? doc.nationalPrices?.[countryId] : undefined) ??
    doc.globalPrice;
  if (!price || !Number.isFinite(price)) return null;
  const ratio = price / doc.basePrice;
  return Number.isFinite(ratio) ? ratio : null;
}

function capacityRescaleUpdate(
  sector: {
    capitalStock?: number;
    buildQueue?: SectorBuildOrder[];
    otherOpexPerUnitAnchor?: number;
  },
  fromStrategyId: string | null | undefined,
  toStrategyId: string | null | undefined,
  plantsEnabled: boolean
): ReturnType<typeof retoolRescaleFields> {
  // Same helper the player command uses, so `anchor × units` is invariant
  // across the mix change (D9 RPU normalization plus physical opex).
  return retoolRescaleFields({
    sectorType: "extraction",
    fromStrategyId,
    toStrategyId,
    plantsEnabled,
    capitalStock: sector.capitalStock,
    buildQueue: sector.buildQueue,
    otherOpexPerUnitAnchor: sector.otherOpexPerUnitAnchor,
  });
}

/**
 * Extraction auto strategy adoption ("C3", Phase 1a of the extraction-capacity
 * remediation). Capacity is enforced per state, and the shortage commodities
 * (copper/rare_earth/timber) have large idle headroom in states where broad-mix
 * ("standard") miners sit — they extract copper at rate 0.15 instead of the
 * focused 0.72. This phase nudges standard extraction sectors that sit on a
 * shortage deposit *with per-state headroom* onto the matching focused mining
 * strategy, gradually, so real utilization rises and the capacity haircut
 * recedes at its source (rather than being masked by the Phase-0 floor).
 *
 * Self-limiting: only global-shortage resources (S/D < SHORTAGE_SD) are targeted
 * and only states with headroom (stateSupply < capacity) are eligible, both read
 * fresh each run — so as conversions lift supply the resource stops qualifying,
 * which doubles as a glut guard. Gated on gameState.extractionAutoStrategyEnabled.
 *
 * Pass 2 (t899 misallocation remediation): NPP-run miners are additionally
 * re-scored every run by EXPECTED REALIZED REVENUE — rate × lagged price ratio
 * × state capacity headroom (see lib/turn/npp/strategyExpectedRevenue) — and
 * switched when a meaningfully better strategy exists, including OUT of a
 * focused strategy whose deposit the state can't physically support. Price
 * ratios are the sector host country's reachable book (national, then global
 * fallback). Player-CEO sectors are never touched by pass 2. Same flag/cadence
 * as pass 1.
 *
 * There is no generic (non-extraction) pass here. That used to start a
 * transition + 24-turn cooldown on global prices before `nppCorporationBehavior`
 * section 2e could re-score the same sector on reachable prices. Generic
 * retools belong to 2e.
 */
export const EXTRACTION_AUTO_STRATEGY_CADENCE_TURNS = 4; // act at most this often
export const EXTRACTION_AUTO_STRATEGY_MAX_PER_RUN = 3; // conversions per run (gradual)
export const EXTRACTION_AUTO_STRATEGY_SHORTAGE_SD = 0.6; // global S/D below this = shortage
export const EXTRACTION_STATE_HEADROOM_FRACTION = 0.98; // state must sit below this × capacity
export const NPP_RESTRATEGIZE_MAX_PER_RUN = 3; // NPP expected-revenue switches per run

/** Per extractable resource, the focused strategy that produces it at the highest rate. */
export function focusedStrategyByResource(): Map<
  ExtractableResource,
  { id: string; supply: Partial<Record<string, number>> }
> {
  const out = new Map<
    ExtractableResource,
    { id: string; supply: Partial<Record<string, number>> }
  >();
  for (const strat of SECTOR_STRATEGIES.extraction ?? []) {
    if (strat.id === "standard") continue;
    for (const r of getExtractionStrategyResources(strat)) {
      const rate = strat.supply[r] ?? 0;
      const cur = out.get(r);
      if (!cur || rate > (cur.supply[r] ?? 0)) out.set(r, { id: strat.id, supply: strat.supply });
    }
  }
  return out;
}

export interface ExtractionAutoStrategyResult {
  converted: number;
  byResource: Record<string, number>;
  /** NPP expected-revenue re-strategizations (second pass), by target strategy. */
  restrategized?: number;
  restrategizedByStrategy?: Record<string, number>;
  /** Always 0. The generic pass was removed; 2e owns non-extraction retools. */
  genericRestrategized?: number;
  genericByStrategy?: Record<string, number>;
  skippedReason?: string;
}

export async function processExtractionAutoStrategy(
  db: Db,
  currentTurn: number,
  preloadedGameState?: {
    extractionAutoStrategyEnabled?: boolean;
    lastExtractionAutoStrategyTurn?: number;
  }
): Promise<ExtractionAutoStrategyResult> {
  if (!preloadedGameState?.extractionAutoStrategyEnabled) {
    return { converted: 0, byResource: {}, skippedReason: "disabled" };
  }
  const lastTurn = preloadedGameState.lastExtractionAutoStrategyTurn ?? 0;
  if (currentTurn - lastTurn < EXTRACTION_AUTO_STRATEGY_CADENCE_TURNS) {
    return { converted: 0, byResource: {}, skippedReason: "cadence" };
  }

  // Resolved ONCE per run and threaded into both passes' rescale calls — the
  // D9 capacity renormalization below is plants-only.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

  const prices = await db
    .collection<CommodityPrice>("commodityPrices")
    .find({ commodity: { $in: [...EXTRACTABLE_RESOURCES] } })
    .project<ExtractionPriceDoc>({
      commodity: 1,
      globalSupply: 1,
      globalDemand: 1,
      stateSupply: 1,
      globalPrice: 1,
      basePrice: 1,
      nationalPrices: 1,
      reachablePrices: 1,
    })
    .toArray();

  // Shortage resources (global S/D < threshold), with per-state supply for headroom.
  const shortage = new Map<
    ExtractableResource,
    { sd: number; stateSupply: Record<string, number> }
  >();
  // Per-commodity docs for the NPP expected-revenue pass. Scoring reads the
  // sector host country's reachable book (national, then global fallback) so a
  // partitioned miner is not steered by unreachable-bloc prices.
  const priceByCommodity = new Map<string, ExtractionPriceDoc>();
  const stateSupplyByResource = new Map<ExtractableResource, Record<string, number>>();
  for (const cp of prices) {
    const r = cp.commodity as ExtractableResource;
    if (!(EXTRACTABLE_RESOURCES as readonly string[]).includes(r)) continue;
    const sd = cp.globalDemand > 0 ? cp.globalSupply / cp.globalDemand : 1;
    if (sd < EXTRACTION_AUTO_STRATEGY_SHORTAGE_SD) {
      shortage.set(r, { sd, stateSupply: cp.stateSupply ?? {} });
    }
    priceByCommodity.set(cp.commodity, cp);
    stateSupplyByResource.set(r, cp.stateSupply ?? {});
  }

  const caps = await db
    .collection<StateResourceCapacity>("stateResourceCapacity")
    .find({})
    .project({ stateId: 1, resources: 1 })
    .toArray();
  const capByState = new Map(caps.map((c) => [c.stateId, c.resources ?? {}]));
  const focusMap = focusedStrategyByResource();

  // ── Pass 1: standard→focused shortage conversions (any corp, unchanged) ────
  // Candidate = standard-strategy extraction sector, not mid-transition, not on cooldown.
  type CandidateSector = Pick<
    CorporateSector,
    | "_id"
    | "stateId"
    | "revenue"
    | "transitionCooldownUntilTurn"
    | "capitalStock"
    | "buildQueue"
    | "otherOpexPerUnitAnchor"
  >;
  const candidates = await db
    .collection<CorporateSector>("corporateSectors")
    .find({
      sectorType: "extraction",
      // `strategyId: null` matches docs where the field is literally null;
      // the schema types it string|undefined, hence the narrow cast.
      $or: [
        { strategyId: { $exists: false } },
        { strategyId: "standard" },
        { strategyId: null as unknown as string },
      ],
      transitionFromStrategyId: { $in: [null, undefined] },
    })
    .project<CandidateSector>({
      _id: 1,
      stateId: 1,
      revenue: 1,
      transitionCooldownUntilTurn: 1,
      capitalStock: 1,
      buildQueue: 1,
      otherOpexPerUnitAnchor: 1,
    })
    .toArray();

  type StrategyPick = {
    sector: CandidateSector;
    resource: ExtractableResource;
    strategyId: string;
    score: number;
  };
  const picks: StrategyPick[] = [];
  for (const s of candidates) {
    if (s.transitionCooldownUntilTurn != null && currentTurn < s.transitionCooldownUntilTurn)
      continue;
    const stateRes = capByState.get(s.stateId);
    if (!stateRes) continue; // uncapped/legacy state — leave alone
    let best: StrategyPick | null = null;
    for (const [resource, info] of shortage) {
      const cap = stateRes[resource] ?? 0;
      if (cap <= 0) continue; // state has no deposit of this shortage resource
      const stateSupplied = info.stateSupply[s.stateId] ?? 0;
      if (stateSupplied >= cap * EXTRACTION_STATE_HEADROOM_FRACTION) continue; // state already maxed → no gain
      const focus = focusMap.get(resource);
      if (!focus) continue;
      const strat = (SECTOR_STRATEGIES.extraction ?? []).find((x) => x.id === focus.id);
      if (!strat || isExtractionStrategyZeroYield(strat, stateRes)) continue;
      // Prioritise scarcest resource × most idle local deposit.
      const score = (1 - info.sd) * Math.max(0, cap - stateSupplied);
      if (!best || score > best.score) best = { sector: s, resource, strategyId: focus.id, score };
    }
    if (best) picks.push(best);
  }

  picks.sort((a, b) => b.score - a.score);
  const chosen = picks.slice(0, EXTRACTION_AUTO_STRATEGY_MAX_PER_RUN);

  const byResource: Record<string, number> = {};
  if (chosen.length > 0) {
    const now = new Date();
    // No retool cost is charged — this is a system nudge for distressed, mostly
    // NPP-owned miners; charging 25% of daily revenue would deepen the very
    // insolvencies this is trying to relieve. The 12-turn transition blend and
    // its −5% margin penalty (getEffectiveStrategyRates) still apply.
    await db.collection<CorporateSector>("corporateSectors").bulkWrite(
      chosen.map((p) => ({
        updateOne: {
          filter: { _id: p.sector._id },
          update: {
            $set: {
              strategyId: p.strategyId,
              transitionFromStrategyId: "standard",
              transitionStartTurn: currentTurn,
              transitionCooldownUntilTurn: currentTurn + STRATEGY_COOLDOWN_TURNS,
              autoStrategyAdoptedAtTurn: currentTurn,
              // D9: renormalize capacity for the mix change (pass 1 is always
              // standard → focused).
              ...capacityRescaleUpdate(p.sector, "standard", p.strategyId, plantsEnabled),
              updatedAt: now,
            },
          },
        },
      }))
    );
    for (const p of chosen) byResource[p.resource] = (byResource[p.resource] ?? 0) + 1;
  }

  // ── Pass 2: NPP expected-revenue re-strategize (t899 misallocation) ────────
  // NPP-run miners only. Scores every extraction strategy by expected realized
  // revenue (rate × lagged price ratio × state capacity headroom) and switches
  // when the best beats the current by a meaningful margin — including OUT of a
  // focused strategy whose deposit the state can't support. Never touches
  // player-CEO sectors; rides the same flag/cadence as pass 1.
  const restrategizedByStrategy: Record<string, number> = {};
  let restrategized = 0;
  const nppCorps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", suspended: { $ne: true } })
    .project({ _id: 1, countryId: 1 })
    .toArray();
  const nppCountryById = new Map(nppCorps.map((c) => [c._id.toString(), c.countryId]));
  if (nppCorps.length > 0) {
    const alreadyChosen = new Set(chosen.map((p) => p.sector._id.toString()));
    type NppSector = Pick<
      CorporateSector,
      | "_id"
      | "corporationId"
      | "countryId"
      | "stateId"
      | "strategyId"
      | "soldFraction"
      | "transitionCooldownUntilTurn"
      | "capitalStock"
      | "buildQueue"
      | "otherOpexPerUnitAnchor"
    >;
    const nppSectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({
        sectorType: "extraction",
        corporationId: { $in: nppCorps.map((c) => c._id as ObjectId) },
        transitionFromStrategyId: { $in: [null, undefined] },
      })
      .project<NppSector>({
        _id: 1,
        corporationId: 1,
        countryId: 1,
        stateId: 1,
        strategyId: 1,
        soldFraction: 1,
        transitionCooldownUntilTurn: 1,
        capitalStock: 1,
        buildQueue: 1,
        otherOpexPerUnitAnchor: 1,
      })
      .toArray();

    const headroomForState = (stateId: string): CapacityHeadroomFn => {
      const stateRes = capByState.get(stateId);
      return (resource) => {
        if (!stateRes) return 1; // uncapped/legacy state
        const cap = stateRes[resource] ?? 0;
        if (cap <= 0) return 0;
        const supplied = stateSupplyByResource.get(resource)?.[stateId] ?? 0;
        return Math.min(1, Math.max(0, (cap - supplied) / cap));
      };
    };

    type Switch = { sector: NppSector; strategyId: string; improvement: number };
    const switches: Switch[] = [];
    for (const s of nppSectors) {
      if (alreadyChosen.has(s._id.toString())) continue;
      if (s.transitionCooldownUntilTurn != null && currentTurn < s.transitionCooldownUntilTurn)
        continue;
      const countryId = s.countryId ?? nppCountryById.get(s.corporationId?.toString() ?? "");
      const priceRatioOf: LaggedPriceRatioFn = (commodity) =>
        laggedPriceRatioForCountry(priceByCommodity.get(commodity), countryId);
      const decision = decideExtractionStrategySwitch({
        currentStrategyId: s.strategyId ?? "standard",
        strategies: SECTOR_STRATEGIES.extraction ?? [],
        priceRatioOf,
        headroomOf: headroomForState(s.stateId),
        soldFraction: s.soldFraction,
      });
      if (decision) {
        switches.push({
          sector: s,
          strategyId: decision.strategyId,
          improvement: decision.bestScore - decision.currentScore,
        });
      }
    }

    switches.sort((a, b) => b.improvement - a.improvement);
    const chosenSwitches = switches.slice(0, NPP_RESTRATEGIZE_MAX_PER_RUN);
    if (chosenSwitches.length > 0) {
      const now = new Date();
      // Same no-retool-cost rationale as pass 1: these are NPP-run miners the
      // system is steering; transition blend + −5% margin penalty still apply.
      await db.collection<CorporateSector>("corporateSectors").bulkWrite(
        chosenSwitches.map((p) => ({
          updateOne: {
            filter: { _id: p.sector._id },
            update: {
              $set: {
                strategyId: p.strategyId,
                transitionFromStrategyId: p.sector.strategyId ?? "standard",
                transitionStartTurn: currentTurn,
                transitionCooldownUntilTurn: currentTurn + STRATEGY_COOLDOWN_TURNS,
                autoStrategyAdoptedAtTurn: currentTurn,
                // D9: renormalize capacity for the mix change. Pass 2 switches
                // between arbitrary strategies, so the ratio is read off the
                // sector's actual current strategy.
                ...capacityRescaleUpdate(
                  p.sector,
                  p.sector.strategyId ?? "standard",
                  p.strategyId,
                  plantsEnabled
                ),
                updatedAt: now,
              },
            },
          },
        }))
      );
      restrategized = chosenSwitches.length;
      for (const p of chosenSwitches) {
        restrategizedByStrategy[p.strategyId] = (restrategizedByStrategy[p.strategyId] ?? 0) + 1;
      }
    }
  }

  await stampRun(db, currentTurn);
  return {
    converted: chosen.length,
    byResource,
    restrategized,
    restrategizedByStrategy,
    genericRestrategized: 0,
    genericByStrategy: {},
    ...(shortage.size === 0 && chosen.length === 0 && restrategized === 0
      ? { skippedReason: "no-shortage" }
      : {}),
  };
}

async function stampRun(db: Db, currentTurn: number): Promise<void> {
  await db
    .collection<GameState>("gameState")
    .updateOne({ _id: "current" }, { $set: { lastExtractionAutoStrategyTurn: currentTurn } });
}
