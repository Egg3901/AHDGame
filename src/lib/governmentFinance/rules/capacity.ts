import type { CapacityPoolInput, CapacitySettlement } from "./types";
import { currencyAmount } from "./reconciliation";

export function settleCapacity(input: CapacityPoolInput): CapacitySettlement {
  const sourceBreakdown = {
    workforce: currencyAmount(input.sourceBreakdown.workforce, "capacity.workforce"),
    facilities: currencyAmount(input.sourceBreakdown.facilities, "capacity.facilities"),
    systems: currencyAmount(input.sourceBreakdown.systems, "capacity.systems"),
    efficiency: currencyAmount(input.sourceBreakdown.efficiency, "capacity.efficiency"),
  };
  const grossThroughput = Object.values(sourceBreakdown).reduce((sum, value) => sum + value, 0);
  const maintenanceDemand = currencyAmount(input.maintenanceDemand, "capacity.maintenanceDemand");
  const programDemand = currencyAmount(input.programDemand, "capacity.programDemand");
  const maintainedThroughput = Math.max(0, grossThroughput - maintenanceDemand);
  const ratio = programDemand === 0 ? 1 : Math.min(1, maintainedThroughput / programDemand);

  return {
    capacityType: input.capacityType,
    grossThroughput,
    maintainedThroughput,
    maintenanceDemand,
    programDemand,
    ratio,
    sourceBreakdown,
  };
}
