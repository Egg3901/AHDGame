/**
 * Growth/regulatory cost legs and the P3.5 physical cost decomposition (#588).
 *
 * Pure computation split out of processSector. Growth cost is charged on
 * REALIZED revenue (scaling by the realization ratio), not the nominal book.
 * The dominance regulatory burden is the revenue-side twin of the dominance
 * margin penalty and fades out on the plants ramp for the same reason.
 * Under plants the margin-formula maintenance is rebuilt out of physical
 * lines (inputs, labour, upkeep, compliance, other opex, financial legs)
 * calibrated to reproduce maintenance exactly on the first producing turn,
 * with the policy stack riding a single revenue-proportional credit line.
 * No reads or writes here, only the turn inputs.
 */
import {
  softCapEffectiveMargin,
  getDominanceRegulatoryBurden,
  getNationalDominanceRegulatoryBurden,
  TURNS_PER_DAY,
  NPV_ANNUAL_DISCOUNT_RATE,
} from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { getInputMultiplier } from "@/lib/utils/productionPolicy";
import { advanceCapitalBookAnchor } from "@/lib/market/capital";
import {
  assemblePhysicalPnl,
  computeFinancialLegs,
  computeInputsCost,
  otherOpexDriftFactor,
  solveOtherOpexPerUnit,
} from "@/lib/corporations/physicalPnl";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import type { Corporation } from "@/lib/db/types";
import type { CorporationLookups } from "../types";

export interface GrowthRegulatoryInput {
  corp: Pick<Corporation, "countryOwnerId" | "ownershipState" | "_id">;
  newGrowthCost: number;
  preFlipNameplateRevenue: number;
  hourlyRevenue: number;
  sectorMarketSharePct: number;
  nationalDominanceSharePct: number;
  dominanceShield: number;
  plantsEnabled: boolean;
  plantsRampLambda: number;
}

export interface GrowthRegulatoryResult {
  hourlyGrowthCost: number;
  realizationRatio: number;
  regulatoryBurdenRate: number;
  regulatoryBurden: number;
}

export function computeGrowthAndRegulatory(input: GrowthRegulatoryInput): GrowthRegulatoryResult {
  const {
    corp,
    newGrowthCost,
    preFlipNameplateRevenue,
    hourlyRevenue,
    sectorMarketSharePct,
    nationalDominanceSharePct,
    dominanceShield,
    plantsEnabled,
    plantsRampLambda,
  } = input;

  // Growth cost must be charged on the revenue the sector ACTUALLY realises, not
  // on its nominal book revenue.
  //
  // `newGrowthCost` is derived from raw `newRevenue`, while `hourlyRevenue` is
  // that same figure after seven realisation factors (capacity haircut, price
  // realisation, clearing, throughput, capital utilisation, strike throttle,
  // embargo). Measured on the completed 1000-turn run, realisation averaged
  // 0.417 while growth cost ran at 0.246 of nominal revenue — so expansion
  // consumed 59% of the income it was paid from, and NO firm could stay solvent
  // regardless of margin. It is the single largest driver of the corporate
  // collapse (432 firms to 88, 89% loss-making).
  //
  // Scaling by the realisation ratio keeps the economics honest in both
  // directions: a firm that cannot sell its output also is not billed as though
  // it had, but a badly-run firm still fails, because its realised revenue is
  // genuinely low.
  const nominalHourlyRevenue = preFlipNameplateRevenue / TURNS_PER_DAY;
  const realizationRatio =
    nominalHourlyRevenue > 0 ? Math.max(0, Math.min(1, hourlyRevenue / nominalHourlyRevenue)) : 1;
  const hourlyGrowthCost = (newGrowthCost / TURNS_PER_DAY) * realizationRatio;
  // Dominance regulatory burden: passive revenue tax on dominant sectors
  // (compliance, antitrust legal, lobbying). Deducted before profit so it
  // hits both yearly profit (→ sectorNPV) and corp earnings.
  // Revenue-side twin of the dominance margin penalty — same SOE exemption.
  // P3a scoped touch #2b — the revenue-side twin of the margin penalty above,
  // gated off for the same reason (dominance is tolled once, at build time).
  // See `computeBuildCost` for the design; SOEs stay exempt in every mode.
  const regulatoryBurdenRate = isStateOwned(corp)
    ? 0
    : Math.max(
        getDominanceRegulatoryBurden(sectorMarketSharePct),
        getNationalDominanceRegulatoryBurden(nationalDominanceSharePct)
      ) *
      (1 - dominanceShield) *
      (plantsEnabled ? 1 - plantsRampLambda : 1);
  const regulatoryBurden = hourlyRevenue * regulatoryBurdenRate;

  return { hourlyGrowthCost, realizationRatio, regulatoryBurdenRate, regulatoryBurden };
}

export interface PhysicalCostsInput {
  plantsEnabled: boolean;
  embargoLegacyMothball: boolean;
  profitMargin: number;
  totalMarginMod: number;
  commodityMod: number;
  surplusMod: number;
  disasterMarginMod: number;
  nationalizedMarginPenalty: number;
  hourlyRevenue: number;
  maintenance: number;
  sectorLaborCost: number;
  plantsUpkeepCost: number;
  regulatoryBurden: number;
  hourlyGrowthCost: number;
  plantsNameplateRevenue: number;
  effectiveDemand: Partial<Record<CommodityType, number>> | undefined;
  sectorCountryId: string;
  priceRatioByCommodity: CorporationLookups["priceRatioByCommodity"];
  reachableInputPriceRatiosByCountry: CorporationLookups["reachableInputPriceRatiosByCountry"];
  plantsCapacity: number;
  producedUnits: number;
  retoolCapacityRatio: number;
  newPolicyLevel: number;
  mothballed: boolean;
  stateId: string;
  landedPremiumByState: CorporationLookups["landedPremiumByState"];
  storedOtherOpexAnchor: number | null;
  healedOtherOpexPerUnitAnchor: number | undefined;
  otherOpexAnchorMarginBasis: number | null | undefined;
  capitalEnabled: boolean;
  prevCapitalBookAnchor: number | undefined;
  /**
   * Phased stock-market boost multiplier on the going-concern NPV
   * (`sectorNpvBoostMultiplier(currentTurn)`). Defaults to 1 = legacy.
   * Applies to the earnings-derived NPV only, never to the paid-basis book
   * anchor, which must keep settling exits at cash actually spent.
   */
  npvBoostMultiplier?: number;
}

export interface PhysicalCostsResult {
  plantsPhysicalEnabled: boolean;
  plantsPolicyPpRaw: number;
  plantsPolicyPp: number;
  plantsPolicyNeutralBasis: number;
  plantsPolicyCredit: number;
  inputsCost: number;
  financialLegs: number;
  otherOpexCalibrated: boolean;
  solvedOtherOpexPerUnit: number | null;
  otherOpex: number;
  physicalPnl: ReturnType<typeof assemblePhysicalPnl> | null;
  hourlyProfit: number;
  yearlyProfit: number;
  sectorNPV: number;
  capitalBookAnchor: number;
}

export function decomposePhysicalCosts(input: PhysicalCostsInput): PhysicalCostsResult {
  const {
    plantsEnabled,
    embargoLegacyMothball,
    profitMargin,
    totalMarginMod,
    commodityMod,
    surplusMod,
    disasterMarginMod,
    nationalizedMarginPenalty,
    hourlyRevenue,
    maintenance,
    sectorLaborCost,
    plantsUpkeepCost,
    regulatoryBurden,
    hourlyGrowthCost,
    plantsNameplateRevenue,
    effectiveDemand,
    sectorCountryId,
    priceRatioByCommodity,
    reachableInputPriceRatiosByCountry,
    plantsCapacity,
    producedUnits,
    retoolCapacityRatio,
    newPolicyLevel,
    mothballed,
    stateId,
    landedPremiumByState,
    storedOtherOpexAnchor,
    healedOtherOpexPerUnitAnchor,
    otherOpexAnchorMarginBasis,
    capitalEnabled,
    prevCapitalBookAnchor,
    npvBoostMultiplier = 1,
  } = input;

  // ─── P3.5: physical cost decomposition (plants only) ──────────────────────
  //
  // `maintenance` above is the margin formula: revenue × (1 − margin/100). It
  // says nothing about what the plant buys, so a sector's cost cannot move with
  // the price of its inputs. Under plants the cost stack is rebuilt out of
  // physical lines instead — see `@/lib/corporations/physicalPnl` for the full
  // rationale and the calibration identity.
  //
  // DISPOSITION of the old margin-modifier stack under plants:
  //  • commodity INPUT modifier  → DELETED, replaced by `inputsCost` (the real
  //    bill). Keeping both would double-count the same condition.
  //  • commodity SURPLUS modifier → DELETED outright. Clearing and price
  //    realization already price a glut on the REVENUE side; the modifier was
  //    the original double-count this wave exists to remove.
  //  • disaster margin penalty  → financial leg, ₳ passthrough (a flood does
  //    not change the price of steel; it imposes a loss). Consumed here as an
  //    input; the disaster files themselves are another wave's territory.
  //  • tech `inputCost` effects → already scale `effectiveDemand`, so they now
  //    reduce UNITS BOUGHT rather than granting margin.
  //  • tech `laborCostReduction` → already the labor wage multiplier.
  //  • tech `growthCostReduction` → already its own line.
  //  • tech `marginBonus` (+ strategy-transition penalty, subsidies, tariffs,
  //    macro, state metrics, home location, sprawl, SOE efficiency, …) → these
  //    are not claims about physical consumption, so they ride ONE named
  //    channel: `policyCredit`, a revenue-proportional P&L line
  //    (`hourlyRevenue × pp/100`, soft-capped with the same discipline as the
  //    legacy margin). They previously rode the drift factor on the calibrated
  //    residual, which INVERTED whenever the residual anchor was negative (a
  //    bonus shrank the credit and raised cost — live on 82% of prod sectors
  //    when found). A revenue leg is monotone in the modifier by construction.
  //    The residual anchor is now held at its policy-NEUTRAL basis and no
  //    longer responds to the modifier stack; legacy anchors are rebased onto
  //    that basis through the drift ratio itself (see `otherOpexDriftFactor`).
  //  • dominance → already consolidated to the build price in P3a.
  //
  // KNOWN RESIDUALS (deliberate, documented, not silently dropped): the labor
  // carve-out's clamp basis and the P3a idle-upkeep unit price still read the
  // full margin-formula margin. Both are prior waves' lines and both are
  // second-order; moving them is a follow-up, not a flip-day change.
  const plantsPhysicalEnabled = plantsEnabled && !embargoLegacyMothball;
  // The margin stack MINUS the modifiers the physical model now owns
  // (commodity input → `inputsCost`, surplus → deleted, disaster → financial
  // leg). This is the POLICY stack: everything that is a claim about policy,
  // tech or environment rather than physical consumption.
  const plantsPolicyPpRaw =
    totalMarginMod - commodityMod - surplusMod - disasterMarginMod + nationalizedMarginPenalty;
  // Same cap discipline as the legacy margin path (`effectiveMargin` above):
  // soft-capped against the base margin so a stacked pile asymptotes instead
  // of pinning. The old residual basis used a hard `Math.min(100, …)` here —
  // a second, different cap on the same stack; unified now.
  const plantsPolicyPp = softCapEffectiveMargin(profitMargin + plantsPolicyPpRaw) - profitMargin;
  // The residual's basis with NO policy stack in it. Constant per sector (the
  // base margin is a seed constant), so the anchor no longer responds to
  // modifiers — the `policyCredit` line below is the only carrier.
  const plantsPolicyNeutralBasis = 1 - profitMargin / 100;
  // The policy stack as money: ₳/turn credit (negative = charge). Enters the
  // P&L as a named line, NOT via `hourlyRevenue` itself, so world ledgers,
  // revenue-share taxes and the launch governor see unmodified revenue.
  const plantsPolicyCredit = plantsPhysicalEnabled ? (hourlyRevenue * plantsPolicyPp) / 100 : 0;
  const inputsCostResult = plantsPhysicalEnabled
    ? computeInputsCost({
        // The recipe rates are expressed against the sector's NOMINAL nameplate,
        // and `plantsNameplateRevenue` is capacity × mixPrice — so multiplying
        // by utilization below gives producedUnits × mixPrice, i.e. inputs are
        // bought for what the plant actually made, and `producedUnits` already
        // carries the physical-disaster haircut, so a halted plant buys less.
        // Matches the units the world ledger books as this sector's demand
        // (`computeRawSupplyDemand`) up to four audited divergences — see the
        // list on `computeInputsCost`; all four are level effects the
        // calibration solve absorbs.
        nominalDailyRevenue: plantsNameplateRevenue,
        rates: effectiveDemand ?? {},
        basePrices: COMMODITY_BASE_PRICES,
        // Partition worlds: inputs are BOUGHT in the sector country's
        // reachable market, so they are billed at its price level. The world
        // map stays the fallback for countries/commodities without a book —
        // `reachableInputPriceRatios` overlays reachable ratios on the world
        // map per country, so absent entries fall back to world, not to base.
        priceRatios:
          reachableInputPriceRatiosByCountry?.get(sectorCountryId) ?? priceRatioByCommodity,
        utilization: plantsCapacity > 0 ? producedUnits / plantsCapacity : 1,
        inputMultiplier: getInputMultiplier(newPolicyLevel),
        turnsPerDay: TURNS_PER_DAY,
        mothballed,
        // Money wiring (step 5, phase A): empty map when the flag is off, so
        // this is a no-op until interstateMoneyWiringEnabled is flipped on.
        statePremiums: landedPremiumByState?.get(stateId),
      })
    : { total: 0, lines: [] };
  const inputsCost = inputsCostResult.total;
  const financialLegs = plantsPhysicalEnabled
    ? computeFinancialLegs({ hourlyRevenue, marginPenaltyPp: disasterMarginMod })
    : 0;
  // Calibration. On the sector's first physical-P&L turn the residual is SOLVED
  // so the physical lines reproduce `maintenance` — the margin formula's answer
  // at this exact state — to the last bit. Then it is persisted per output unit
  // and held, and the physical lines start moving on their own.
  //
  // A sector with no production yet cannot be calibrated per-unit (nothing to
  // divide by), so calibration is DEFERRED: the residual is charged directly for
  // that turn, which is exact anyway, and the anchor is stamped on the first
  // turn the plant actually runs.
  const otherOpexAnchorForPnl = healedOtherOpexPerUnitAnchor ?? storedOtherOpexAnchor;
  const otherOpexCalibrated = plantsPhysicalEnabled && storedOtherOpexAnchor == null;
  // Calibration solves against the policy-NEUTRAL margin cost: `maintenance`
  // includes the policy stack, and `policyCredit` re-applies that same stack on
  // the revenue side, so the residual must exclude it or the calibration turn
  // double-counts. `maintenance + policyCredit` is the margin formula's answer
  // with the policy stack backed out (credit is revenue × pp/100 with the sign
  // that removes it from cost). Total cost on the calibration turn is then
  // `… + otherOpex − policyCredit = maintenance` — the flip identity holds
  // exactly, as before.
  const solvedOtherOpexPerUnit = otherOpexCalibrated
    ? solveOtherOpexPerUnit({
        marginFormulaCost: maintenance + plantsPolicyCredit,
        laborCost: sectorLaborCost,
        inputsCost,
        financialLegs,
        producedUnits: producedUnits / retoolCapacityRatio,
      })
    : null;
  const otherOpex = !plantsPhysicalEnabled
    ? 0
    : otherOpexCalibrated
      ? // Exact by construction, whether or not the per-unit anchor could be
        // solved this turn.
        maintenance + plantsPolicyCredit - sectorLaborCost - inputsCost - financialLegs
      : (otherOpexAnchorForPnl ?? 0) *
        (producedUnits / retoolCapacityRatio) *
        // One-time rebase of legacy anchors onto the neutral basis; 1 for
        // anchors stamped after the policyCredit change. See the docblock on
        // `otherOpexDriftFactor` for why this stopped tracking the live stack.
        otherOpexDriftFactor({
          currentMarginBasis: plantsPolicyNeutralBasis,
          anchorMarginBasis: otherOpexAnchorMarginBasis,
        });
  const physicalPnl = plantsPhysicalEnabled
    ? assemblePhysicalPnl({
        hourlyRevenue,
        inputsCost,
        laborCost: sectorLaborCost,
        // The SAME P3a line, consumed — not a second upkeep charge alongside it.
        upkeep: plantsUpkeepCost,
        complianceCost: regulatoryBurden,
        otherOpex,
        financialLegs,
        growthCost: hourlyGrowthCost,
        policyCredit: plantsPolicyCredit,
      })
    : null;
  const hourlyProfit = physicalPnl
    ? physicalPnl.profit
    : hourlyRevenue - maintenance - plantsUpkeepCost - hourlyGrowthCost - regulatoryBurden;
  // NPV on a yearly basis: 1 game year = TURNS_PER_YEAR turns (48h).
  // The stock-market boost scales the capitalized value, never the cash
  // profit above: profit is money, NPV is what the market pays for it.
  const yearlyProfit = hourlyProfit * TURNS_PER_YEAR;
  const unboostedSectorNPV =
    yearlyProfit > 0 ? Math.round(yearlyProfit / NPV_ANNUAL_DISCOUNT_RATE) : 0;
  const sectorNPV =
    unboostedSectorNPV > 0 && npvBoostMultiplier !== 1
      ? Math.round(unboostedSectorNPV * npvBoostMultiplier)
      : unboostedSectorNPV;
  // Capital book anchor: under capital mode, a sector that owns productive
  // capacity is valued at its depreciated peak going-concern value, not just
  // this turn's (transiently depressed) NPV — so building real capacity isn't
  // valued as if the corp owns nothing. Seeded at current NPV on the flip
  // turn (no-op), ratchets up with NPV, decays slowly when NPV falls, never
  // exceeds its own historical peak (no over-crediting).
  const capitalBookAnchor = capitalEnabled
    ? advanceCapitalBookAnchor({ prevAnchor: prevCapitalBookAnchor, sectorNPV })
    : 0;

  return {
    plantsPhysicalEnabled,
    plantsPolicyPpRaw,
    plantsPolicyPp,
    plantsPolicyNeutralBasis,
    plantsPolicyCredit,
    inputsCost,
    financialLegs,
    otherOpexCalibrated,
    solvedOtherOpexPerUnit,
    otherOpex,
    physicalPnl,
    hourlyProfit,
    yearlyProfit,
    sectorNPV,
    capitalBookAnchor,
  };
}
