import type { ObjectId } from "mongodb";
import type { EnactedResetLawProgram } from "./rules/enactment";

export interface ResetLawProgramDocument extends EnactedResetLawProgram {
  _id: string;
  worldId: string;
  regionId?: string;
  enactedByBillId: ObjectId;
  titleSnapshot: string;
  descriptionSnapshot: string;
  balanceBasis: "game-calibrated-provisional";
  primaryMetricEffects: readonly {
    metricId: string;
    favorableNormalizedPoints: number;
  }[];
}

export interface ResetLawEnactmentReceipt {
  _id: string;
  worldId: string;
  countryId: string;
  turn: number;
  programIds: string[];
  annualAllocationDelta: number;
  transitionClaim: number;
}
