/**
 * Static 1953 proposed Tier-1 roster and reclassification plan (#3723).
 *
 * Kept free of readiness-contract imports so {@link worldEntityManifest} can
 * apply the plan without creating a circular dependency through
 * {@link countryReadinessContract}.
 */

import type { CountryId } from "@/lib/constants/countries";
import type {
  ReadinessResult,
  WorldEconomicArchetype,
  WorldSimulationTier,
} from "./worldEntityManifest";

export const PRESET_1953 = "1953-default" as const;

/**
 * Proposed 1953 full-autonomous target roster from epic #3712.
 * This is a target, not a readiness claim — the matrix evaluates each entry.
 */
export const PROPOSED_1953_TIER1_ROSTER = [
  { entityId: "US", displayName: "United States", countryId: "US" as CountryId },
  { entityId: "UK", displayName: "United Kingdom", countryId: "UK" as CountryId },
  { entityId: "FR", displayName: "France", countryId: "FR" as CountryId },
  { entityId: "DE", displayName: "West Germany", countryId: "DE" as CountryId },
  { entityId: "DD", displayName: "East Germany", countryId: "DD" as CountryId },
  { entityId: "IT", displayName: "Italy", countryId: "IT" as CountryId },
  { entityId: "ES", displayName: "Spain", countryId: "ES" as CountryId },
  { entityId: "SE", displayName: "Sweden", countryId: "SE" as CountryId },
  { entityId: "TR", displayName: "Turkey", countryId: "TR" as CountryId },
  { entityId: "RU", displayName: "Soviet Union", countryId: "RU" as CountryId },
  { entityId: "CN", displayName: "China", countryId: "CN" as CountryId },
  { entityId: "JP", displayName: "Japan", countryId: "JP" as CountryId },
  { entityId: "NG", displayName: "Nigeria", countryId: "NG" as CountryId },
  { entityId: "PL", displayName: "Poland", countryId: "PL" as CountryId },
  { entityId: "CS", displayName: "Czechoslovakia", countryId: "CS" as CountryId },
  { entityId: "HU", displayName: "Hungary", countryId: "HU" as CountryId },
  { entityId: "RO", displayName: "Romania", countryId: "RO" as CountryId },
  { entityId: "BG", displayName: "Bulgaria", countryId: "BG" as CountryId },
  { entityId: "YU", displayName: "Yugoslavia", countryId: "YU" as CountryId },
  // Union republics. Display names are the era's, not the post-1991 states':
  // in 1953 these are Soviet republics, and calling them "Ukraine" or "Belarus"
  // flat would imply a sovereignty the 1953 world does not have.
  { entityId: "UKR", displayName: "Ukrainian SSR", countryId: "UKR" as CountryId },
  { entityId: "BLR", displayName: "Byelorussian SSR", countryId: "BLR" as CountryId },
  { entityId: "BAL", displayName: "Baltic Republics", countryId: "BAL" as CountryId },
  { entityId: "IN", displayName: "India", countryId: undefined },
  { entityId: "PK", displayName: "Pakistan", countryId: undefined },
  { entityId: "IR", displayName: "Iran", countryId: undefined },
  { entityId: "IQ", displayName: "Iraq", countryId: undefined },
  { entityId: "EG", displayName: "Egypt", countryId: undefined },
  { entityId: "SA", displayName: "Saudi Arabia", countryId: undefined },
  { entityId: "SY", displayName: "Syria", countryId: undefined },
  { entityId: "ID", displayName: "Indonesia", countryId: undefined },
  { entityId: "KP", displayName: "North Korea", countryId: undefined },
  { entityId: "KR", displayName: "South Korea", countryId: undefined },
  { entityId: "NVN", displayName: "North Vietnam", countryId: undefined },
  { entityId: "SVN", displayName: "South Vietnam", countryId: undefined },
  { entityId: "BR", displayName: "Brazil", countryId: "BR" as CountryId },
] as const;

export type Proposed1953Tier1EntityId = (typeof PROPOSED_1953_TIER1_ROSTER)[number]["entityId"];

/** Epic #3712 follow-up placeholder scheme when a dedicated issue does not exist yet. */
export function tier1FollowUpIssue(entityId: string, capabilityId: string): string {
  return `#3712/follow-up/${entityId}/${capabilityId}`;
}

/**
 * Owning seed/macro tickets for reclassified or unconfigured proposed Tier-1
 * countries. Per-capability gaps still use {@link tier1FollowUpIssue}.
 */
export const TIER1_1953_OWNER_ISSUES = {
  europeanMacro: "#3719",
  asianMiddleEastMacro: "#3720",
  africanAmericanMacro: "#3721",
  readinessContract: "#3722",
  matrixPublish: "#3723",
} as const;

export interface TierReclassificationRecord {
  proposedTier: "full-autonomous";
  appliedTier: WorldSimulationTier;
  reason: string;
  followUpIssues: string[];
}

export interface ManifestReadinessSnapshot {
  autonomous: ReadinessResult;
  player: ReadinessResult;
  hardBlockers: string[];
  flavorGaps: string[];
}

/**
 * Configured countries that fail autonomous readiness for 1953 and must leave
 * Tier 1. Target is sphere-macro (strategically relevant; not flair-only).
 *
 * Verdicts must match live {@link collectCapabilityEvidence} +
 * {@link evaluateCountryReadiness} — do not hand-author blockers the probes
 * refute. FR/IT/ES/SE/TR were wrongly demoted on false parties/cabinet claims;
 * contract evaluation (with seed-aware party probes) keeps them Tier 1.
 * Populate this list only when probes confirm an autonomous hard-block.
 */
export const TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS: ReadonlyArray<{
  entityId: CountryId;
  appliedTier: "sphere-macro";
  economicArchetype: WorldEconomicArchetype;
  reason: string;
  followUpIssues: string[];
  /** Capability IDs that block autonomy — kept in sync by the matrix tests. */
  autonomousBlockerCapabilityIds: readonly string[];
}> = [];

/**
 * Proposed Tier-1 candidates that PASS every readiness probe (autonomous
 * "ready") but are demoted to sphere-macro anyway as a deliberate product
 * decision independent of capability evidence. Distinct from
 * {@link TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS}, which is reserved for
 * probe-confirmed autonomous hard-blocks — entries here must NOT have an
 * autonomous blocker; if the live contract ever reports one for an entity in
 * this list, it belongs in the reclassifications list instead.
 *
 * ES (owner decision, 2026-07-28): Spain's regions/parties/budgets are fully
 * authored and the readiness contract reports it autonomous-ready — exactly
 * like FR/IT/SE/TR. But 1953 Spain is Franco's dictatorship: congresoDiputados
 * and the Senado are both era-gated off via a shared null anchor, so a
 * "full-autonomous, economy-preview" classification models a legislature that
 * never holds an election for the life of a 1953-default world. Demoted to
 * sphere-macro for 1953-default ONLY; Spain stays full-autonomous in every
 * later preset (Franco died 1975; Spain's first democratic election was
 * 1977) — see worldEntityManifest.ts's ES sphereMacroEntry.
 */
export const TIER1_1953_POLICY_DEMOTIONS: ReadonlyArray<{
  entityId: CountryId;
  appliedTier: "sphere-macro";
  reason: string;
  followUpIssues: string[];
}> = [
  {
    entityId: "ES",
    appliedTier: "sphere-macro",
    reason:
      "Franco-era Spain: congresoDiputados and the Senado are both era-gated off in 1953-default (neither chamber ever holds an election), so a full-autonomous classification models a legislature that never votes. Demoted to sphere-macro as a deliberate product decision, not a capability gap — the readiness contract still reports Spain autonomous-ready.",
    followUpIssues: [],
  },
];

/**
 * Proposed Tier-1 entities with no deep CountryConfig yet. Classified into the
 * 1953 manifest as sphere-macro until a full seed lands.
 */
export const TIER1_1953_UNCONFIGURED_PROPOSED: ReadonlyArray<{
  entityId: string;
  displayName: string;
  appliedTier: "sphere-macro";
  economicArchetype: WorldEconomicArchetype;
  ownerIssue: string;
  reason: string;
}> = [
  {
    entityId: "IN",
    displayName: "India",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "PK",
    displayName: "Pakistan",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "IR",
    displayName: "Iran",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "IQ",
    displayName: "Iraq",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "EG",
    displayName: "Egypt",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "SA",
    displayName: "Saudi Arabia",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "SY",
    displayName: "Syria",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "ID",
    displayName: "Indonesia",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "KP",
    displayName: "North Korea",
    appliedTier: "sphere-macro",
    economicArchetype: "planned",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "KR",
    displayName: "South Korea",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "NVN",
    displayName: "North Vietnam",
    appliedTier: "sphere-macro",
    economicArchetype: "planned",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
  {
    entityId: "SVN",
    displayName: "South Vietnam",
    appliedTier: "sphere-macro",
    economicArchetype: "market",
    ownerIssue: TIER1_1953_OWNER_ISSUES.asianMiddleEastMacro,
    reason: "No CountryConfig / deep 1953 seed; proposed Tier-1 reclassified to sphere-macro.",
  },
];

/** Mechanical capabilities assumed missing when no CountryConfig exists. */
export const UNCONFIGURED_BLOCKER_CAPABILITIES = [
  "fullAutonomousTier",
  "institutionsConfigured",
  "regionsAuthored",
  "partiesAuthored",
  "budgetsAuthored",
  "electionCycle",
] as const;

export function formatCapabilityBlocker(
  capabilityId: string,
  evidence: string,
  followUpIssue: string
): string {
  return `${capabilityId} — ${evidence} (${followUpIssue})`;
}
