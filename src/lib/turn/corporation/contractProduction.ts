import { demandThrottleFactor } from "./demandThrottle";
import { computeSectorOutputUnits } from "./sectorOutputUnits";

interface ContractProductionArgs {
  plantsEnabled: boolean;
  /** Nameplate after the operator's mothball choice. */
  actualNameplateUnits: number;
  /** Production factor including the operator's policy choice. */
  actualProductionFactor: number;
  /** Running-plant nameplate before the operator's mothball choice. */
  fullPolicyNameplateUnits: number;
  /** External production factors only. Excludes policy and mothballing. */
  involuntaryProductionFactor: number;
  priorSoldUnits?: number | null;
  priorProducedUnits?: number | null;
  soldFraction: number | null;
}

/**
 * Resolve one sector's actual run and its supply-agreement damage ceiling.
 *
 * Actual production follows the operator's production policy and mothball
 * choice. It also follows the demand throttle, which targets last turn's sales
 * plus a probe margin so a plant does not run flat out into a glut.
 *
 * The contract ceiling asks a different question: what could the sector have
 * produced if the operator requested a full run? External constraints still
 * apply, including inputs, capital, strikes, disasters, extraction limits and
 * the demand throttle. Production policy and mothballing do not apply because
 * either one is a voluntary way to reduce output and must not forgive a signed
 * commitment.
 */
export function computeContractProduction(args: ContractProductionArgs): {
  producedUnits: number;
  soldUnits: number;
  contractAchievableUnits: number;
} {
  const actualPlannedUnits = args.actualNameplateUnits * args.actualProductionFactor;
  const actualDemandThrottle = args.plantsEnabled
    ? demandThrottleFactor(actualPlannedUnits, args.priorSoldUnits, args.priorProducedUnits)
    : 1;
  const actual = computeSectorOutputUnits({
    nameplateUnits: args.actualNameplateUnits,
    productionFactor: args.actualProductionFactor * actualDemandThrottle,
    soldFraction: args.soldFraction,
  });

  if (!args.plantsEnabled) return { ...actual, contractAchievableUnits: 0 };

  const involuntaryUnits = Math.max(
    0,
    args.fullPolicyNameplateUnits * args.involuntaryProductionFactor
  );
  const contractDemandThrottle = demandThrottleFactor(
    involuntaryUnits,
    args.priorSoldUnits,
    args.priorProducedUnits
  );
  return {
    ...actual,
    contractAchievableUnits: involuntaryUnits * contractDemandThrottle,
  };
}
