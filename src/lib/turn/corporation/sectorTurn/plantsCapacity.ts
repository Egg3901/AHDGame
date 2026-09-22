/**
 * Plants capacity advance and the P5 paid basis of capacity (#588).
 *
 * Pure computation split out of processSector. Plants tier: capacity is
 * AUTHORITATIVE, not a haircut. The first plants turn adopts
 * capacity := max(existing capitalStock, impliedOutputUnits(nameplate)) so a
 * sector arriving from capital mode keeps the capital it built; capacity then
 * only DEPRECIATES here (the growth slider no longer builds it, build orders
 * arrive in P3). The paid basis tracks (book + landed cash) scaled by the
 * same depreciation factor the stock takes, so the per-unit basis stays flat
 * under depreciation. No reads or writes here, only the turn inputs.
 */
import { activeCapacityFraction } from "@/lib/corporations/investment/rules";
import { getStrategy } from "@/lib/constants/sectorStrategies";
import { seedCapitalStock } from "@/lib/market/capital";
import { unitYieldForSupply } from "@/lib/constants/capacityEconomy";
import type { CorporationType } from "@/lib/constants/corporations";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import type { CorporateSector, Corporation } from "@/lib/db/types";
import { advanceCapitalStock } from "@/lib/market/capital";
import { advanceSectorPlantLedger } from "@/lib/corporations/plantLedger";
import { healRetoolStockBasis, type RetoolStockBasisHeal } from "@/lib/corporations/retoolRescale";
import {
  retoolOperatingCapacityRatio,
  retoolMeasurementRatio,
} from "@/lib/corporations/retooling/rules";
import type { CorporationLookups } from "../types";

export interface PlantsCapacityInput {
  sector: Pick<
    CorporateSector,
    | "capitalStock"
    | "mothballed"
    | "activeCapacityPercent"
    | "capacityBookAnchor"
    | "plantsStartTurn"
    | "transitionFromStrategyId"
    | "strategyId"
    | "sectorType"
    | "transitionStartTurn"
    | "retoolRescaleApplied"
    | "operatingCapacityTurn"
    | "autoStrategyAdoptedAtTurn"
    | "otherOpexPerUnitAnchor"
  >;
  corp: Pick<Corporation, "ceoType">;
  plantsEnabled: boolean;
  isFlipTurn: boolean;
  preFlipNameplateRevenue: number;
  strategySupply: Partial<Record<CommodityType, number>> | undefined;
  eraUnitScale: CorporationLookups["eraUnitScale"];
  landedBuildUnits: number;
  landedBuildCostAnchor: number;
  capacityUnitPriceAnchor: number;
  /** Legacy revenue base; the fallback nameplate outside priced mixes. */
  newRevenue: number;
  currentTurn: number;
  governorRampTurns: number;
  embargoLegacyMothball: boolean;
}

export interface PlantsCapacityResult {
  /** D12: a mothballed sector's plants are cold. */
  mothballed: boolean;
  activeFraction: number;
  plantsBaseStock: number;
  plantLedger: ReturnType<typeof advanceSectorPlantLedger> | null;
  plantsPrevStock: number;
  plantsOwnedCapacity: number;
  plantsCapacityDepreciationFactor: number;
  priorCapacityBookAnchor: number;
  capacityBookAnchor: number;
  plantsMixPriceYield: number;
  plantsMixPrice: number;
  storedOtherOpexAnchor: number | null;
  healedOpex: RetoolStockBasisHeal | null;
  retoolCapacityRatio: number;
  priorProductionUnitRatio: number;
  plantsCapacity: number;
  plantsNameplateRevenue: number;
  plantsStartTurn: number | undefined | null;
  /**
   * THE plants transition ramp, λ ∈ [0, 1]. 0 on the flip turn, reaching 1
   * over `governorRampTurns`. SINGLE SOURCE OF TRUTH for the plants ramp —
   * every P3a leg that CHANGES a sector's steady-state economics fades in on
   * this, or the flip turn is not a no-op.
   */
  plantsRampLambda: number;
}

export function computePlantsCapacity(input: PlantsCapacityInput): PlantsCapacityResult {
  const {
    sector,
    corp,
    plantsEnabled,
    isFlipTurn,
    preFlipNameplateRevenue,
    strategySupply,
    eraUnitScale,
    landedBuildUnits,
    landedBuildCostAnchor,
    capacityUnitPriceAnchor,
    newRevenue,
    currentTurn,
    governorRampTurns,
    embargoLegacyMothball,
  } = input;

  // In-flight auto-retools historically rescaled capitalStock but left the
  // per-unit residual on the old unit basis. Worse, transitions committed
  // before the rescale existed (or under capital mode, where the RPU basis
  // does not apply) surface under plants with source-basis stock and no
  // (or explicitly false) rescale flag: stamping the flag there without
  // converting the stock lets the blend ratio manufacture unsupported
  // operating capacity (issue #2009 - 2,314.82 source units x ~390 blend =
  // 903,166 operating units on an oil_gas to rare_earth_mining retool).
  // Heal on the next sector-turn write while transitionFromStrategyId
  // evidence remains; no mongo script.
  const storedOtherOpexAnchor =
    typeof sector.otherOpexPerUnitAnchor === "number" &&
    Number.isFinite(sector.otherOpexPerUnitAnchor)
      ? sector.otherOpexPerUnitAnchor
      : null;
  const healedOpex = healRetoolStockBasis({
    plantsEnabled: plantsEnabled && !embargoLegacyMothball,
    isAutoRetool: corp.ceoType === "npp" || sector.autoStrategyAdoptedAtTurn != null,
    sectorType: sector.sectorType as CorporationType,
    strategyId: sector.strategyId,
    transitionFromStrategyId: sector.transitionFromStrategyId,
    transitionStartTurn: sector.transitionStartTurn,
    plantsStartTurn: sector.plantsStartTurn,
    retoolRescaleApplied: sector.retoolRescaleApplied,
    capitalStock:
      typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
        ? sector.capitalStock
        : undefined,
    otherOpexPerUnitAnchor: storedOtherOpexAnchor ?? undefined,
  });
  // The capacity the advance starts from is on the destination basis: either
  // it was converted at the retool boundary, or the heal above converted it
  // just now. Running the advance off unconverted stock is what mints the
  // unsupported capacity, so the working stock - not just the stamp - moves.
  const storedCapacity =
    typeof sector.capitalStock === "number" && sector.capitalStock > 0 ? sector.capitalStock : 0;
  const workingCapacity =
    healedOpex?.capitalStock != null ? Math.max(0, healedOpex.capitalStock) : storedCapacity;
  const retoolBasis = {
    sectorType: sector.sectorType,
    strategyId: sector.strategyId,
    transitionFromStrategyId: sector.transitionFromStrategyId,
    transitionStartTurn: sector.transitionStartTurn,
    retoolRescaleApplied: healedOpex?.retoolRescaleApplied ?? sector.retoolRescaleApplied,
    operatingCapacityTurn: sector.operatingCapacityTurn,
    currentTurn,
  };
  const retoolCapacityRatio = plantsEnabled ? retoolOperatingCapacityRatio(retoolBasis) : 1;
  // Flip seed basis: owned stock converts to destination units at the retool
  // boundary, so the seed arm must be destination-basis too while the blend
  // ratio applies. Seeding from the blended recipe mixes bases in the max():
  // the blended count can exceed the converted count and mint capacity the
  // sector never built (measured ~2% on a manufacturing standard to premium
  // flip, far more on extreme pairs). Off-transition the blended recipe is
  // the destination recipe, so this is a no-op there.
  const flipSeedSupply =
    isFlipTurn && retoolCapacityRatio !== 1 && sector.transitionFromStrategyId
      ? (getStrategy(sector.sectorType, sector.strategyId ?? "standard").supply ?? strategySupply)
      : strategySupply;

  // D12: a mothballed sector's plants are cold — they produce nothing, offer
  // nothing (its persisted `producedUnits` is what the clearing pre-pass reads
  // as its offer under plants, so 0 produced ⇒ 0 offered, automatically), and
  // pay only MOTHBALL_UPKEEP_FRACTION of running maintenance.
  const mothballed = plantsEnabled && sector.mothballed === true;
  const activeFraction = plantsEnabled ? activeCapacityFraction(sector) : 1;
  // The capacity the advance starts from, hoisted out of the `advanceCapitalStock`
  // call below so the P5 book basis can be scaled by exactly the same
  // depreciation factor the stock takes. See the long comment inside the call.
  const plantsBaseStock = plantsEnabled
    ? isFlipTurn
      ? Math.max(
          workingCapacity,
          seedCapitalStock(
            preFlipNameplateRevenue,
            flipSeedSupply ?? {},
            COMMODITY_BASE_PRICES,
            eraUnitScale
          )
        )
      : workingCapacity
    : 0;
  const plantLedger = plantsEnabled
    ? advanceSectorPlantLedger(sector, plantsBaseStock, landedBuildUnits)
    : null;
  const plantsPrevStock = plantsBaseStock + landedBuildUnits;
  const plantsOwnedCapacity = plantsEnabled
    ? advanceCapitalStock({
        // The max() is a ONE-TIME migration, keyed off the absent ramp anchor.
        // Applying it every turn would re-lift capacity back to whatever the
        // current revenue implies, which is exactly the compounding-nameplate
        // behaviour plants removes — and would silently cancel depreciation.
        //
        // CAPITAL_SEED_HEADROOM on the nameplate arm ONLY: capital-mode seeding
        // (seedCapitalStock) gives a sector 1.1x its implied units so it starts
        // with slack rather than pinned at 100% utilization. Without the same
        // factor here, any sector created AFTER the flip was born at exactly
        // 100% utilization and began depreciating on turn one, while an
        // otherwise identical sector that predated the flip carried slack — the
        // sector's economics depended on which side of the flip it was created.
        // `storedCapacity` is deliberately NOT scaled: a real stored capitalStock
        // already contains its own headroom history (it was seeded with 1.1x and
        // has depreciated/invested since), so re-applying the factor would
        // silently gift capacity on every flip.
        //
        // P3a: capacity delivered by build orders that came online this turn is
        // added BEFORE the advance, so a landed plant produces the turn it
        // lands (and takes that turn's depreciation like every other unit - a
        // ~0.05% haircut, not worth a special case).
        // `seedCapitalStock` IS `impliedOutputUnits(...) x CAPITAL_SEED_HEADROOM`
        // - the same expression the capital-mode seeding arm above uses. The two
        // seeding paths must agree or a sector's capacity changes depending on
        // which tier it was born in. Hoisted to `plantsBaseStock` above.
        prevStock: plantsPrevStock,
        currentGrowthRate: 0,
      })
    : 0;
  // ─── P5: the PAID BASIS of that capacity ──────────────────────────────────
  //
  //   book_next = (book_prev + cash of the orders that just landed) × (the same
  //               depreciation factor the stock just took)
  //
  // Scaling by the stock's own factor is what keeps the PER-UNIT basis flat
  // under depreciation: units and the cash that bought them fall off together,
  // so a plant half worn out books at half what was paid for it — never at half
  // the LIST price, which is the mint this closes.
  //
  // The seed for a sector with no recorded basis is the list value of the stock
  // it starts the turn with. Pre-plants capacity was bought through the legacy
  // growth stack at exactly `capacityPricePerUnit` (identity B), so those units
  // really did cost list; it is only the P3a build path's discounts that make
  // list wrong going forward. This is also the same number
  // `sectorCapacityBookAnchor`'s fallback returns, so the stamp is a no-op for
  // valuation on the turn it happens.
  //
  // Capacity granted for free (an R&D breakthrough, a world grant, an
  // autoSectorSeed multiplier) adds units without adding cash, so it DILUTES
  // the per-unit basis. That is deliberate: free capacity has no paid basis,
  // and must not be exitable for cash it never cost.
  const plantsCapacityDepreciationFactor =
    plantsPrevStock > 0 ? plantsOwnedCapacity / plantsPrevStock : 1;
  const priorCapacityBookAnchor =
    typeof sector.capacityBookAnchor === "number" &&
    Number.isFinite(sector.capacityBookAnchor) &&
    sector.capacityBookAnchor >= 0
      ? sector.capacityBookAnchor
      : plantsBaseStock * capacityUnitPriceAnchor;
  const capacityBookAnchor = plantsEnabled
    ? Math.max(
        0,
        (priorCapacityBookAnchor + landedBuildCostAnchor) * plantsCapacityDepreciationFactor
      )
    : 0;
  // Price per output unit of the sector's mix — the inverse of the Σ rate/base
  // term impliedOutputUnits applies, so `units × mixPrice` recovers the revenue
  // those units imply. 0 only for a sector whose output mix genuinely prices to
  // nothing (no output commodity with a positive rate AND a positive base).
  //
  // Derived from unit yield, not `revenue / nameplateUnits`: that ratio is the
  // same number whenever revenue > 0, but 0/0 at a founding sector (capitalStock
  // 0 plus a starter build) is an absorbing zero. Yield is scale-free, so it
  // matches the positive-revenue case and keeps working at revenue 0.
  const plantsMixPriceYield = plantsEnabled
    ? unitYieldForSupply(strategySupply ?? {}, eraUnitScale)
    : 0;
  const plantsMixPrice = plantsMixPriceYield > 0 ? 1 / plantsMixPriceYield : 0;
  const plantsCapacity = plantsOwnedCapacity * retoolCapacityRatio;
  const priorProductionUnitRatio = plantsEnabled ? retoolMeasurementRatio(retoolBasis) : 1;
  // The nameplate plants writes back to `sector.revenue`: what the OWNED
  // capacity is worth at mix prices. This keeps `revenue` a potential/nameplate
  // figure (exactly as every other mode treats it) while making capacity — not
  // last turn's compounding — the only thing that moves it.
  //
  // It must NOT be the realized figure. `sector.revenue` is re-read as next
  // turn's `sectorRevenueAnchor` AND is the base the commodity supply ledger
  // derives world supply from (computeRawSupplyDemand: revenue × rate / base).
  // Persisting realized revenue would multiply the anchor by every realization
  // leg once per turn, compounding them: a sector running at a steady 0.93
  // price realization loses ~7%/turn of its base for as long as the mode is on
  // (measured: −94% over 50 turns with flat capacity and flat produced units),
  // dragging world commodity supply down with it. Capacity-implied revenue is
  // invariant under that feedback because `plantsMixPrice` is 1/Σ(rate/base),
  // independent of the revenue it was measured from.
  //
  // Sectors with no priced output mix (nameplateUnits 0 ⇒ mixPrice 0) have no
  // capacity to price, so they hold the un-compounded anchor instead of being
  // zeroed.
  //
  // Owned stock stays on the destination strategy basis. Temporary operating
  // capacity uses the blended recipe, so capacity times mix price retains the
  // same nameplate throughout a retool. Neither basis is quantized.
  const plantsNameplateRevenue =
    plantsEnabled && plantsMixPrice > 0 ? plantsCapacity * plantsMixPrice : newRevenue;
  // Governor ramp anchor: stamped on the sector's FIRST plants turn and never
  // moved, mirroring clearingStartTurn.
  const plantsStartTurn = plantsEnabled
    ? (sector.plantsStartTurn ?? currentTurn)
    : sector.plantsStartTurn;
  const plantsRampLambda =
    !plantsEnabled || plantsStartTurn == null || governorRampTurns <= 0
      ? 1
      : Math.max(0, Math.min(1, (currentTurn - plantsStartTurn) / governorRampTurns));
  return {
    mothballed,
    activeFraction,
    plantsBaseStock,
    plantLedger,
    plantsPrevStock,
    plantsOwnedCapacity,
    plantsCapacityDepreciationFactor,
    priorCapacityBookAnchor,
    capacityBookAnchor,
    plantsMixPriceYield,
    plantsMixPrice,
    storedOtherOpexAnchor,
    healedOpex,
    retoolCapacityRatio,
    priorProductionUnitRatio,
    plantsCapacity,
    plantsNameplateRevenue,
    plantsStartTurn,
    plantsRampLambda,
  };
}
