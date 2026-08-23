import type {
  CampaignCapabilitySnapshot,
  CampaignCommitment,
  CampaignConsequences,
  CampaignConsequencesDelta,
  CampaignCountryMemory,
  CampaignRequirement,
  CampaignStage,
  LivingCampaignState,
} from "@/lib/db/types/livingConflictCampaign";
import type { CrisisDecisionOption, GlobalResponseRole } from "@/lib/db/types/crisis";

export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
  "posture",
  "mobilization",
  "operations",
  "settlement",
  "aftermath",
] as const;

export const CAMPAIGN_STAGE_LABELS: Record<CampaignStage, string> = {
  posture: "Posture",
  mobilization: "Mobilization",
  operations: "Operations",
  settlement: "Settlement",
  aftermath: "Aftermath",
};

const CONSEQUENCE_KEYS: Array<keyof CampaignConsequences> = [
  "civilianStrain",
  "refugees",
  "infrastructureDamage",
  "armsProliferation",
  "regionalSpillover",
  "casualties",
  "settlementMomentum",
];

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

export function emptyCampaignConsequences(): CampaignConsequences {
  return {
    civilianStrain: 0,
    refugees: 0,
    infrastructureDamage: 0,
    armsProliferation: 0,
    regionalSpillover: 0,
    casualties: 0,
    settlementMomentum: 0,
  };
}

export function emptyCountryMemory(): CampaignCountryMemory {
  return {
    credibility: 50,
    warWeariness: 0,
    militaryCommitment: 0,
    humanitarianCommitment: 0,
    covertExposure: 0,
  };
}

export function emptyCampaignState(): LivingCampaignState {
  return {
    stage: "posture",
    stageTurns: 0,
    cycle: 1,
    consequences: emptyCampaignConsequences(),
    countryMemory: {},
  };
}

/** Normalize optional legacy campaign fields at the deep module's seam. */
export function normalizeCampaignState(
  stored: LivingCampaignState | null | undefined
): LivingCampaignState {
  const base = emptyCampaignState();
  if (!stored) return base;
  const stage = CAMPAIGN_STAGES.includes(stored.stage) ? stored.stage : "posture";
  const consequences = emptyCampaignConsequences();
  for (const key of CONSEQUENCE_KEYS) consequences[key] = clamp(stored.consequences?.[key] ?? 0);
  const countryMemory = Object.fromEntries(
    Object.entries(stored.countryMemory ?? {}).map(([countryId, memory]) => [
      countryId,
      {
        ...emptyCountryMemory(),
        ...memory,
        credibility: clamp(memory.credibility ?? 50),
        warWeariness: clamp(memory.warWeariness ?? 0),
        militaryCommitment: clamp(memory.militaryCommitment ?? 0),
        humanitarianCommitment: clamp(memory.humanitarianCommitment ?? 0),
        covertExposure: clamp(memory.covertExposure ?? 0),
      },
    ])
  );
  return {
    ...base,
    ...stored,
    stage,
    stageTurns: Math.max(0, Math.round(stored.stageTurns ?? 0)),
    cycle: Math.max(1, Math.round(stored.cycle ?? 1)),
    consequences,
    countryMemory,
  };
}

function applyConsequenceDelta(
  consequences: CampaignConsequences,
  delta: CampaignConsequencesDelta = {}
): CampaignConsequences {
  const next = { ...consequences };
  for (const key of CONSEQUENCE_KEYS) next[key] = clamp(next[key] + (delta[key] ?? 0));
  return next;
}

/** Slow campaign motion between response windows. */
export function advanceCampaignTurn(stored: LivingCampaignState | undefined): LivingCampaignState {
  const state = normalizeCampaignState(stored);
  const drift: CampaignConsequencesDelta = {};
  if (state.stage === "mobilization") {
    drift.armsProliferation = 0.4;
    drift.regionalSpillover = 0.2;
  } else if (state.stage === "operations") {
    drift.civilianStrain = 0.7;
    drift.refugees = 0.4;
    drift.infrastructureDamage = 0.45;
    drift.casualties = 0.6;
    drift.regionalSpillover = 0.25;
    drift.settlementMomentum = 0.15;
  } else if (state.stage === "settlement") {
    drift.civilianStrain = -0.35;
    drift.refugees = -0.15;
    drift.settlementMomentum = 0.5;
  } else if (state.stage === "aftermath") {
    drift.civilianStrain = -0.5;
    drift.refugees = -0.25;
    drift.infrastructureDamage = -0.15;
    drift.regionalSpillover = -0.2;
    drift.settlementMomentum = -0.25;
  }
  return {
    ...state,
    stageTurns: state.stageTurns + 1,
    consequences: applyConsequenceDelta(state.consequences, drift),
  };
}

export interface CampaignRequirementResult {
  eligible: boolean;
  reasons: string[];
}

/** One eligibility rule-set shared by the API read and command paths. */
export function assessCampaignRequirement(
  requirement: CampaignRequirement | undefined,
  capability: CampaignCapabilitySnapshot,
  stage: CampaignStage
): CampaignRequirementResult {
  if (!requirement) return { eligible: true, reasons: [] };
  const reasons: string[] = [];
  if (requirement.allowedStages && !requirement.allowedStages.includes(stage)) {
    reasons.push(
      `Available during ${requirement.allowedStages.map((s) => CAMPAIGN_STAGE_LABELS[s]).join(" or ")}`
    );
  }
  if (
    requirement.minTreasuryPctGdp !== undefined &&
    capability.treasuryPctGdp < requirement.minTreasuryPctGdp
  ) {
    reasons.push(
      `Needs ${(requirement.minTreasuryPctGdp * 100).toFixed(2)}% of GDP in treasury capacity`
    );
  }
  if (
    requirement.minMilitaryReadiness !== undefined &&
    capability.militaryReadiness < requirement.minMilitaryReadiness
  ) {
    reasons.push(`Needs military readiness ${requirement.minMilitaryReadiness}`);
  }
  if (requirement.minLogistics !== undefined && capability.logistics < requirement.minLogistics) {
    reasons.push(`Needs logistics ${requirement.minLogistics}`);
  }
  if (
    requirement.minDomesticSupport !== undefined &&
    capability.domesticSupport < requirement.minDomesticSupport
  ) {
    reasons.push(`Needs domestic mandate ${requirement.minDomesticSupport}`);
  }
  if (
    requirement.minIntelligence !== undefined &&
    capability.intelligence < requirement.minIntelligence
  ) {
    reasons.push(`Needs intelligence confidence ${requirement.minIntelligence}`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function assessCampaignOptions(
  options: CrisisDecisionOption[],
  capability: CampaignCapabilitySnapshot,
  stage: CampaignStage
): Record<string, CampaignRequirementResult> {
  return Object.fromEntries(
    options.map((option) => [
      option.optionId,
      assessCampaignRequirement(option.campaignRequirement, capability, stage),
    ])
  );
}

/** Persist one country's commitment without replaying a duplicate response. */
export function recordCampaignCommitment(
  stored: LivingCampaignState | undefined,
  countryId: string,
  responseId: string,
  turn: number,
  commitment: CampaignCommitment | undefined
): LivingCampaignState {
  const state = normalizeCampaignState(stored);
  if (!commitment) return state;
  const previous = state.countryMemory[countryId] ?? emptyCountryMemory();
  if (previous.lastResponseId === responseId) return state;
  const memory: CampaignCountryMemory = {
    ...previous,
    credibility: clamp(previous.credibility + (commitment.credibilityDelta ?? 0)),
    warWeariness: clamp(previous.warWeariness + (commitment.warWearinessDelta ?? 0)),
    militaryCommitment: clamp(
      previous.militaryCommitment + (commitment.kind === "military" ? commitment.scale : 0)
    ),
    humanitarianCommitment: clamp(
      previous.humanitarianCommitment + (commitment.kind === "humanitarian" ? commitment.scale : 0)
    ),
    covertExposure: clamp(
      previous.covertExposure +
        (commitment.kind === "covert" ? (commitment.covertExposureRisk ?? 0) / 4 : 0)
    ),
    lastCommitmentKind: commitment.kind,
    lastResponseTurn: turn,
    lastResponseId: responseId,
  };
  return {
    ...state,
    consequences: applyConsequenceDelta(state.consequences, commitment.consequences),
    countryMemory: { ...state.countryMemory, [countryId]: memory },
  };
}

export interface CampaignOutcomeResult {
  state: LivingCampaignState;
  previousStage: CampaignStage;
  nextStage: CampaignStage;
  applied: boolean;
}

function inferredStage(state: LivingCampaignState): CampaignStage {
  if (state.stage === "aftermath") return "aftermath";
  if (state.stage === "settlement" && state.consequences.settlementMomentum >= 80) {
    return "aftermath";
  }
  if (state.consequences.settlementMomentum >= 55) return "settlement";
  if (state.consequences.casualties >= 50 || state.consequences.armsProliferation >= 60) {
    return "operations";
  }
  if (state.stage === "posture") return "mobilization";
  return state.stage;
}

/** Apply one aggregate outcome to persistent campaign state exactly once. */
export function applyCampaignOutcome(
  stored: LivingCampaignState | undefined,
  input: {
    resolutionId: string;
    outcomeId: string;
    delta?: CampaignConsequencesDelta;
    nextStage?: CampaignStage;
  }
): CampaignOutcomeResult {
  const previous = normalizeCampaignState(stored);
  if (previous.lastResolutionId === input.resolutionId) {
    return {
      state: previous,
      previousStage: previous.stage,
      nextStage: previous.stage,
      applied: false,
    };
  }
  const withConsequences: LivingCampaignState = {
    ...previous,
    consequences: applyConsequenceDelta(previous.consequences, input.delta),
  };
  const nextStage = input.nextStage ?? inferredStage(withConsequences);
  return {
    previousStage: previous.stage,
    nextStage,
    applied: true,
    state: {
      ...withConsequences,
      stage: nextStage,
      stageTurns: nextStage === previous.stage ? previous.stageTurns : 0,
      cycle: previous.cycle + 1,
      lastOutcomeId: input.outcomeId,
      lastResolutionId: input.resolutionId,
    },
  };
}

function stablePercent(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

export type CampaignRiskBand = "contained" | "unstable" | "dangerous" | "critical";

export interface CampaignIntelligenceAssessment {
  riskBand: CampaignRiskBand;
  confidence: "low" | "medium" | "high";
  estimatedRiskMin: number;
  estimatedRiskMax: number;
  summary: string;
}

export function campaignRisk(state: LivingCampaignState, intensity: number): number {
  const c = state.consequences;
  return clamp(
    intensity * 0.28 +
      c.civilianStrain * 0.13 +
      c.armsProliferation * 0.18 +
      c.regionalSpillover * 0.15 +
      c.casualties * 0.16 -
      c.settlementMomentum * 0.12
  );
}

function riskBand(value: number): CampaignRiskBand {
  if (value < 25) return "contained";
  if (value < 50) return "unstable";
  if (value < 75) return "dangerous";
  return "critical";
}

/** Deterministic fog of war. Countries see different ranges, never exact risk. */
export function estimateCampaignIntelligence(
  state: LivingCampaignState,
  capability: CampaignCapabilitySnapshot,
  input: {
    conflictKey: string;
    countryId: string;
    role: GlobalResponseRole;
    turn: number;
    intensity: number;
  }
): CampaignIntelligenceAssessment {
  const roleBonus =
    input.role === "belligerent"
      ? 18
      : input.role.startsWith("backer")
        ? 14
        : input.role === "neighbor"
          ? 10
          : 0;
  const confidenceScore = clamp(capability.intelligence + roleBonus);
  const width = confidenceScore >= 75 ? 8 : confidenceScore >= 50 ? 16 : 28;
  const jitterSpan = Math.max(2, Math.round(width / 2));
  const jitter =
    (stablePercent(`${input.conflictKey}:${input.countryId}:${input.turn}`) %
      (jitterSpan * 2 + 1)) -
    jitterSpan;
  const center = clamp(campaignRisk(state, input.intensity) + jitter);
  const min = clamp(center - width / 2);
  const max = clamp(center + width / 2);
  const band = riskBand(center);
  const confidence = confidenceScore >= 75 ? "high" : confidenceScore >= 50 ? "medium" : "low";
  return {
    riskBand: band,
    confidence,
    estimatedRiskMin: Math.round(min),
    estimatedRiskMax: Math.round(max),
    summary: `Intelligence assesses the campaign as ${band}, with ${confidence} confidence.`,
  };
}

/** A covert response is exposed deterministically from its authored risk. */
export function shouldExposeCovertResponse(
  crisisId: string,
  countryId: string,
  exposureRisk: number
): boolean {
  return stablePercent(`${crisisId}:${countryId}:covert-exposure`) < clamp(exposureRisk);
}

export function consequenceBand(value: number): "low" | "moderate" | "severe" | "extreme" {
  if (value < 25) return "low";
  if (value < 50) return "moderate";
  if (value < 75) return "severe";
  return "extreme";
}
