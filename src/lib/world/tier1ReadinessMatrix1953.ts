/**
 * 1953 Tier-1 readiness matrix (#3723).
 *
 * Evaluates every proposed Tier-1 country against the archetype-aware readiness
 * contract (#3722), attaches capability + follow-up issue references to every
 * blocker, and exposes a deterministic admin/diagnostics read model.
 */

import type { CountryId } from "@/lib/constants/countries";
import {
  collectCapabilityEvidence,
  evaluateCountryReadiness,
  resolveReadinessArchetypesForCountry,
  type CapabilityId,
  type CountryReadinessReport,
  type ReadinessArchetype,
} from "@/lib/world/countryReadinessContract";
import { getWorldEntityOrThrow, type WorldSimulationTier } from "@/lib/world/worldEntityManifest";
import {
  formatCapabilityBlocker,
  PRESET_1953,
  PROPOSED_1953_TIER1_ROSTER,
  TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS,
  TIER1_1953_OWNER_ISSUES,
  TIER1_1953_POLICY_DEMOTIONS,
  TIER1_1953_UNCONFIGURED_PROPOSED,
  tier1FollowUpIssue,
  UNCONFIGURED_BLOCKER_CAPABILITIES,
  type Proposed1953Tier1EntityId,
  type TierReclassificationRecord,
} from "@/lib/world/tier1Readiness1953Data";

export interface Tier1MatrixBlocker {
  capabilityId: string;
  label: string;
  evidence: string;
  /** Owning follow-up issue — epic placeholder or a real child ticket. */
  followUpIssue: string;
  /** Scopes this capability blocks when missing. */
  blocks: Array<"autonomous" | "player">;
}

export interface Tier1MatrixFlavorGap {
  capabilityId: string;
  label: string;
  evidence: string;
}

export interface Tier1MatrixRow {
  entityId: Proposed1953Tier1EntityId;
  displayName: string;
  countryId?: CountryId;
  hasCountryConfig: boolean;
  proposedTier: "full-autonomous";
  appliedTier: WorldSimulationTier;
  reclassification: TierReclassificationRecord | null;
  archetypes: ReadinessArchetype[];
  autonomous: "ready" | "blocked";
  player: "ready" | "blocked";
  hardBlockers: Tier1MatrixBlocker[];
  flavorGaps: Tier1MatrixFlavorGap[];
  /** Present when a deep CountryConfig exists and the contract was evaluated. */
  contractReport: CountryReadinessReport | null;
}

export interface Tier1ReadinessMatrix1953 {
  presetId: typeof PRESET_1953;
  generatedBy: "tier1ReadinessMatrix1953";
  issue: typeof TIER1_1953_OWNER_ISSUES.matrixPublish;
  summary: {
    proposedCount: number;
    autonomousReady: number;
    playerReady: number;
    reclassified: number;
    unconfigured: number;
  };
  rows: Tier1MatrixRow[];
}

const RECLASS_BY_ID = new Map(
  TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS.map((r) => [r.entityId, r] as const)
);
const UNCONFIGURED_BY_ID = new Map(
  TIER1_1953_UNCONFIGURED_PROPOSED.map((e) => [e.entityId, e] as const)
);
const POLICY_DEMOTION_BY_ID = new Map(
  TIER1_1953_POLICY_DEMOTIONS.map((p) => [p.entityId, p] as const)
);

/**
 * Evaluate a proposed Tier-1 candidate independent of post-matrix tier
 * assignment. Overrides `fullAutonomousTier` so reclassified sphere-macro
 * countries still surface their real capability gaps.
 */
export function assessProposed1953Tier1Candidate(countryId: CountryId): CountryReadinessReport {
  const archetypes = resolveReadinessArchetypesForCountry(countryId, PRESET_1953);
  const evidence = collectCapabilityEvidence(countryId, PRESET_1953);
  evidence.fullAutonomousTier = {
    present: true,
    evidence:
      "Proposed 1953 Tier-1 candidate; evaluated independent of post-matrix tier assignment.",
  };
  return evaluateCountryReadiness({
    countryId,
    presetId: PRESET_1953,
    archetypes,
    evidence,
  });
}

function blockersFromReport(report: CountryReadinessReport): Tier1MatrixBlocker[] {
  return report.hardBlockers.map((blocker) => {
    const diagnostic = report.capabilities.find((c) => c.capabilityId === blocker.capabilityId);
    const blocks: Array<"autonomous" | "player"> = [];
    if (diagnostic?.requiredFor.includes("autonomous")) blocks.push("autonomous");
    if (diagnostic?.requiredFor.includes("player")) blocks.push("player");
    return {
      capabilityId: blocker.capabilityId,
      label: blocker.label,
      evidence: blocker.evidence,
      followUpIssue: tier1FollowUpIssue(report.countryId, blocker.capabilityId),
      blocks,
    };
  });
}

function flavorFromReport(report: CountryReadinessReport): Tier1MatrixFlavorGap[] {
  return report.flavorGaps.map((gap) => ({
    capabilityId: gap.capabilityId,
    label: gap.label,
    evidence: gap.evidence,
  }));
}

function synthesizeUnconfiguredRow(
  entityId: Proposed1953Tier1EntityId,
  displayName: string
): Tier1MatrixRow {
  const plan = UNCONFIGURED_BY_ID.get(entityId);
  if (!plan) {
    throw new Error(
      `Unconfigured proposed Tier-1 entity ${entityId} lacks a reclassification plan.`
    );
  }

  const hardBlockers: Tier1MatrixBlocker[] = UNCONFIGURED_BLOCKER_CAPABILITIES.map(
    (capabilityId) => ({
      capabilityId,
      label: capabilityId,
      evidence: plan.reason,
      followUpIssue: tier1FollowUpIssue(entityId, capabilityId),
      blocks: ["autonomous", "player"] as Array<"autonomous" | "player">,
    })
  );
  // Anchor the owning macro ticket on the primary institutions gap.
  hardBlockers[1] = {
    ...hardBlockers[1]!,
    followUpIssue: plan.ownerIssue,
  };

  const reclassification: TierReclassificationRecord = {
    proposedTier: "full-autonomous",
    appliedTier: plan.appliedTier,
    reason: plan.reason,
    followUpIssues: [
      plan.ownerIssue,
      ...UNCONFIGURED_BLOCKER_CAPABILITIES.map((id) => tier1FollowUpIssue(entityId, id)),
    ],
  };

  return {
    entityId,
    displayName,
    countryId: undefined,
    hasCountryConfig: false,
    proposedTier: "full-autonomous",
    appliedTier: plan.appliedTier,
    reclassification,
    archetypes: [],
    autonomous: "blocked",
    player: "blocked",
    hardBlockers,
    flavorGaps: [],
    contractReport: null,
  };
}

function buildConfiguredRow(
  entityId: Proposed1953Tier1EntityId,
  displayName: string,
  countryId: CountryId
): Tier1MatrixRow {
  const report = assessProposed1953Tier1Candidate(countryId);
  const hardBlockers = blockersFromReport(report);
  const flavorGaps = flavorFromReport(report);
  const reclassPlan = RECLASS_BY_ID.get(countryId);
  const manifestEntry = getWorldEntityOrThrow(PRESET_1953, entityId);

  let reclassification: TierReclassificationRecord | null = null;
  let appliedTier: WorldSimulationTier = "full-autonomous";

  if (report.autonomous === "blocked") {
    if (!reclassPlan) {
      throw new Error(
        `Proposed Tier-1 ${entityId} is autonomous-blocked but has no reclassification plan.`
      );
    }
    appliedTier = reclassPlan.appliedTier;
    reclassification = {
      proposedTier: "full-autonomous",
      appliedTier: reclassPlan.appliedTier,
      reason: reclassPlan.reason,
      followUpIssues: reclassPlan.followUpIssues,
    };
  } else {
    const policyDemotion = POLICY_DEMOTION_BY_ID.get(countryId);
    if (policyDemotion) {
      // Readiness-ready but demoted anyway by product decision (e.g. ES —
      // see TIER1_1953_POLICY_DEMOTIONS' doc comment). Trust the manifest
      // tier rather than the probe result: this is a deliberate policy
      // override, not a readiness gap the probes should be expected to see.
      appliedTier = policyDemotion.appliedTier;
      if (manifestEntry.simulationTier !== policyDemotion.appliedTier) {
        throw new Error(
          `Proposed Tier-1 ${entityId} has a policy demotion to ${policyDemotion.appliedTier} but manifest tier is ${manifestEntry.simulationTier}.`
        );
      }
      reclassification = {
        proposedTier: "full-autonomous",
        appliedTier: policyDemotion.appliedTier,
        reason: policyDemotion.reason,
        followUpIssues: policyDemotion.followUpIssues,
      };
    } else {
      appliedTier = manifestEntry.simulationTier;
      if (appliedTier !== "full-autonomous") {
        throw new Error(
          `Proposed Tier-1 ${entityId} is autonomous-ready but manifest tier is ${appliedTier}.`
        );
      }
    }
  }

  return {
    entityId,
    displayName,
    countryId,
    hasCountryConfig: true,
    proposedTier: "full-autonomous",
    appliedTier,
    reclassification,
    archetypes: report.archetypes,
    autonomous: report.autonomous,
    player: report.player,
    hardBlockers,
    flavorGaps,
    contractReport: report,
  };
}

/**
 * Build the deterministic 1953 Tier-1 readiness matrix. Pure aside from reading
 * static registries via the readiness contract.
 */
export function build1953Tier1ReadinessMatrix(): Tier1ReadinessMatrix1953 {
  const rows: Tier1MatrixRow[] = PROPOSED_1953_TIER1_ROSTER.map((entry) => {
    if (entry.countryId) {
      return buildConfiguredRow(entry.entityId, entry.displayName, entry.countryId);
    }
    return synthesizeUnconfiguredRow(entry.entityId, entry.displayName);
  });

  return {
    presetId: PRESET_1953,
    generatedBy: "tier1ReadinessMatrix1953",
    issue: TIER1_1953_OWNER_ISSUES.matrixPublish,
    summary: {
      proposedCount: rows.length,
      autonomousReady: rows.filter((r) => r.autonomous === "ready").length,
      playerReady: rows.filter((r) => r.player === "ready").length,
      reclassified: rows.filter((r) => r.reclassification !== null).length,
      unconfigured: rows.filter((r) => !r.hasCountryConfig).length,
    },
    rows,
  };
}

/** Japan 1953 resolution helper — ready (autonomous) / blocked (player). */
export function resolveJapan1953MatrixRow(): Tier1MatrixRow {
  const matrix = build1953Tier1ReadinessMatrix();
  const japan = matrix.rows.find((r) => r.entityId === "JP");
  if (!japan) throw new Error("Japan missing from 1953 Tier-1 matrix.");
  return japan;
}

/** Format blockers the way the world-entity manifest stores hardBlockers. */
export function formatMatrixBlockersForManifest(blockers: Tier1MatrixBlocker[]): string[] {
  return blockers.map((b) => formatCapabilityBlocker(b.capabilityId, b.evidence, b.followUpIssue));
}

export type { CapabilityId };
