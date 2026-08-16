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
import { isDecadeReached } from "@/lib/constants/techTree/decades";
import {
  capacityRescaleRatio,
  rescaleBuildQueueForStrategyChange,
} from "@/lib/constants/capacityEconomy";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";

/**
 * D9 — RPU normalization for the AUTOMATIC retool paths.
 *
 * Both passes below switch a sector's strategy without going through
 * `setSectorStrategy`, so they must apply the same capacity renormalization it
 * does. Extraction is the WORST case for this: the strategy table's mixes run
 * from a coal/gas basket priced in the tens of ₳ per unit to a rare-earth
 * basket priced in the tens of thousands, so an un-normalized system nudge would
 * hand a miner a 100×+ capacity windfall (or confiscation) for free — and unlike
 * the player route there is not even a retool fee attached.
 *
 * Returns the `$set` fragment to merge into the sector update; empty when there
 * is nothing to rescale (no capitalStock, no queue, or a no-op ratio).
 *
 * PLANTS-GATED. `capitalStock` only carries the RPU meaning this normalizes
 * under plants; below it the sector turn writes a production-gating stock, so an
 * auto-retool must leave it exactly where it was. `plantsEnabled` is resolved
 * once per run by the caller, not per sector.
 */
function capacityRescaleUpdate(
  sector: { capitalStock?: number; buildQueue?: SectorBuildOrder[] },
  fromStrategyId: string | null | undefined,
  toStrategyId: string | null | undefined,
  plantsEnabled: boolean
): Partial<{ capitalStock: number; buildQueue: SectorBuildOrder[] }> {
  if (!plantsEnabled) return {};
  const ratio = capacityRescaleRatio("extraction", fromStrategyId, toStrategyId);
  if (ratio === 1) return {};
  const out: Partial<{ capitalStock: number; buildQueue: SectorBuildOrder[] }> = {};
  if (typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)) {
    out.capitalStock = sector.capitalStock * ratio;
  }
  if (Array.isArray(sector.buildQueue) && sector.buildQueue.length > 0) {
    out.buildQueue = rescaleBuildQueueForStrategyChange(sector.buildQueue, ratio);
  }
  return out;
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
 * focused strategy whose deposit the state can't physically support. Player-CEO
 * sectors are never touched by pass 2. Same flag/cadence as pass 1.
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
    .project({
      commodity: 1,
      globalSupply: 1,
      globalDemand: 1,
      stateSupply: 1,
      globalPrice: 1,
      basePrice: 1,
    })
    .toArray();

  // Shortage resources (global S/D < threshold), with per-state supply for headroom.
  const shortage = new Map<
    ExtractableResource,
    { sd: number; stateSupply: Record<string, number> }
  >();
  // Lagged price ratio + per-state supply for the NPP expected-revenue pass.
  const priceRatioByResource = new Map<ExtractableResource, number>();
  const stateSupplyByResource = new Map<ExtractableResource, Record<string, number>>();
  // Full-commodity lagged ratios for the generic (non-extraction) pass 3.
  const priceRatioByCommodity = new Map<string, number>();
  for (const cp of prices) {
    if (cp.basePrice && cp.globalPrice && Number.isFinite(cp.globalPrice / cp.basePrice)) {
      priceRatioByCommodity.set(cp.commodity, cp.globalPrice / cp.basePrice);
    }
    const r = cp.commodity as ExtractableResource;
    if (!(EXTRACTABLE_RESOURCES as readonly string[]).includes(r)) continue;
    const sd = cp.globalDemand > 0 ? cp.globalSupply / cp.globalDemand : 1;
    if (sd < EXTRACTION_AUTO_STRATEGY_SHORTAGE_SD) {
      shortage.set(r, { sd, stateSupply: cp.stateSupply ?? {} });
    }
    if (cp.basePrice && cp.globalPrice && Number.isFinite(cp.globalPrice / cp.basePrice)) {
      priceRatioByResource.set(r, cp.globalPrice / cp.basePrice);
    }
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
    "_id" | "stateId" | "revenue" | "transitionCooldownUntilTurn" | "capitalStock" | "buildQueue"
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
    .project({ _id: 1 })
    .toArray();
  if (nppCorps.length > 0) {
    const alreadyChosen = new Set(chosen.map((p) => p.sector._id.toString()));
    type NppSector = Pick<
      CorporateSector,
      | "_id"
      | "stateId"
      | "strategyId"
      | "soldFraction"
      | "transitionCooldownUntilTurn"
      | "capitalStock"
      | "buildQueue"
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
        stateId: 1,
        strategyId: 1,
        soldFraction: 1,
        transitionCooldownUntilTurn: 1,
        capitalStock: 1,
        buildQueue: 1,
      })
      .toArray();

    const priceRatioOf: LaggedPriceRatioFn = (commodity) =>
      priceRatioByResource.get(commodity as ExtractableResource) ?? null;
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

  // ── Pass 3: NPP generic (non-extraction) re-strategize ────────────────────
  // The corp-484 arc's last inert valve (ops-knowledge ahd-iron-curtain-
  // autarky watchlist): strategy switching existed only for extraction, so no
  // NPC could ever answer a shortage in a STRATEGY-produced commodity. With
  // the curtain closed the West's fertilizer ran 2.3x base while 34 US
  // chemical_industries sectors sat on pharma/standard strategies and nothing
  // could move them. Same decider as pass 2 — the scorer already treats
  // non-extractables at headroom 1 and the deposit veto self-skips — over
  // every NPP-run sector whose type offers >= 2 era-available strategies.
  // Tech-locked strategies are never auto-adopted; the 12-turn transition
  // blend, -5% margin penalty and 24-turn cooldown all apply as ever. Player
  // sectors are never touched.
  let genericRestrategized = 0;
  const genericByStrategy: Record<string, number> = {};
  {
    const gs = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
    const currentYear = gs?.currentYear ?? null;
    const genericTypes = Object.entries(SECTOR_STRATEGIES)
      .filter(([type, list]) => type !== "extraction" && (list?.length ?? 0) >= 2)
      .map(([type]) => type);
    const nppCorpDocs = await db
      .collection<Corporation>("corporations")
      .find({ ceoType: "npp", suspended: { $ne: true } })
      .project({ _id: 1 })
      .toArray();
    if (genericTypes.length > 0 && nppCorpDocs.length > 0 && currentYear != null) {
      const genericSectors = await db
        .collection<CorporateSector>("corporateSectors")
        .find({
          sectorType: { $in: genericTypes },
          corporationId: { $in: nppCorpDocs.map((c) => c._id as ObjectId) },
          transitionFromStrategyId: { $in: [null, undefined] },
        })
        .project<
          Pick<
            CorporateSector,
            | "_id"
            | "sectorType"
            | "strategyId"
            | "soldFraction"
            | "transitionCooldownUntilTurn"
            | "capitalStock"
            | "buildQueue"
          >
        >({
          _id: 1,
          sectorType: 1,
          strategyId: 1,
          soldFraction: 1,
          transitionCooldownUntilTurn: 1,
          capitalStock: 1,
          buildQueue: 1,
        })
        .toArray();

      const ratioOf: LaggedPriceRatioFn = (commodity) =>
        priceRatioByCommodity.get(commodity) ?? null;
      const noDeposits: CapacityHeadroomFn = () => 1;
      const eligibleByType = new Map(
        genericTypes.map((type) => [
          type,
          (SECTOR_STRATEGIES[type as keyof typeof SECTOR_STRATEGIES] ?? []).filter(
            (s) =>
              s.requiresTechUnlock !== true &&
              (!s.minDecade || isDecadeReached(s.minDecade, currentYear))
          ),
        ])
      );

      type GenericSwitch = {
        sector: (typeof genericSectors)[number];
        strategyId: string;
        improvement: number;
      };
      const genericSwitches: GenericSwitch[] = [];
      for (const s of genericSectors) {
        if (s.transitionCooldownUntilTurn != null && currentTurn < s.transitionCooldownUntilTurn)
          continue;
        const strategies = eligibleByType.get(s.sectorType) ?? [];
        if (strategies.length < 2) continue;
        const decision = decideExtractionStrategySwitch({
          currentStrategyId: s.strategyId ?? "standard",
          strategies,
          priceRatioOf: ratioOf,
          headroomOf: noDeposits,
          soldFraction: s.soldFraction,
        });
        if (decision) {
          genericSwitches.push({
            sector: s,
            strategyId: decision.strategyId,
            improvement: decision.bestScore - decision.currentScore,
          });
        }
      }

      genericSwitches.sort((a, b) => b.improvement - a.improvement);
      const chosenGeneric = genericSwitches.slice(0, NPP_RESTRATEGIZE_MAX_PER_RUN);
      if (chosenGeneric.length > 0) {
        const now = new Date();
        await db.collection<CorporateSector>("corporateSectors").bulkWrite(
          chosenGeneric.map((p) => ({
            updateOne: {
              filter: { _id: p.sector._id },
              update: {
                $set: {
                  strategyId: p.strategyId,
                  transitionFromStrategyId: p.sector.strategyId ?? "standard",
                  transitionStartTurn: currentTurn,
                  transitionCooldownUntilTurn: currentTurn + STRATEGY_COOLDOWN_TURNS,
                  autoStrategyAdoptedAtTurn: currentTurn,
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
        genericRestrategized = chosenGeneric.length;
        for (const p of chosenGeneric) {
          genericByStrategy[p.strategyId] = (genericByStrategy[p.strategyId] ?? 0) + 1;
        }
      }
    }
  }

  await stampRun(db, currentTurn);
  return {
    converted: chosen.length,
    byResource,
    restrategized,
    restrategizedByStrategy,
    genericRestrategized,
    genericByStrategy,
    ...(shortage.size === 0 &&
    chosen.length === 0 &&
    restrategized === 0 &&
    genericRestrategized === 0
      ? { skippedReason: "no-shortage" }
      : {}),
  };
}

async function stampRun(db: Db, currentTurn: number): Promise<void> {
  await db
    .collection<GameState>("gameState")
    .updateOne({ _id: "current" }, { $set: { lastExtractionAutoStrategyTurn: currentTurn } });
}
