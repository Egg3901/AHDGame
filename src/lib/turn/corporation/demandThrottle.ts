/** Demand-aware production uses portable rules shared by turns and simulations. */
export {
  throttleSoldUnits,
  soldOutMarketHeadroomUnits,
  SOLD_OUT_FILL,
  DEMAND_PROBE_MARGIN,
  DEMAND_THROTTLE_FLOOR,
  demandThrottleFactor,
  withLatentDemand,
} from "./rules/demandThrottle";
