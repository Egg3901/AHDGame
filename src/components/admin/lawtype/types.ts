import type {
  LegislationEffectTargetV2,
  DemographicTargeting,
  LegislationPolicyOption,
  AllowedScope,
  LegislationTypePosition,
} from "@/lib/db/types";

export interface WizardState {
  _id: string;
  name: string;
  description: string;
  policyDomain: string;
  subCategory: string;
  allowedScope: AllowedScope;
  effectTargets: LegislationEffectTargetV2[];
  demographicTargeting: DemographicTargeting[];
  policyOptions: LegislationPolicyOption[];
  positions: LegislationTypePosition[];
  budgetCost: number;
  budgetCategory: string;
  isPermanent: boolean;
}
