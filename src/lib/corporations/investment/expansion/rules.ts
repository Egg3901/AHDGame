/**
 * Expansion sizing keeps a turn of running costs in cash and never treats a
 * shortage in one output as buyers for another. Recommendations require a
 * profitable operating scenario; missing figures leave the choice manual.
 */
import { forecastSectorInvestment, type InvestmentForecastInput } from "../rules";

/**
 * Clearing's realization bounds cover the sale-price drop as scarcity eases.
 * Stress physical input prices in the opposite direction, leaving wages and
 * other observed costs unchanged. Missing input detail stresses all costs.
 */
/**
 * Sale-price stress for expansion advice. Pinned to the original 0.7 / 1.5
 * realization band: tying it to the live clamp meant raising the shortage
 * ceiling made the advisor harsher on exactly the scarce sectors it is meant to
 * steer capacity into.
 */
export const EXPANSION_SALE_STRESS_FACTOR = 0.7 / 1.5;

export function stressExpansionForecast(input: InvestmentForecastInput): InvestmentForecastInput {
  const saleFactor = EXPANSION_SALE_STRESS_FACTOR;
  const inputs = Math.max(0, input.inputsCostDailyAnchor ?? input.operatingCostDailyAnchor);
  return {
    ...input,
    revenueDailyAnchor: input.revenueDailyAnchor * saleFactor,
    policyCreditDailyAnchor:
      Math.max(0, input.policyCreditDailyAnchor ?? 0) * saleFactor +
      Math.min(0, input.policyCreditDailyAnchor ?? 0),
    operatingCostDailyAnchor: input.operatingCostDailyAnchor + inputs * (1 / saleFactor - 1),
  };
}

/** Every output must have measured buyers; latent demand is excluded by the caller. */
export function sellableExpansionUnits(legs: readonly { weight: number; gap: number }[]): number {
  if (legs.length === 0) return 0;
  let limit = Infinity;
  for (const leg of legs) {
    if (!Number.isFinite(leg.weight) || leg.weight <= 0 || !Number.isFinite(leg.gap)) return 0;
    limit = Math.min(limit, Math.max(0, leg.gap) / leg.weight);
  }
  return limit;
}

/** Gross expenses are reserved without relying on next turn's sales receipts. */
export function expansionOperatingReserve(input: {
  overheadPerTurnAnchor: number;
  sectors: readonly {
    costPerTurnAnchor: number;
    capacityUnits: number;
    queuedUnits: number;
    current: boolean;
  }[];
}): number | null {
  if (!Number.isFinite(input.overheadPerTurnAnchor) || input.overheadPerTurnAnchor < 0) return null;
  let reserve = input.overheadPerTurnAnchor;
  for (const sector of input.sectors) {
    if (
      !sector.current ||
      ![sector.costPerTurnAnchor, sector.capacityUnits, sector.queuedUnits].every(
        Number.isFinite
      ) ||
      sector.capacityUnits <= 0 ||
      sector.queuedUnits < 0
    )
      return null;
    // Reserve the fully delivered queue, rather than assuming it stays at today's scale.
    reserve +=
      Math.max(0, sector.costPerTurnAnchor) * (1 + sector.queuedUnits / sector.capacityUnits);
  }
  return reserve;
}

export type ExpansionSizingReason =
  "history" | "constraints" | "unprofitable" | "cash" | "demand" | null;
export function recommendSectorExpansion(input: {
  unitsPerFacility: number;
  measuredDemandUnits: number | null;
  shareHeadroomUnits: number;
  queuedUnits: number;
  cashAnchor: number;
  operatingReserveAnchor: number | null;
  constrained: boolean;
  forecast: InvestmentForecastInput | null;
}): {
  cashFacilities: number;
  demandFacilities: number;
  reason: ExpansionSizingReason;
  reserveAnchor: number | null;
} {
  const empty = (reason: ExpansionSizingReason) => ({
    cashFacilities: 0,
    demandFacilities: 0,
    reason,
    reserveAnchor: input.operatingReserveAnchor,
  });
  const observed = input.forecast;
  if (
    !observed ||
    input.operatingReserveAnchor == null ||
    input.measuredDemandUnits == null ||
    ![
      input.unitsPerFacility,
      input.measuredDemandUnits,
      input.shareHeadroomUnits,
      input.queuedUnits,
      input.cashAnchor,
      input.operatingReserveAnchor,
    ].every(Number.isFinite) ||
    input.unitsPerFacility <= 0 ||
    input.operatingReserveAnchor < 0
  )
    return empty("history");
  if (input.constrained) return empty("constraints");
  const f = stressExpansionForecast(observed);
  const room = Math.max(
    0,
    Math.min(input.shareHeadroomUnits, input.measuredDemandUnits) - Math.max(0, input.queuedUnits)
  );
  // Full running costs for the proposed capacity stay in cash alongside the existing company reserve.
  const perUnitRunning =
    (Math.max(0, f.operatingCostDailyAnchor + f.overheadDailyAnchor) / f.producedUnits +
      Math.max(0, f.upkeepDailyAnchor) / f.capacityUnits) /
    f.turnsPerDay;
  const priceAndReserve = input.unitsPerFacility * (f.chargedPerUnitAnchor + perUnitRunning);
  if (!(priceAndReserve > 0) || !Number.isFinite(priceAndReserve)) return empty("history");
  const cashFacilities = Math.max(
    0,
    Math.floor((input.cashAnchor - input.operatingReserveAnchor) / priceAndReserve)
  );
  const demandFacilities = Math.min(
    cashFacilities,
    Math.max(
      0,
      Math.floor(room / Math.max(1, f.producedUnits / f.capacityUnits) / input.unitsPerFacility)
    )
  );
  if (demandFacilities < 1) return empty(cashFacilities < 1 ? "cash" : "demand");
  const horizons = [1, Math.min(192, f.buildTurns), 48, 96, 192];
  const one = forecastSectorInvestment(
    {
      ...f,
      units: input.unitsPerFacility,
      demandGapUnits: room,
    },
    horizons
  );
  if (!one || one.some((point) => point.availableCashAnchor <= 0)) return empty("unprofitable");
  // A mixed plant must remain cash positive at the selected quantity, not only at one facility.
  const scenario = forecastSectorInvestment(
    {
      ...f,
      units: demandFacilities * input.unitsPerFacility,
      demandGapUnits: room,
    },
    horizons
  );
  if (!scenario || scenario.some((point) => point.availableCashAnchor <= 0))
    return empty("unprofitable");
  return {
    cashFacilities: Math.min(cashFacilities, demandFacilities),
    demandFacilities,
    reason: null,
    reserveAnchor: input.operatingReserveAnchor,
  };
}
