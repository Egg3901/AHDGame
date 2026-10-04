/** Decide NPP corporation operations from a supplied turn snapshot, preserving the existing rules. */
import { buildNppGlutMothballUpdates } from "@/lib/turn/npp/glutMothballing";
import type { ObjectId } from "mongodb";
import type { CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import {
  hasEnterableHeadroom,
  sectorShortageScore,
  sectorPeakShortageScore,
  ESSENTIAL_SHORTAGE_SCORE,
  computeMacroProductionPolicy,
  type CommodityPriceRatioFn,
  type PlacementSignals,
} from "@/lib/turn/npp/marketSignals";
import {
  advanceStrategy,
  strategyLevers,
  type StrategySituation,
} from "@/lib/turn/npp/corpStrategy";
import { chooseNppStrategyRetool } from "@/lib/turn/npp/strategyRetooling";
import {
  hasProtectedConstructionProperty,
  unprotectedConstructionPropertyFilter,
} from "@/lib/corporations/securedConstructionProperty";
import { glutStaggerEligible } from "@/lib/turn/npp/cohort";
import {
  analyzeSectorProfitability,
  type SectorProfitInfo,
} from "@/lib/turn/npp/sectorProfitability";
import { lossChronicityUpdates } from "@/lib/turn/npp/costMothball";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  STRANDED_DIVEST_TURNS,
  STRANDED_DIVEST_MAX_PER_TURN,
} from "@/lib/corporations/strandedPlant";
import { CHRONIC_LOW_FILL_THRESHOLD } from "@/lib/turn/npp/strategyExpectedRevenue";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { getLogisticsSupportedSectorCount } from "@/lib/constants/corporations";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import {
  CAPACITY_BUILD_TURNS,
  computeBuildCost,
  MAX_BUILD_UNITS_PER_ORDER,
  revenuePerCapacityUnit,
} from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import {
  anchorToCorpCapital,
  resolveSectorHostCurrencyCode,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CapacityDecisionObservation } from "@/lib/corporations/capacityDecisionTelemetry/rules";
import {
  buildNppOperatorObservation,
  type NppDecisionConstraint,
} from "@/lib/corporations/nppOperatorTelemetry/rules";
import {
  createFoundingCapacityOutcome,
  createReinvestCapacityObserver,
  evaluateReinvestPreSizingGate,
  makeCapacityCashToAnchor,
  noteFoundingCapacityOutcome,
  pushFoundingCapacityObservation,
  resolveCapacityCohort,
} from "@/lib/turn/npp/capacityDecisionTelemetry";
import {
  createReinvestPoolLookup,
  reinvestPoolHeadroomUnits,
  type ReinvestCandidate,
} from "@/lib/turn/npp/reinvestCandidatePool";
import { pushNppWageUpdates } from "@/lib/turn/npp/nppWagePolicy";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { getNppCashFloorAnchor } from "@/lib/turn/npp/nppCashReserve";
import { fragileReinvestmentPriority } from "@/lib/turn/npp/fragileMarketSupply";
import {
  resolveFoundingShortfallReason,
  setNppMarketEntryReason,
} from "@/lib/turn/npp/entryDiagnostics";
import { evaluateNppEntry } from "@/lib/turn/npp/entryEvaluation";
import {
  evaluateFrontierCandidate,
  settleFrontierEntryPlacement,
} from "@/lib/turn/npp/frontierEntryCandidate";
import type {
  NppCorpDecision,
  NppCorpDecisionContext,
  NppPlantsContext,
} from "@/lib/turn/npp/corpDecisionTypes";
import {
  GROWTH_COST_MARGIN_SHARE,
  NPP_REINVEST_AGGRESSION,
  NPP_REINVEST_MIN_FILL,
  NPP_REINVEST_MAX_QUEUE_DEPTH,
  NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH,
  NPP_GROWTH_DEPLOY_FRACTION,
  NPP_GROWTH_MIN_SHORTAGE,
  NPP_GROWTH_MIN_UTILIZATION,
  NPP_GROWTH_MAX_STEP_OF_RUN,
  NPP_REINVEST_MAX_SECTORS_PER_TURN,
  NPP_REINVEST_MAINTENANCE_CASH_SHARE,
  EXPANSION_COST,
  EXPANSION_MIN_CASH,
  EXPANSION_MIN_MARGIN,
  NPP_SHORTAGE_ENTRIES_PER_TURN,
  NPP_FOUNDING_DEPLOY_FRACTION,
  NPP_FOUNDING_HEADROOM_SHARE,
  NPP_EXTRACTION_FOUNDING_MAX_FACILITIES,
  MAX_DIVIDEND_RATE,
} from "@/lib/turn/npp/nppCorporationTuning";

export function makeNppCorpDecision(
  ctx: NppCorpDecisionContext,
  unownedByCountry: Map<string, UnownedSector[]>,
  stateControlled: ReadonlySet<string>,
  priceRatioOf: CommodityPriceRatioFn,
  plants?: NppPlantsContext,
  placementSignals?: PlacementSignals
): NppCorpDecision {
  const { corp, sectors, now, modifiers } = ctx;
  const coreSectorModel = corp.industryModel ?? null;
  const isCoreSector = (sector: CorporateSector) =>
    sector.sectorType === corp.type && (sector.industryModel ?? null) === coreSectorModel;
  const operatingCorpType = getOperatingSectorType(
    corp.type,
    corp.industryModel,
    corp.mediaDiscriminator
  ) as CorporationType;
  const updates: Record<string, unknown> = { updatedAt: now };
  const sectorUpdates: NppCorpDecision["sectorUpdates"] = [];
  const newSectors: NppCorpDecision["newSectors"] = [];
  const divestedSectorIds: ObjectId[] = [];
  const unownedDraws: NonNullable<NppCorpDecision["unownedDraws"]> = [];
  const reinvestments: NonNullable<NppCorpDecision["reinvestments"]> = [];
  const constructionFinanceIntents: NonNullable<NppCorpDecision["constructionFinanceIntents"]> = [];
  let shortageCreditRequest: NppCorpDecision["shortageCreditRequest"];
  let entryDiagnostic: NppCorpDecision["entryDiagnostic"];

  const liquidCapital = corp.liquidCapital ?? 0;
  const passive = ctx.caretakerMandate === "passive";
  let cashLocal = liquidCapital;
  let foundingCashLocal: number | undefined;
  const numSectors = sectors.length;

  const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corp);
  const corpFxRate = ctx.fxRate ?? 1;
  const toCorpLocal = (amountAnchor: number): number =>
    anchorToCorpCapital(amountAnchor, corpCurrencyCode, corpFxRate);
  const cashToAnchor = makeCapacityCashToAnchor(corp, corpFxRate);
  const capacityCohort = resolveCapacityCohort(corp);
  const nationalShare = (
    countryId: string,
    sectorType: CorporationType,
    industryModel?: string | null,
    mediaDiscriminator?: string | null
  ) =>
    plants?.nationalShareOf?.(
      corp._id,
      countryId,
      sectorType,
      industryModel,
      mediaDiscriminator as "entertainment" | null | undefined
    ) ?? 0;
  const capacityObservations: CapacityDecisionObservation[] = [];
  // Which of the four operator decision legs bound this corp this turn (#2122);
  // sections below flag the branch they take and the resolver picks the first.
  const constraintFlags: Partial<Record<NppDecisionConstraint, boolean>> = {};
  const ownCorporationId = corp._id.toString();
  const rivalCount = (stateId: string, sectorType: string): number =>
    ctx.competitorCountOf?.(stateId, sectorType, ownCorporationId) ?? 0;
  const sectorEconomicToCorpLocal = (amount: number, sector: CorporateSector): number => {
    const hostCurrency = resolveSectorHostCurrencyCode(sector, corp);
    const hostRate =
      (hostCurrency && ctx.fxByCurrency?.get(hostCurrency)) ??
      (hostCurrency === corpCurrencyCode ? corpFxRate : 1);
    return toCorpLocal(readCorpEconomicAnchor(amount, hostCurrency, hostRate));
  };

  // Archetype-adjusted levers, each clamped to a safe rail so no personality can
  // bankrupt a profitable corp. Clamped in ₳ (where the rails are authored),
  // then converted once into the currency `liquidCapital` is compared in.
  const effectiveCashFloor = toCorpLocal(
    getNppCashFloorAnchor(plants?.enabled ? plants.preset : undefined, modifiers.cashFloorMult)
  );
  const effectiveExpansionMinMargin = EXPANSION_MIN_MARGIN * modifiers.expansionMinMarginMult;
  const effectiveExpansionMinCash = toCorpLocal(
    EXPANSION_MIN_CASH * modifiers.expansionMinCashMult
  );

  // ── Profitability analysis ─────────────────────────────────────────────────
  const sectorProfits = analyzeSectorProfitability(sectors, plants?.enabled === true);
  const profitableSectors = sectorProfits.filter((sp) => sp.isProfitable).length;

  // Count consecutive loss turns for active NPP sectors. Restart resets the count.
  if (plants?.enabled === true) {
    sectorUpdates.push(...lossChronicityUpdates(sectorProfits, now));
  }

  // `totalIncome`/`totalRevenue`/`corpMargin`/`isProfitable` below feed ONLY
  // sections 3-5 (budgets, dividends, expansion) — never sections 1-2, which
  // read sp.income/sp.margin directly. Three compounding bugs made those
  // sections spend a corp into the ground while reading it as healthy:
  //
  // (1) Blind to its own overhead. The old figures were pure SECTOR income —
  //     before the very marketing/logistics/R&D/CEO-salary spend section 3 was
  //     about to size — so an NPP kept raising overhead while real income fell.
  //     Measured on a stopped 657-turn world: totalCosts/revenue rose 0.49 →
  //     1.19 and 89% of corps were loss-making, while sector
  //     effectiveProfitMargin held flat at 45-60. Fix: subtract last turn's
  //     ACTUAL spend (below) before judging profitability.
  //
  // (2) Sized off the wrong revenue. `sector.revenue` is NOMINAL (book) revenue;
  //     the corp collects `realizedRevenue` and pays overhead out of it. Sizing
  //     budgets off nominal while charging them against realized multiplies the
  //     true burden by 1/realizationRatio (measured ~3×). Use realizedRevenue.
  //
  // (3) Blind to its own debt. Bond interest is contracted, not discretionary,
  //     and was absent, so an operating-profitable corp could lose money every
  //     turn while reading healthy. See NppCorpDecisionContext.debtServiceAnchor.
  //     Charged in the corp's own currency, like every other money constant here.
  const realizedOrNominal = (sp: SectorProfitInfo) =>
    sectorEconomicToCorpLocal(sp.sector.realizedRevenue ?? sp.sector.revenue ?? 0, sp.sector);
  const totalRevenue = sectorProfits.reduce((sum, sp) => sum + realizedOrNominal(sp), 0);
  const grossRealizedIncome = sectorProfits.reduce(
    (sum, sp) => sum + realizedOrNominal(sp) * (sp.margin / 100),
    0
  );
  const priorOverhead =
    (corp.marketingBudget ?? 0) +
    (corp.logisticsBudget ?? 0) +
    (corp.rdBudget ?? 0) +
    (corp.ceoSalary ?? 0);
  const debtServiceLocal = toCorpLocal(ctx.debtServiceAnchor ?? 0);
  const totalIncome = grossRealizedIncome - priorOverhead - debtServiceLocal;
  const corpMargin = totalRevenue > 0 ? (totalIncome / totalRevenue) * 100 : 0;
  const isProfitable = totalIncome > 0 && profitableSectors > 0;

  // ── v5 strategy loop ───────────────────────────────────────────────────────
  // The score is `corpMargin` itself: already currency-normalized, scale-free,
  // and net of both overhead and debt service. One number, comparable across
  // countries and eras, unlike every money constant in this module.
  //
  // Everything below only RE-WEIGHTS levers that already existed. `expand` is
  // the identity, so a corp that is doing fine never changes behaviour.
  const debtDominant = debtServiceLocal > 0 && debtServiceLocal >= grossRealizedIncome;
  const lowFillSectors = sectorProfits.filter(
    (sp) => sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD
  ).length;
  const situation: StrategySituation = {
    score: corpMargin,
    debtDominant,
    // "Mostly cannot sell what it makes": a majority of the corp's sectors.
    chronicLowFill: sectorProfits.length > 0 && lowFillSectors * 2 > sectorProfits.length,
    hasHeadroom: hasEnterableHeadroom(
      corp,
      sectors,
      unownedByCountry,
      stateControlled,
      plants?.enabled === true,
      plants?.eraUnitScale ?? 1
    ),
    // Derived from the corp, NOT passed in. An `isCaretaker` the caller had
    // to remember to set is one more way to get this wrong, which is the
    // exact bug class this module keeps producing: the seeded-margin read,
    // the nominal-revenue read, the unconverted foreign revenue. The corp
    // document already knows.
    isCaretaker: !!corp.caretakerCeo,
  };
  // Absent reads as enabled: see `strategyLoopEnabled`. When off, the corp runs
  // the `expand` levers and no strategy state is written, so an operator can
  // kill the loop mid-world without a revert and without leaving stale memory
  // that would resume the moment it is re-enabled.
  const strategyLoopOn = ctx.strategyLoopEnabled !== false;
  const strategyDecision = strategyLoopOn
    ? advanceStrategy({
        prior: ctx.strategy,
        turn: ctx.turn,
        situation,
        eligible: ctx.strategyEligible === true,
      })
    : null;
  const levers = strategyLevers(strategyDecision?.state.id ?? "expand");

  // ── 1. Divest losing sectors ──────────────────────────────────────────────
  // Divest a losing sector once its margin falls to/below the archetype's
  // tolerance (impatient archetypes shed at the first loss; patient ones tolerate
  // shallow losses) and the corp has other profitable sectors — BUT never divest
  // the corp's primary type (core business).
  if (numSectors > 1) {
    for (const sp of sectorProfits) {
      if (
        !hasProtectedConstructionProperty(sp.sector) &&
        sp.income < 0 &&
        sp.margin <= modifiers.divestMarginFloor + levers.divestMarginFloorDelta
      ) {
        // Protect the corp's primary sector type — that's its core business
        if (isCoreSector(sp.sector)) {
          constraintFlags.divest_core_protected = true;
          continue;
        }

        const remainingProfitable = profitableSectors;
        if (remainingProfitable > 0) {
          divestedSectorIds.push(sp.sector._id);
        } else {
          constraintFlags.divest_no_other_income = true;
        }
      }
    }
  }

  // ── 1b. Divest stranded plants (supply-dislocation phase 2) ───────────────
  // A plant that has cleared less than half its output for STRANDED_DIVEST_TURNS
  // straight is built in the wrong place, and margin cannot see it: the units
  // that DO sell carry a healthy margin while most of the output evaporates.
  // Exit it so the corp's next founding (state-aware since P1) rebuilds where
  // the demand is. Same protections as the margin divest — never the corp's
  // core type, never the last sector, only while something else is profitable —
  // plus a one-per-turn cap so exits stay gradual. Capacity is deliberately not
  // restored to the unowned pool: the state is glutted, re-listing the bucket
  // would invite the next founding straight back in.
  if (plants?.enabled && numSectors > 1 && profitableSectors > 0) {
    let strandedDivests = 0;
    // Longest-stranded first, so the cap exits the worst plant.
    const stranded = sectorProfits
      .filter(
        (sp) =>
          (sp.sector.lowFillTurns ?? 0) >= STRANDED_DIVEST_TURNS &&
          !isCoreSector(sp.sector) &&
          !hasProtectedConstructionProperty(sp.sector) &&
          sp.sector.mothballed !== true &&
          !divestedSectorIds.includes(sp.sector._id)
      )
      .sort((a, b) => (b.sector.lowFillTurns ?? 0) - (a.sector.lowFillTurns ?? 0));
    for (const sp of stranded) {
      if (strandedDivests >= STRANDED_DIVEST_MAX_PER_TURN) break;
      if (numSectors - divestedSectorIds.length <= 1) break;
      divestedSectorIds.push(sp.sector._id);
      strandedDivests += 1;
    }
  }

  // Divest-leg flag (section 1): a completed shed; blocked-shed flags are set
  // inside the margin-divest loop above.
  if (divestedSectorIds.length > 0) constraintFlags.divested = true;

  // Effective sector count after divestiture
  const effectiveSectors = numSectors - divestedSectorIds.length;
  const logisticsSupportedSectors = getLogisticsSupportedSectorCount(corp.logisticsStrength);

  // ── 2. Growth rate adjustment (per-sector) ────────────────────────────────
  // Aggressive: strong sectors get +2, healthy +1, thin stays, loss -2.
  // Then a macro tilt (smarter-NPP, t879): the margin signal alone floods
  // gluts (a strong-margin sector in a deep glut still accelerated) and
  // starves shortages (a thin sector selling a scarce commodity never grew).
  // Shortage outputs get +1 growth, deep-glut outputs −1, so NPP capacity
  // chases unmet demand instead of pure own-margin momentum.
  for (const sp of sectorProfits) {
    // Skip sectors being divested
    if (divestedSectorIds.includes(sp.sector._id)) continue;
    // A mothballed plant is deliberately idle (section 2c): growth targets are
    // meaningless while it's cold, and its stale margin would only add noise.
    if (sp.sector.mothballed === true) continue;
    // Plants: growth targets are vestigial — sectorTurn zeroes them every
    // turn, so adjusting them here is write churn with no reader. The AI
    // grows via section 6 reinvestment build orders instead.
    if (plants?.enabled) continue;

    // Fill-awareness (t899): lagged soldFraction is only set under clearing
    // mode. A sector that sold < CHRONIC_LOW_FILL_THRESHOLD of its output last
    // turn must not expand — more output would just go unsold. The strategy
    // brain (extractionAutoStrategy pass 2) handles re-pointing it at higher
    // expected revenue; here we only stop it digging deeper.
    const chronicLowFill =
      sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD;

    let targetGrowth = sp.sector.targetGrowthRate ?? 2;

    // Growth must pay for itself. The category ladder below keys on MARGIN, but
    // margin alone does not tell you whether expanding is affordable: growth
    // cost is charged as a share of revenue, so a sector can hold a healthy
    // 25% margin and still lose money once a 21%-of-revenue growth bill lands
    // on top of 75% maintenance. Measured mid-run, that is exactly where firms
    // sat — margin 25, growth cost 21%, income negative — and because 25 reads
    // as "strong" the governor kept ADDING growth every turn, deepening the
    // loss it was supposed to correct.
    //
    // So: never increase growth when the sector's own growth bill already eats
    // its margin, and back off when it clearly exceeds it. A firm with real
    // headroom still expands; one paying more to grow than it earns stops.
    const sectorRevenue = sp.sector.revenue ?? 0;
    const growthCostShare =
      sectorRevenue > 0 ? (100 * (sp.sector.currentGrowthCost ?? 0)) / sectorRevenue : 0;
    // Growth may consume at most HALF the gross margin. Comparing it to the
    // whole margin was too permissive: measured mid-run at margin 27.2 with
    // growth cost 21.4% of revenue, the test passed (21.4 < 27.2) while the
    // firm was plainly losing money — maintenance takes (100 - margin) = 72.8%,
    // so margin plus growth already consumed 94.2% of revenue before any
    // corporate overhead, and average income sat at -13.4k with 67% of firms
    // loss-making. Requiring real headroom is what makes the governor bite: as
    // growth falls its cost falls, so the rule is self-correcting rather than a
    // fixed target.
    const growthUnaffordable = growthCostShare >= sp.margin * GROWTH_COST_MARGIN_SHARE;

    if (growthUnaffordable) {
      constraintFlags.growth_unaffordable = true;
      targetGrowth = Math.max(0, targetGrowth - 1);
    } else if (sp.marginCategory === "loss") {
      constraintFlags.loss_margin = true;
      targetGrowth = Math.max(0, targetGrowth - 2);
    } else if (sp.marginCategory === "strong") {
      targetGrowth = Math.min(5, targetGrowth + 2 + modifiers.growthDelta + levers.growthDelta);
    } else if (sp.marginCategory === "healthy") {
      targetGrowth = Math.min(5, targetGrowth + 1 + modifiers.growthDelta + levers.growthDelta);
    }
    // Thin margin → keep current target

    // State-resolution shortage (supply-dislocation P1b): the country blend
    // hid exactly the dislocation this tilt exists to correct — a plant in a
    // glutted state kept growing because OTHER states' shortage pulled the
    // national ratio up. Score the plant's own state, country fallback.
    const shortage = sectorShortageScore(
      sp.sector.sectorType,
      sp.sector.countryId ?? corp.countryId,
      (commodity, cid) =>
        placementSignals?.statePriceRatioOf?.(commodity, sp.sector.stateId) ??
        priceRatioOf(commodity, cid)
    );
    if (shortage >= 1.15 && sp.marginCategory !== "loss" && !growthUnaffordable) {
      targetGrowth = Math.min(5, targetGrowth + 1);
    } else if (shortage <= 0.85) {
      constraintFlags.glut_signal = true;
      targetGrowth = Math.max(0, targetGrowth - 1);
    }

    // Chronic low fill overrides every upward signal: never grow a sector
    // that can't sell what it already makes.
    if (chronicLowFill) {
      constraintFlags.chronic_low_fill = true;
      targetGrowth = Math.min(targetGrowth, sp.sector.targetGrowthRate ?? 2, 1);
    }

    if (targetGrowth !== (sp.sector.targetGrowthRate ?? 2)) {
      sectorUpdates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { targetGrowthRate: targetGrowth, updatedAt: now } },
      });
    }
  }

  // ── 2b. Macro-aware production policy ─────────────────────────────────────
  // Ramp output of scarce/premium commodities. Glut response is growth-only
  // (section 2a) — see computeMacroProductionPolicy for why negative policy
  // is forbidden here. Trends 1pt/turn toward the target via the turn engine.
  for (const sp of sectorProfits) {
    if (divestedSectorIds.includes(sp.sector._id)) continue;
    if (sp.sector.mothballed === true) continue;
    const sectorCountryId = sp.sector.countryId ?? corp.countryId;
    let target = computeMacroProductionPolicy(sp.sector.sectorType, sectorCountryId, priceRatioOf);
    if (target == null) continue;
    // Fill-awareness (t899): under chronic low fill, cap the production policy
    // at 0 — a shortage price signal is no reason to ramp output this sector
    // demonstrably cannot sell.
    if (sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD) {
      target = Math.min(target, 0);
    }
    if (target !== (sp.sector.productionPolicy ?? 0)) {
      sectorUpdates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { productionPolicy: target, updatedAt: now } },
      });
    }
  }

  // ── 2c. Glut mothballing (plants only) ────────────────────────────────────
  sectorUpdates.push(
    ...buildNppGlutMothballUpdates({
      corporation: corp,
      turn: ctx.turn,
      now,
      plantsEnabled: plants?.enabled === true,
      sectorProfits,
      divestedSectorIds,
      priceRatioOf,
    })
  );

  // Input-squeeze strategy shifts use the 2c cohort independently: a mothball and a strategy
  // shift never target the same sector (a shift candidate is running and
  // selling; a mothball candidate is unfilled), and only one shift per corp
  // per turn keeps the cohort gradual. SOEs are exempt for 2c's reason.
  if (!corp.countryOwnerId && glutStaggerEligible(corp._id.toString(), ctx.turn)) {
    const retool = chooseNppStrategyRetool({
      corp,
      sectors,
      divestedSectorIds,
      turn: ctx.turn,
      now,
      currentYear: ctx.currentYear ?? 0,
      techTreesEnabled: ctx.techTreesEnabled ?? false,
      plantsEnabled: plants?.enabled === true,
      priceRatioOf,
    });
    if (retool) {
      sectorUpdates.push({
        filter: { _id: retool.sectorId },
        update: { $set: retool.updates },
      });
    }
  }

  // ── 2d. Wage policy (labour wages+) ───────────────────────────────────────
  // Stepped toward shortage/glut targets one tick at a time; see nppWagePolicy.
  if (ctx.labourWagesEnabled) {
    pushNppWageUpdates({
      corp,
      sectorProfits,
      divestedSectorIds,
      priceRatioOf,
      now,
      sectorUpdates,
    });
  }

  // ── 3. Budget decisions (revenue-based, not cash-based) ───────────────────
  // Budgets scale on what the corp EARNS, not what it holds. `totalRevenue`/
  // `corpMargin`/`isProfitable` are the net-of-overhead figures computed above.

  // Base budget shares by margin band, then scaled by archetype (marketing/R&D).
  // Logistics is an operational lever, not a personality one, so it's unscaled.
  let marketingPct: number;
  let logisticsPct: number;
  let rdPct: number;
  const isCashCrisis = liquidCapital <= effectiveCashFloor;
  if (!isProfitable || totalRevenue === 0 || isCashCrisis) {
    // Cash distress overrides accounting profit for discretionary budgets.
    marketingPct = 0.005;
    logisticsPct = 0.003;
    rdPct = 0;
  } else if (corpMargin < 10) {
    // Thin margins: lean budgets, no R&D
    marketingPct = 0.015;
    logisticsPct = 0.01;
    rdPct = 0;
  } else if (corpMargin < 25) {
    // Healthy margins: moderate investment
    marketingPct = 0.03;
    logisticsPct = 0.02;
    rdPct = 0.01;
  } else {
    // Strong margins: aggressive investment to grow
    marketingPct = 0.05;
    logisticsPct = 0.03;
    rdPct = 0.02;
  }

  // Budget-leg flag (section 3), in the code's own branch order.
  if (isCashCrisis) constraintFlags.budget_cash_crisis = true;
  else if (!isProfitable || totalRevenue === 0) constraintFlags.budget_unprofitable = true;
  else if (corpMargin < 10) constraintFlags.budget_thin_margin = true;

  const marketingBudget = Math.round(
    totalRevenue * marketingPct * modifiers.marketingMult * levers.marketingMult
  );
  const logisticsBudget = Math.round(totalRevenue * logisticsPct);
  const rdBudget = Math.round(totalRevenue * rdPct * modifiers.rdMult * levers.rdMult);
  if (marketingBudget !== (corp.marketingBudget ?? 0)) updates.marketingBudget = marketingBudget;
  if (logisticsBudget !== (corp.logisticsBudget ?? 0)) updates.logisticsBudget = logisticsBudget;
  if (rdBudget !== (corp.rdBudget ?? 0)) updates.rdBudget = rdBudget;

  // ── 4. Dividend policy ────────────────────────────────────────────────────
  // Rate scales with margin — higher margin = higher payout. isProfitable/
  // corpMargin are net of overhead (see profitability-analysis block above) —
  // a corp whose marketing/logistics/R&D/CEO-salary spend is eating its
  // sector income no longer reads as dividend-eligible just because its
  // sectors look healthy in isolation.
  let targetDividendRate = 0;
  if (isProfitable && liquidCapital > effectiveCashFloor && corpMargin >= 15) {
    if (corpMargin >= 30) targetDividendRate = 8;
    else if (corpMargin >= 20) targetDividendRate = 5;
    else targetDividendRate = 3;
    // Archetype tilts payout vs. reinvestment, clamped to a sane ceiling.
    targetDividendRate = Math.min(
      MAX_DIVIDEND_RATE,
      Math.round(targetDividendRate * modifiers.dividendMult * levers.dividendMult)
    );
  }
  // Dividend-leg flag (section 4): why the payout was withheld.
  if (targetDividendRate === 0) {
    if (!isProfitable) constraintFlags.dividend_unprofitable = true;
    if (!(liquidCapital > effectiveCashFloor)) constraintFlags.dividend_cash_floor = true;
    if (corpMargin < 15) constraintFlags.dividend_margin_below_min = true;
  }
  if (targetDividendRate !== (corp.dividendRate ?? 0)) {
    updates.dividendRate = targetDividendRate;
  }

  if (passive) {
    updates.marketingBudget = 0;
    updates.logisticsBudget = 0;
    updates.rdBudget = 0;
    updates.dividendRate = 0;
    return {
      corpId: corp._id,
      updates,
      liquidCapitalDelta: 0,
      cashFloorLocal: effectiveCashFloor,
      sectorUpdates,
      strategy: strategyDecision?.state,
      operatorObservation: buildNppOperatorObservation({
        sectorType: operatingCorpType,
        cashNegative: cashLocal < 0,
        passive: true,
        profitable: isProfitable,
        marginPct: corpMargin,
        cashCrisis: isCashCrisis,
        entryReason: entryDiagnostic?.reason,
        dividendRate: 0,
        divestedSectors: divestedSectorIds.length,
        reinvestments: 0,
        cashHeadroomAnchor: cashToAnchor(cashLocal - effectiveCashFloor),
        constraintFlags,
      }),
    };
  }

  // ── 5. Sector expansion ───────────────────────────────────────────────────
  // Candidate search, ordinary entry gates, and the funnel diagnostic naming
  // the first binding gate. See evaluateNppEntry. The frontier fallback (5b)
  // overlays this evaluation; the shared priced founding block below prices
  // whichever target survives.
  const surplusCash = liquidCapital - effectiveCashFloor;
  const entry = evaluateNppEntry({
    corp,
    sectors,
    unownedByCountry,
    stateControlled,
    priceRatioOf,
    placementSignals,
    plantsEnabled: plants?.enabled === true,
    eraUnitScale: plants?.eraUnitScale ?? 1,
    profitable: isProfitable,
    marginPct: corpMargin,
    marginFloorPct: effectiveExpansionMinMargin,
    surplusCash,
    minCash: effectiveExpansionMinCash,
    sectorCount: effectiveSectors,
    logisticsSupportedSectors,
    allowExpansion: levers.allowExpansion,
    ordinaryEntryEligible: ctx.ordinaryEntryEligible,
    shortageEntryEligible: ctx.shortageEntryEligible,
    retailExpansionPaused: ctx.retailExpansionPaused,
    entryCapReached: newSectors.length >= NPP_SHORTAGE_ENTRIES_PER_TURN,
  });
  const {
    entryCandidate,
    expansion,
    hasLogisticsCapacity,
    marketEntryEligible,
    exceptionalShortageEntry,
    ordinaryEntryTargetGlutted,
    ordinaryEntry,
    foundingStrategyId,
  } = entry;
  entryDiagnostic = entry.diagnostic;
  // Whether the founding evaluation below runs at all. Captured so the
  // capacity observation can tell pre-evaluation gates (eligibility, demand)
  // from affordability gates; `newSectors` is still empty here, so the cap
  // term is trivially true and needs no gate of its own.
  // ── 5b. Frontier-entry experiment fallback (issue #991) ───────────────────
  // A policy-cleared candidate rejected only on an expectational gate gets
  // one priced evaluation through the shared founding block below. See
  // evaluateFrontierCandidate for the relaxable reasons, gate revalidation,
  // and slot checks.
  const frontier = evaluateFrontierCandidate({
    turnState: ctx.frontierEntry,
    corp,
    candidate: entryCandidate,
    diagnostic: entryDiagnostic,
    placementSignals,
    gates: {
      allowExpansion: levers.allowExpansion,
      hasLogisticsCapacity,
      marketEntryEligible,
      retailBlocked: ctx.retailExpansionPaused === true && entryCandidate?.sectorType === "retail",
      targetGlutted: ordinaryEntryTargetGlutted,
    },
  });
  // The ordinary target when the corp earned it, else the experiment's
  // second-chance target. `expansion` is the entry candidate itself whenever
  // it is non-null, so the block below prices the same slot either way.
  const foundingTarget = expansion ?? frontier?.target ?? null;
  const foundingBlockEntered =
    foundingTarget !== null &&
    newSectors.length < NPP_SHORTAGE_ENTRIES_PER_TURN &&
    (ordinaryEntry || exceptionalShortageEntry || frontier !== null);
  // Founding outcome tracked across the priced branches for the capacity
  // observation; see capacityDecisionTelemetry. Blank until a branch prices
  // the candidate: pre-pricing gates observe explicit zeros, never a
  // fabricated quote.
  const foundingOutcome = createFoundingCapacityOutcome();
  if (foundingBlockEntered) {
    if (plants?.enabled) {
      // NPPs and players found sectors on the same priced-capacity terms.
      const headroomUnits = unownedHeadroomUnitsOf(
        foundingTarget.sectorType as CorporationType,
        foundingTarget.headroomUnits,
        foundingTarget.revenue,
        plants.eraUnitScale,
        foundingTarget.industryModel,
        foundingTarget.mediaDiscriminator
      );
      const starterUnits = foundingStarterUnits(
        foundingTarget.sectorType as CorporationType,
        foundingTarget.industryModel as "vehicles" | null | undefined,
        foundingTarget.mediaDiscriminator
      );
      // Per-unit founding price. computeBuildCost is linear in units, so a
      // one-unit quote scales exactly while retaining its itemized breakdown.
      const foundingUnitQuote =
        starterUnits > 0
          ? computeBuildCost({
              sectorType: foundingTarget.sectorType as CorporationType,
              industryModel: foundingTarget.industryModel,
              mediaDiscriminator: foundingTarget.mediaDiscriminator,
              units: 1,
              // Greenfield entry uses the sector-type default strategy.
              strategyId: null,
              year: plants.year,
              eraUnitScale: plants.eraUnitScale,
              marketSharePercent: 0,
              nationalMarketSharePercent: nationalShare(
                foundingTarget.countryId,
                foundingTarget.sectorType as CorporationType,
                foundingTarget.industryModel,
                foundingTarget.mediaDiscriminator
              ),
              primeRate: plants.primeRateOf(foundingTarget.countryId),
              // NPP CEOs have no Character Business Acumen; neutral is honest.
              acumen: NEUTRAL_STAT,
              hostCostOfLivingIndex: plants.costOfLivingOf(foundingTarget.stateId),
              founding: true,
            })
          : null;
      const perUnitFoundingAnchor = foundingUnitQuote?.totalAnchor ?? 0;
      // Charged in the corp's own currency: fee + build are ₳, liquidCapital is not.
      const entryFeeAnchor = sectorEntryFeeAnchor(plants.preset);
      const entryCapital =
        liquidCapital + (exceptionalShortageEntry ? (ctx.shortageEntryCreditLocal ?? 0) : 0);
      // Size the first build to available capital, not a token facility. Deploy
      // a bounded fraction of post-floor, post-fee surplus into capacity, capped
      // by the market's unowned headroom and by the per-order ceiling, and
      // floored at the one-facility quantum so a cash-poor entry still behaves
      // as before. See NPP_FOUNDING_DEPLOY_FRACTION.
      const perUnitFoundingLocal = toCorpLocal(perUnitFoundingAnchor);
      const entryFeeLocal = toCorpLocal(entryFeeAnchor);
      const deployBudgetLocal = Math.max(
        0,
        (entryCapital - effectiveCashFloor - entryFeeLocal) * NPP_FOUNDING_DEPLOY_FRACTION
      );
      const affordableUnits =
        perUnitFoundingLocal > 0 ? Math.floor(deployBudgetLocal / perUnitFoundingLocal) : 0;
      const isExtraction = foundingTarget.sectorType === "extraction";
      // Extraction founds against a DEPOSIT, not local demand: its output is a
      // traded commodity sold wherever the commodity is short, so it has no
      // demand-headroom cap (headroomUnits is 0 for every extraction bucket by
      // construction). Cash and a per-mine facility ceiling bound it instead;
      // the state deposit haircut caps real output and the reinvestment growth
      // leg deepens it over turns. Demand-side sectors keep the headroom cap.
      const sizeCap = isExtraction
        ? starterUnits * NPP_EXTRACTION_FOUNDING_MAX_FACILITIES
        : headroomUnits * NPP_FOUNDING_HEADROOM_SHARE;
      const buildUnits =
        starterUnits > 0
          ? Math.max(
              starterUnits,
              Math.floor(Math.min(sizeCap, affordableUnits, MAX_BUILD_UNITS_PER_ORDER))
            )
          : 0;
      const buildAnchor = perUnitFoundingAnchor * buildUnits;
      const foundingCost = toCorpLocal(entryFeeAnchor + buildAnchor);
      entryDiagnostic = {
        ...entryDiagnostic,
        targetHeadroomUnits: headroomUnits,
        starterUnits: buildUnits,
        foundingCostLocal: foundingCost,
        entryCapitalLocal: entryCapital,
        cashFloorLocal: effectiveCashFloor,
      };

      // Affordability against the REAL cost. The generic surplus gate above is
      // a flat nominal band and cannot know what a build in this sector costs;
      // without this an NPP would commit to a plant it cannot pay for and drive
      // itself under the cash floor. Demand-side sectors also require the market
      // have room for the facility; extraction is deposit-gated (candidacy)
      // rather than headroom-gated, so it skips that check.
      // Named (not inlined) so the capacity observation below records the same
      // first-rejecting-gate outcome the branch takes.
      noteFoundingCapacityOutcome(foundingOutcome, {
        affordable:
          buildUnits > 0 &&
          (isExtraction || headroomUnits >= buildUnits) &&
          entryCapital - foundingCost >= effectiveCashFloor,
        creditPath:
          exceptionalShortageEntry &&
          starterUnits > 0 &&
          headroomUnits >= starterUnits &&
          !isStateOwned(corp) &&
          !corp.imfBailoutActive,
        sizeBlocked: starterUnits <= 0 || headroomUnits < starterUnits,
        quote: {
          unitPriceAnchor: perUnitFoundingAnchor,
          dominanceMultiplier: foundingUnitQuote?.dominanceMultiplier ?? 1,
          requestedUnits: buildUnits,
          cashHeadroomAnchor: cashToAnchor(entryCapital - foundingCost),
        },
      });
      if (foundingOutcome.affordable) {
        const buildTurns = Math.max(
          1,
          CAPACITY_BUILD_TURNS(foundingTarget.sectorType as CorporationType, true)
        );
        // Legacy nameplate: demand-side sectors take the built share of the
        // pool; extraction has no pool, so it prices the nameplate off the units
        // built (unit x revenue-per-unit), as the player founding path does.
        const nameplateShare = headroomUnits > 0 ? Math.min(1, buildUnits / headroomUnits) : 0;
        const nameplateAnchor = isExtraction
          ? buildUnits *
            revenuePerCapacityUnit(
              foundingTarget.sectorType as CorporationType,
              plants.eraUnitScale,
              foundingTarget.industryModel,
              foundingTarget.mediaDiscriminator
            )
          : foundingTarget.revenue * nameplateShare;
        newSectors.push({
          stateId: foundingTarget.stateId,
          countryId: foundingTarget.countryId,
          sectorType: foundingTarget.sectorType,
          mediaDiscriminator: foundingTarget.mediaDiscriminator,
          strategyId: foundingStrategyId,
          // Written in the corp's own currency, because that is what
          // `sectorTurn` reads it as (`readCorpEconomicAnchor` on the way in,
          // `writeCorpEconomicLocal` on the way out). The unowned pool is ₳,
          // so an unconverted copy made the sector's stored nameplate 1/fx of
          // the value the very next turn would restate it to — a one-turn ×fx
          // step change in every non-anchor currency.
          revenue: Math.round(toCorpLocal(nameplateAnchor)),
          profitMargin: 35,
          starterOrder: {
            unitsOrdered: buildUnits,
            // Greenfield: priced at the sector-type default, same as the quote.
            strategyId: null,
            costPaidAnchor: buildAnchor,
            startTurn: ctx.turn,
            onlineTurn: ctx.turn + buildTurns,
            smooth: true,
          },
        });
        unownedDraws.push({
          stateId: foundingTarget.stateId,
          sectorType: foundingTarget.sectorType as CorporationType,
          mediaDiscriminator: foundingTarget.mediaDiscriminator,
          units: buildUnits,
          countryId: foundingTarget.countryId,
        });
        cashLocal = entryCapital - foundingCost;
        foundingCashLocal = foundingCost;
        entryDiagnostic = setNppMarketEntryReason(entryDiagnostic, "entered");
      } else {
        if (foundingOutcome.creditPath) {
          shortageCreditRequest = {
            amountLocal: Math.max(0, foundingCost + effectiveCashFloor - entryCapital),
            sectorType: foundingTarget.sectorType as CorporationType,
          };
        }
        // Names the priced shortfall explicitly. Previously an
        // unaffordable candidate with no credit, size, or exceptional path
        // kept its pre-pricing reason (usually the cash floor), so the
        // funnel understated real founding-cost rejections.
        entryDiagnostic = setNppMarketEntryReason(
          entryDiagnostic,
          resolveFoundingShortfallReason({
            creditPath: foundingOutcome.creditPath,
            sizeBlocked: foundingOutcome.sizeBlocked,
            exceptionalShortageEntry,
          })
        );
      }
    } else {
      const foundingCost = toCorpLocal(EXPANSION_COST);
      const entryCapital =
        liquidCapital + (exceptionalShortageEntry ? (ctx.shortageEntryCreditLocal ?? 0) : 0);
      // Legacy (non-plants) founding has no per-unit quote; the observation
      // records the affordability facts with an explicit zero price.
      noteFoundingCapacityOutcome(foundingOutcome, {
        affordable: entryCapital - foundingCost >= effectiveCashFloor,
        creditPath: exceptionalShortageEntry && !isStateOwned(corp) && !corp.imfBailoutActive,
        sizeBlocked: false,
        quote: {
          unitPriceAnchor: 0,
          dominanceMultiplier: 1,
          requestedUnits: 0,
          cashHeadroomAnchor: cashToAnchor(entryCapital - foundingCost),
        },
      });
      if (foundingOutcome.affordable) {
        newSectors.push({
          stateId: foundingTarget.stateId,
          countryId: foundingTarget.countryId,
          sectorType: foundingTarget.sectorType,
          strategyId: foundingStrategyId,
          revenue: Math.round(foundingTarget.revenue * 0.25),
          profitMargin: 35,
        });
        cashLocal = entryCapital - foundingCost;
        foundingCashLocal = foundingCost;
        entryDiagnostic = setNppMarketEntryReason(entryDiagnostic, "entered");
      } else {
        if (foundingOutcome.creditPath) {
          shortageCreditRequest = {
            amountLocal: Math.max(0, foundingCost + effectiveCashFloor - entryCapital),
            sectorType: foundingTarget.sectorType as CorporationType,
          };
        }
        entryDiagnostic = setNppMarketEntryReason(
          entryDiagnostic,
          resolveFoundingShortfallReason({
            creditPath: foundingOutcome.creditPath,
            sizeBlocked: foundingOutcome.sizeBlocked,
            exceptionalShortageEntry,
          })
        );
      }
    }
  }

  // Frontier experiment slot accounting: every placement consumes one
  // cohort and one controller slot; experiment placements carry the trial
  // marker. See settleFrontierEntryPlacement.
  entryDiagnostic = settleFrontierEntryPlacement({
    turnState: ctx.frontierEntry,
    frontier,
    diagnostic: entryDiagnostic,
    corp,
    fallbackCandidate: entryCandidate,
    ordinaryEntry,
    exceptionalShortageEntry,
  });

  // One founding observation per corp per turn; gate evaluation lives in
  // capacityDecisionTelemetry.
  pushFoundingCapacityObservation(capacityObservations, {
    cohort: capacityCohort,
    competitorCount: entryCandidate
      ? rivalCount(entryCandidate.stateId, entryCandidate.sectorType)
      : 0,
    outcome: foundingOutcome,
    fallbackCashHeadroomAnchor: cashToAnchor(cashLocal - effectiveCashFloor),
    gates: {
      allowExpansion: levers.allowExpansion,
      isProfitable,
      corpMargin,
      minMargin: effectiveExpansionMinMargin,
      entryCandidate: entryCandidate
        ? { stateId: entryCandidate.stateId, sectorType: entryCandidate.sectorType }
        : null,
      hasLogisticsCapacity,
      marketEntryEligible,
      shortageEntryEligible: ctx.shortageEntryEligible === true,
      retailExpansionPaused: ctx.retailExpansionPaused === true,
      ordinaryEntryTargetGlutted,
      exceptionalShortageEntry,
      blockEntered: foundingBlockEntered,
      plantsEnabled: plants?.enabled === true,
      expansionPresent: expansion !== null,
      surplusCash,
      minCash: effectiveExpansionMinCash,
    },
  });

  // ── 6. Capacity reinvestment (plants only) ────────────────────────────────
  //
  // The replacement for the growth-target decision the AI lost under plants.
  // See the NPP_REINVEST_* constants block for the rule, the arithmetic and the
  // calibration. Non-plants worlds skip this block entirely and are byte-
  // identical to before.
  //
  // STATE-OWNED ENTERPRISES ARE EXCLUDED. Everything below is PRIVATE-SECTOR
  // machinery: it rations the build against the corp's own liquid cash
  // (`effectiveCashFloor`, `NPP_REINVEST_MAINTENANCE_CASH_SHARE`) because a
  // private corp's capex is funded out of retained earnings. An SOE's is not —
  // a state enterprise funds capacity from state channels, and its treasury
  // backstop deliberately covers only its OPERATING loss (see
  // `coverableSoeShortfallAnchor`; covering build orders was the P3b exploit).
  // Running an SOE through this path therefore charges it cash the state never
  // gave it and leaves it permanently insolvent. Its channels are instead:
  //   • command economies — the Gosbank directed-credit tranche, floored at one
  //     turn of depreciation replacement (`commandEconomyTurn`);
  //   • every other state-owned corp — the budgeted state capex grant from the
  //     owning treasury (`processSoeOperations`).
  // Note this is the CANONICAL `isStateOwned` reader, not `ownershipState`
  // alone: the seeded NatCorps and the command-economy national enterprises
  // carry `countryOwnerId` and no `ownershipState`, so the old local check saw
  // them as private.
  if (plants?.enabled && !isStateOwned(corp)) {
    // Shared-snapshot pool lookup; see reinvestCandidatePool.
    const poolFor = createReinvestPoolLookup(unownedByCountry);

    const candidates: ReinvestCandidate[] = [];
    // `plants` narrowing does not persist into the pool callback below.
    const plantsEraUnitScale = plants.eraUnitScale;
    // Observation for one evaluated reinvestment candidate; see
    // capacityDecisionTelemetry. `readCashLocal` tracks the running balance so
    // unpriced gates observe headroom as current cash.
    const { observe: observeReinvestCandidate, observePriced: observePricedReinvestCandidate } =
      createReinvestCapacityObserver({
        cohort: capacityCohort,
        competitorCountOf: rivalCount,
        cashToAnchor,
        readCashLocal: () => cashLocal,
        poolHeadroomOf: (sector) =>
          reinvestPoolHeadroomUnits(poolFor, sector, corp.countryId, plantsEraUnitScale),
        push: (observation) => capacityObservations.push(observation),
      });

    for (const sp of sectorProfits) {
      const sector = sp.sector;
      // Nothing built yet (a newborn founding, or a pre-flip sector still
      // awaiting its transition order): there is no capacity to maintain and no
      // fill telemetry to justify a build.
      const capitalStock = sector.capitalStock ?? 0;
      // Queue-array ceiling — see the constant for why this is not the
      // rationing dial.
      const queueDepth = sector.buildQueue?.length ?? 0;
      // (a) Is it selling what it makes? Persisted units telemetry only — no
      // telemetry means no evidence, and no evidence means no build.
      const produced = sector.producedUnits ?? 0;
      const sold = sector.soldUnits ?? 0;
      const fill = produced > 0 ? sold / produced : 0;
      // (b) Is there room in the market to absorb more output? Same unowned
      // pool the founding path sizes and draws against.
      const sectorCountryId = sector.countryId ?? corp.countryId;
      // Pre-sizing gates in precedence order; the first rejection is observed
      // for the capacity funnel instead of silently skipped.
      const preSizingGate = evaluateReinvestPreSizingGate({
        divested: divestedSectorIds.includes(sector._id),
        mothballed: sector.mothballed === true,
        no_capacity: !(capitalStock > 0),
        queue_full: queueDepth >= NPP_REINVEST_MAX_QUEUE_DEPTH,
        no_telemetry: !(produced > 0),
        fill_below_min: produced > 0 && fill < NPP_REINVEST_MIN_FILL,
        state_controlled: stateControlled.has(
          bucketKey(
            sector.stateId,
            sector.sectorType,
            sector.industryModel,
            sector.mediaDiscriminator
          )
        ),
        property_unavailable: !!sector.forSale || hasProtectedConstructionProperty(sector),
      });
      if (preSizingGate) {
        observeReinvestCandidate(preSizingGate, sector, capitalStock, null, 0, null);
        continue;
      }
      // ─── Headroom is a gate on GROWTH, never on REPLACEMENT ────────────────
      //
      // A bucket an incumbent already fills has ZERO unowned headroom by
      // construction, and nothing ever puts headroom back: depreciation
      // destroys owned capacity without returning it to the pool (see
      // `advanceCapitalStock` in sectorTurn — the stock shrinks, no pool write
      // follows). Gating the whole build on `headroomUnits > 0` therefore
      // blocked reinvestment in exactly the sectors that needed it, forever.
      //
      // Measured on the 96-turn A/B (`ab4_plants`, turn 135): 128 of 3,842 pool
      // rows sat at zero headroom, and those rows covered 391 of the 1,006
      // owned sectors — 237 of the 238 NPP sectors that passed every other gate
      // were refused here. That is the whole "zero builds in a 96-turn world".
      //
      // The split below is the accounting that makes both legs honest:
      //   • REPLACEMENT (δ) — buying back capacity that already existed in this
      //     market and wore out. World capacity is not increased, so it needs no
      //     headroom and draws nothing from the pool. It is the netted form of
      //     "depreciation frees headroom, the rebuild consumes it again".
      //   • GROWTH (g) — genuine new capacity. Headroom-gated, clamped to a
      //     quarter of the pool and drawn out of it, exactly as founding is.
      // It also matches the player path: `buildCapacity` (a top-up) is not
      // headroom-gated at all, while `expandSector` (an entry) draws the pool.
      const headroomUnits = reinvestPoolHeadroomUnits(
        poolFor,
        sector,
        corp.countryId,
        plants.eraUnitScale
      );

      // Sizing: replacement restores worn capacity; growth (below) is a
      // separate cash-and-demand decision that no longer reads targetGrowthRate.
      // fill = MIN_FILL ⇒ 0.5×, fill = 1 (sold out) ⇒ 1×. A sector that is only
      // just clearing its output gets a half-sized build, not zero: it still
      // has to replace what wore out.
      const fillScale =
        0.5 +
        0.5 *
          Math.min(1, Math.max(0, (fill - NPP_REINVEST_MIN_FILL) / (1 - NPP_REINVEST_MIN_FILL)));
      // Replacement is sized off the capacity the plant actually RUNS, not off
      // its nameplate. Under plants a sector's output is throughput- and
      // clearing-bound (measured median utilization 0.85 against 0.996 in the
      // capital arm), so the idle remainder is capacity the corp is already
      // paying IDLE_UPKEEP_FRACTION on for nothing — worth ~4.9 points of
      // margin at the A/B's median. Replacing the nameplate would buy that idle
      // share back every turn in perpetuity; replacing the RUN capacity lets it
      // depreciate away and the plant converges on the size it can actually
      // sell.
      const productionCapacity = sector.operatingCapacityUnits ?? capitalStock;
      const utilizationOfOwnedCapacity =
        productionCapacity > 0
          ? Math.max(0, Math.min(1, (sector.producedUnits ?? 0) / productionCapacity))
          : 0;
      const runUnits = capitalStock * utilizationOfOwnedCapacity;
      // ACCRUAL, not a per-turn slice. A build lands `CAPACITY_BUILD_TURNS`
      // turns after it is placed, and the queue ceiling can stop the corp
      // ordering for a stretch; sizing each order off the depreciation that has
      // accrued since the LAST order makes the capacity bought independent of
      // how often the corp got to order. Capped at one build cycle so a sector
      // that has never ordered (or whose queue just emptied after a long gap)
      // cannot place a giant catch-up build.
      const buildCycle = Math.max(1, CAPACITY_BUILD_TURNS(sector.sectorType));
      const lastOrderTurn = (sector.buildQueue ?? []).reduce(
        (latest, o) => (Number.isFinite(o.startTurn) ? Math.max(latest, o.startTurn) : latest),
        Number.NEGATIVE_INFINITY
      );
      const accrualTurns = Number.isFinite(lastOrderTurn)
        ? Math.min(buildCycle, Math.max(0, ctx.turn - lastOrderTurn))
        : 1;
      // Stranded-plant decay (supply-dislocation P1b): in a state whose own
      // market is deep-glut for this sector's outputs, replace only half of
      // what wears out. Full replacement held every misplaced plant at its
      // built size forever; half lets it shrink toward what its state can
      // absorb while a plant in a starved state replaces in full. Growth is
      // already state-tilted via targetGrowthRate (section 2a).
      const stateShortage = sectorShortageScore(
        sector.sectorType,
        sectorCountryId,
        (commodity, cid) =>
          placementSignals?.statePriceRatioOf?.(commodity, sector.stateId) ??
          priceRatioOf(commodity, cid)
      );
      const peakStateShortage = sectorPeakShortageScore(
        sector.sectorType,
        sectorCountryId,
        (commodity, cid) =>
          placementSignals?.statePriceRatioOf?.(commodity, sector.stateId) ??
          priceRatioOf(commodity, cid)
      );
      const criticalShortage = peakStateShortage >= ESSENTIAL_SHORTAGE_SCORE;
      const interventionPriority = fragileReinvestmentPriority(
        sector,
        sectorCountryId,
        placementSignals,
        priceRatioOf,
        ctx.turn
      );
      const strandedDecayScale = stateShortage <= 0.85 ? 0.5 : 1;
      const accruedReplacementUnits =
        runUnits *
        CAPITAL_DEPRECIATION_PER_TURN *
        accrualTurns *
        fillScale *
        strandedDecayScale *
        NPP_REINVEST_AGGRESSION;
      // Two pending builds already cover this plant's current investment
      // cadence. Do not fill the larger storage-only queue with a tiny
      // replacement order every turn: those orders occupied all 20 slots in
      // chronic shortages and prevented the meaningful growth leg from ever
      // reopening. Replacement accrual catches up when a slot lands.
      const replacementUnits =
        queueDepth >= NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH ? 0 : accruedReplacementUnits;
      // GROWTH — build from nothing, sized by cash and demand, exactly as a
      // player tops up a plant with `buildCapacity`. Demand-side sectors do not
      // use the unowned pool as a hard cap: their proven sell-through is the
      // demand signal and the affordability rail limits the order. Extraction
      // is different. Its physical market is the state's finite deposit, so the
      // deposit headroom signal gates and scales new growth. Without that second
      // gate a rare-earth price spike could make a mine keep adding capacity
      // after the state's geology was already exhausted; production was capped,
      // but the balance sheet and national sector mix kept inflating.
      const facilityUnits = foundingStarterUnits(
        sector.sectorType,
        sector.industryModel as "vehicles" | null | undefined,
        sector.mediaDiscriminator
      );
      const utilization = capitalStock > 0 ? runUnits / capitalStock : 0;
      const extractionHeadroom =
        sector.sectorType === "extraction"
          ? Math.max(0, Math.min(1, placementSignals?.extractionHeadroomOf?.(sector.stateId) ?? 1))
          : 1;
      const canGrow =
        (sp.isProfitable || criticalShortage) &&
        levers.allowGrowthCapex &&
        !(ctx.retailExpansionPaused && sector.sectorType === "retail") &&
        queueDepth < NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH &&
        stateShortage > NPP_GROWTH_MIN_SHORTAGE &&
        utilization >= NPP_GROWTH_MIN_UTILIZATION &&
        (sector.sectorType !== "extraction" || extractionHeadroom > 0);
      // Existing plants pay the same dominance-tolled list price as players.
      const growthShare =
        capitalStock > 0
          ? Math.min(100, (100 * capitalStock) / (capitalStock + Math.max(0, headroomUnits)))
          : 0;
      const perUnitGrowthLocal = canGrow
        ? toCorpLocal(
            computeBuildCost({
              sectorType: sector.sectorType,
              industryModel: sector.industryModel,
              mediaDiscriminator: sector.mediaDiscriminator,
              units: 1,
              strategyId: sector.strategyId ?? null,
              year: plants.year,
              eraUnitScale: plants.eraUnitScale,
              marketSharePercent: growthShare,
              nationalMarketSharePercent: nationalShare(
                sectorCountryId,
                sector.sectorType,
                sector.industryModel,
                sector.mediaDiscriminator
              ),
              primeRate: plants.primeRateOf(sectorCountryId),
              acumen: NEUTRAL_STAT,
              hostCostOfLivingIndex: plants.costOfLivingOf(sector.stateId),
              founding: false,
            }).totalAnchor
          )
        : 0;
      const growthBudgetLocal =
        Math.max(0, cashLocal - effectiveCashFloor) * NPP_GROWTH_DEPLOY_FRACTION;
      // Demand anchor: grow by at most this share of proven throughput a turn
      // (at least one facility for demand-side sectors), not the whole treasury
      // at once. Extraction growth is additionally scaled by finite deposit
      // headroom and never floors up to a facility when the deposit cannot
      // support one.
      const growthCapUnits =
        sector.sectorType === "extraction"
          ? Math.floor(runUnits * NPP_GROWTH_MAX_STEP_OF_RUN * extractionHeadroom)
          : Math.max(facilityUnits, Math.floor(runUnits * NPP_GROWTH_MAX_STEP_OF_RUN));
      // Units the growth budget affords, bounded by that step. Growth only fires
      // if it clears one whole facility — below that the plant just replaces
      // depreciation, so a cash-poor corp keeps its maintenance rather than
      // bundling an unaffordable growth leg that would sink the whole order past
      // the entry floor.
      const affordableGrowthUnits =
        canGrow && perUnitGrowthLocal > 0
          ? Math.floor(
              Math.min(
                growthBudgetLocal / perUnitGrowthLocal,
                growthCapUnits,
                MAX_BUILD_UNITS_PER_ORDER
              )
            )
          : 0;
      const growthUnits =
        affordableGrowthUnits >= facilityUnits && growthCapUnits >= facilityUnits
          ? affordableGrowthUnits
          : 0;
      const units = replacementUnits + growthUnits;
      if (!(units > 0)) {
        observeReinvestCandidate(
          "below_minimum_order",
          sector,
          capitalStock,
          headroomUnits,
          units,
          null
        );
        continue;
      }

      candidates.push({
        sector,
        units,
        growthUnits,
        fill,
        headroomUnits,
        interventionPriority,
      });
    }

    // The governed treatment first reallocates the existing build slot to a
    // critically short fragile market. Normal ranking then uses sell-through
    // and headroom, including the build size so replacement candidates differ.
    candidates.sort(
      (a, b) =>
        Number(b.interventionPriority > 0) - Number(a.interventionPriority > 0) ||
        b.interventionPriority - a.interventionPriority ||
        b.fill * (b.headroomUnits + b.units) - a.fill * (a.headroomUnits + a.units)
    );

    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= NPP_REINVEST_MAX_SECTORS_PER_TURN) break;
      const { sector, units } = candidate;

      // Price on the harsher of local footprint and national sector share.
      const capitalStock = sector.capitalStock ?? 0;
      const bucketTotal = capitalStock + candidate.headroomUnits;
      const marketSharePercent = bucketTotal > 0 ? (100 * capitalStock) / bucketTotal : 0;

      // Keep the breakdown for capacity-decision telemetry.
      const reinvestPrice = computeBuildCost({
        sectorType: sector.sectorType,
        industryModel: sector.industryModel,
        mediaDiscriminator: sector.mediaDiscriminator,
        units,
        strategyId: sector.strategyId ?? null,
        year: plants.year,
        eraUnitScale: plants.eraUnitScale,
        marketSharePercent,
        nationalMarketSharePercent: nationalShare(
          sector.countryId ?? corp.countryId,
          sector.sectorType,
          sector.industryModel,
          sector.mediaDiscriminator
        ),
        primeRate: plants.primeRateOf(sector.countryId ?? corp.countryId),
        // An NPP CEO is an NPP, not a Character — no Business Acumen to read.
        acumen: NEUTRAL_STAT,
        hostCostOfLivingIndex: plants.costOfLivingOf(sector.stateId),
        // NOT a founding build: this plant already exists, so the founding
        // discount does not apply. An NPP topping up capacity pays the same
        // list price a player pays through `buildCapacity`.
        founding: false,
      });
      const costAnchor = reinvestPrice.totalAnchor;
      const costLocal = toCorpLocal(costAnchor);

      // Affordability. Nobody builds free — this is also the SOE capex
      // discipline: a state enterprise pays cash for its builds like anyone
      // else, and the CIP it creates is what the remittance pass amortizes
      // (CAPEX_AMORTIZATION_PER_TURN) instead of being swept to the treasury.
      //
      // Two rails, because the two legs are different decisions. A build with a
      // GROWTH leg is a discretionary bet and faces the same entry floor the
      // founding path uses. A REPLACEMENT-ONLY build is maintenance, and is
      // rationed as a share of cash instead — see
      // NPP_REINVEST_MAINTENANCE_CASH_SHARE for why the entry floor applied to
      // maintenance is a death spiral rather than prudence.
      // A zero or negative charge is not a buildable quote: observe it as a
      // sizing rejection, the same outcome as sizing to non-positive units.
      if (!(costLocal > 0)) {
        observeReinvestCandidate(
          "below_minimum_order",
          sector,
          capitalStock,
          candidate.headroomUnits,
          units,
          null
        );
        continue;
      }
      const affordable =
        candidate.growthUnits > 0
          ? cashLocal - costLocal >= effectiveCashFloor
          : costLocal <= Math.max(0, cashLocal) * NPP_REINVEST_MAINTENANCE_CASH_SHARE &&
            cashLocal - costLocal > 0;
      const buildTurns = Math.max(1, CAPACITY_BUILD_TURNS(sector.sectorType));
      const order: SectorBuildOrder = {
        unitsOrdered: units,
        strategyId: sector.strategyId ?? null,
        costPaidAnchor: costAnchor,
        startTurn: ctx.turn,
        onlineTurn: ctx.turn + buildTurns,
        smooth: true,
      };
      if (!affordable) {
        const cashContributionLimitLocal =
          candidate.growthUnits > 0
            ? Math.max(0, cashLocal - effectiveCashFloor)
            : Math.max(0, Math.min(cashLocal, cashLocal * NPP_REINVEST_MAINTENANCE_CASH_SHARE));
        constructionFinanceIntents.push({
          sector,
          order,
          costLocal,
          cashContributionLimitLocal,
          growthUnits: candidate.growthUnits,
          priority: candidate.interventionPriority,
          fill: candidate.fill,
        });
        observePricedReinvestCandidate(
          "insufficient_cash",
          sector,
          capitalStock,
          candidate.headroomUnits,
          units,
          costAnchor,
          reinvestPrice.dominanceMultiplier,
          cashToAnchor(cashLocal - costLocal)
        );
        continue;
      }

      // ─── The queue write is a DELTA, never a whole-array `$set` ───────────
      //
      // `sector.buildQueue` is a snapshot read at the top of this turn phase.
      // A `$set` of the recomputed array would land AFTER `sectorTurn`'s own
      // `$pull` of the orders that completed this turn (bulkWrite is ordered,
      // and the NPP ops are appended last), resurrecting every landed order —
      // the capacity would be delivered again on the next tick. It would also
      // erase any order a player CEO placed during the phase. `$push` touches
      // only what this decision actually owns, and composes with both.
      // Same rule, same reason as `sectorTurn`'s C4 note.
      sectorUpdates.push({
        filter: {
          _id: sector._id,
          corporationId: corp._id,
          ...unprotectedConstructionPropertyFilter(),
        },
        update: {
          $set: { updatedAt: now },
          $push: { buildQueue: order },
        },
      });
      // Growth builds from nothing — a plant top-up does not draw the unowned
      // pool, exactly as a player's `buildCapacity` does not. The pool is not a
      // finite budget builds are rationed against; capacity is created by paying
      // for it. (Market share stays well-defined: owned capacity rises, so the
      // owner's share of owned+headroom rises, without touching the pool.)
      cashLocal -= costLocal;
      reinvestments.push({
        sectorId: sector._id,
        sectorType: sector.sectorType,
        units,
        costAnchor,
        costLocal,
        onlineTurn: order.onlineTurn,
      });
      // Observed after the spend: headroom is cash after the charged cost,
      // the same post-cost headroom the player path records.
      observePricedReinvestCandidate(
        "placed",
        sector,
        capitalStock,
        candidate.headroomUnits,
        units,
        costAnchor,
        reinvestPrice.dominanceMultiplier,
        cashToAnchor(cashLocal)
      );
      placed += 1;
    }
  }

  // Expansion and shareholder returns can coexist. The build paths above have
  // already paid capex and preserved the effective cash floor; forcing the
  // dividend rate to zero here made continuously-growing NPP corporations
  // retain every future profitable turn as well. The margin-based rate from
  // section 4 applies only to positive after-tax income at settlement time, so
  // it cannot spend the operating reserve or distribute a loss.

  return {
    corpId: corp._id,
    updates,
    // Ticket #1260: the cash leg travels as a DELTA, never as an absolute write.
    // These ops are appended to the corporation bulkWrite AFTER this turn's
    // income `$inc`, so a `$set` of the balance overwrote the credit and the
    // whole turn's operating income vanished. `cashLocal` starts at the opening
    // `liquidCapital` and every path above adjusts it — a market-entry credit
    // up, a founding cost or growth capex down — so this one subtraction is the
    // net movement whichever path ran. See `nppCashWrite.ts`.
    liquidCapitalDelta: cashLocal - liquidCapital,
    ...(foundingCashLocal === undefined ? {} : { foundingCashLocal }),
    cashFloorLocal: effectiveCashFloor,
    sectorUpdates,
    newSectors: newSectors.length > 0 ? newSectors : undefined,
    divestedSectorIds: divestedSectorIds.length > 0 ? divestedSectorIds : undefined,
    unownedDraws: unownedDraws.length > 0 ? unownedDraws : undefined,
    reinvestments: reinvestments.length > 0 ? reinvestments : undefined,
    constructionFinanceIntents:
      constructionFinanceIntents.length > 0 ? constructionFinanceIntents : undefined,
    shortageCreditRequest,
    entryDiagnostic,
    strategy: strategyDecision?.state,
    capacityObservations,
    operatorObservation: buildNppOperatorObservation({
      sectorType: operatingCorpType,
      cashNegative: cashLocal < 0,
      passive: false,
      profitable: isProfitable,
      marginPct: corpMargin,
      cashCrisis: isCashCrisis,
      entryReason: entryDiagnostic?.reason,
      dividendRate: targetDividendRate,
      divestedSectors: divestedSectorIds.length,
      reinvestments: reinvestments.length,
      cashHeadroomAnchor: cashToAnchor(cashLocal - effectiveCashFloor),
      constraintFlags,
    }),
  };
}
