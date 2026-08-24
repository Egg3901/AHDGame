export type CampaignStage = "posture" | "mobilization" | "operations" | "settlement" | "aftermath";

export type CampaignCommitmentKind =
  "military" | "humanitarian" | "sanctions" | "covert" | "diplomatic" | "neutral";

export type CampaignResponseVisibility = "public" | "covert";

/** Persistent damage and settlement pressure left by a living campaign. */
export interface CampaignConsequences {
  civilianStrain: number;
  refugees: number;
  infrastructureDamage: number;
  armsProliferation: number;
  regionalSpillover: number;
  casualties: number;
  settlementMomentum: number;
}

export type CampaignConsequencesDelta = Partial<CampaignConsequences>;

/** What one country carries from earlier response windows. */
export interface CampaignCountryMemory {
  credibility: number;
  warWeariness: number;
  militaryCommitment: number;
  humanitarianCommitment: number;
  covertExposure: number;
  lastCommitmentKind?: CampaignCommitmentKind;
  lastResponseTurn?: number;
  lastResponseId?: string;
}

/** Optional on stored conflict rows so existing worlds normalize safely. */
export interface LivingCampaignState {
  stage: CampaignStage;
  stageTurns: number;
  cycle: number;
  consequences: CampaignConsequences;
  countryMemory: Record<string, CampaignCountryMemory>;
  lastOutcomeId?: string;
  lastResolutionId?: string;
}

/** Live national capacity captured when a response is accepted. */
export interface CampaignCapabilitySnapshot {
  treasuryPctGdp: number;
  militaryReadiness: number;
  logistics: number;
  domesticSupport: number;
  intelligence: number;
  assessedAt: Date;
}

/** Server-enforced requirements for an authored response option. */
export interface CampaignRequirement {
  allowedStages?: CampaignStage[];
  minTreasuryPctGdp?: number;
  minMilitaryReadiness?: number;
  minLogistics?: number;
  minDomesticSupport?: number;
  minIntelligence?: number;
}

/** Persistent footprint created by an accepted national response. */
export interface CampaignCommitment {
  kind: CampaignCommitmentKind;
  side?: "a" | "b";
  scale: number;
  credibilityDelta?: number;
  warWearinessDelta?: number;
  covertExposureRisk?: number;
  consequences?: CampaignConsequencesDelta;
}

/** Snapshotted campaign context carried by a materialized response window. */
export interface CampaignWindowSnapshot {
  stage: CampaignStage;
  cycle: number;
  consequences: CampaignConsequences;
}
