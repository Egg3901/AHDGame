/** Demand-aware production uses portable rules shared by turns and simulations. */
export {
  throttleSoldUnits,
  soldOutMarketHeadroomUnits,
  SOLD_OUT_FILL,
  SHORTAGE_RELAXED_FILL,
  DEMAND_PROBE_MARGIN,
  DEMAND_THROTTLE_FLOOR,
  demandThrottleFactor,
  withLatentDemand,
  withForeignDemand,
  FOREIGN_DEMAND_CLAIM_PER_TURN,
  withRegulationBlockedFill,
} from "./rules/demandThrottle";
