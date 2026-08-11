import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { clampShare } from "./bounds";
import { assertEligibleSphereSponsor, isEligibleSphereSponsor } from "./eligibility";
import { resolvePrimarySponsor } from "./relationships";
import { isSphereSponsorDecisionTurn } from "./schedule";
import type {
  SphereMembership,
  SphereRelationship,
  SphereSponsorController,
  SphereSponsorDecision,
  SphereSponsorIntent,
  SphereTreatyState,
} from "./types";

/**
 * Gradual deltas — never teleport integration in one tick.
 *
 * ALIGNMENT IS NOT MOVED HERE. It is owned by the alignment turn phase
 * (`src/lib/turn/alignmentPhase.ts`), which derives every entity's per-sponsor
 * alignment from its Cold War pole shares. A sponsor intent still creates the
 * relationship, moves integration, and drives treaty state — it simply no longer
 * edits the number that decides which sphere a nation belongs to, so there is
 * one mechanism behind bloc migration rather than two fighting over it.
 */
const COURT_INTEGRATION_DELTA = 0.03;
const SUPPORT_INTEGRATION_DELTA = 0.04;
const RETAIN_INTEGRATION_DELTA = 0.015;
const LOSE_INTEGRATION_DELTA = -0.06;

/** New courted relationship starts weak with a proposed treaty. */
const COURT_INITIAL_ALIGNMENT = 0.12;
const COURT_INITIAL_INTEGRATION = 0.06;

const PROPOSE_TO_ACTIVE_ALIGNMENT = 0.28;
const PROPOSE_TO_ACTIVE_INTEGRATION = 0.18;
const LOSE_SUSPEND_ALIGNMENT = 0.12;
const LOSE_DROP_PRIMARY_MARGIN = 0.05;
const CONTEST_MARGIN = 0.08;
const LOSE_INTENT_ALIGNMENT = 0.18;
const PRIMARY_FLIP_MARGIN = 0.1;

function roundScore(value: number): number {
  return Math.round(clampShare(value) * 1000) / 1000;
}

function cloneMembership(membership: SphereMembership): SphereMembership {
  return {
    entityId: membership.entityId,
    presetId: membership.presetId,
    primarySphereId: membership.primarySphereId,
    relationships: membership.relationships.map((rel) => ({
      ...rel,
      treatyIds: [...rel.treatyIds],
    })),
  };
}

function findRel(
  membership: SphereMembership,
  sponsorId: WorldEntityId
): SphereRelationship | undefined {
  return membership.relationships.find((rel) => rel.sponsorId === sponsorId);
}

function bestRival(
  membership: SphereMembership,
  sponsorId: WorldEntityId
): SphereRelationship | undefined {
  let best: SphereRelationship | undefined;
  for (const rel of membership.relationships) {
    if (rel.sponsorId === sponsorId) continue;
    if (!best || rel.alignment > best.alignment) best = rel;
  }
  return best;
}

function maybeActivateTreaty(rel: SphereRelationship): SphereTreatyState {
  if (rel.treatyState === "active") return "active";
  if (rel.treatyState === "suspended") {
    return rel.alignment >= PROPOSE_TO_ACTIVE_ALIGNMENT &&
      rel.integration >= PROPOSE_TO_ACTIVE_INTEGRATION
      ? "active"
      : "suspended";
  }
  if (
    rel.alignment >= PROPOSE_TO_ACTIVE_ALIGNMENT &&
    rel.integration >= PROPOSE_TO_ACTIVE_INTEGRATION
  ) {
    return "active";
  }
  if (rel.treatyState === "none" && (rel.alignment > 0 || rel.integration > 0)) {
    return "proposed";
  }
  return rel.treatyState;
}

/**
 * Recompute primary from relationship scores without teleporting: only flip
 * when a contender exceeds the current primary by {@link PRIMARY_FLIP_MARGIN}.
 */
function resolvePrimaryAfterDrift(membership: SphereMembership): WorldEntityId | null {
  if (membership.relationships.length === 0) return null;
  if (membership.relationships.length === 1) return membership.relationships[0]!.sponsorId;

  const ranked = [...membership.relationships].sort((a, b) => {
    if (b.alignment !== a.alignment) return b.alignment - a.alignment;
    if (b.integration !== a.integration) return b.integration - a.integration;
    return a.sponsorId.localeCompare(b.sponsorId);
  });
  const leader = ranked[0]!;
  const currentId = membership.primarySphereId;
  if (currentId == null) return leader.sponsorId;

  const current = membership.relationships.find((r) => r.sponsorId === currentId);
  if (!current) return leader.sponsorId;
  if (leader.sponsorId === currentId) return currentId;
  if (leader.alignment >= current.alignment + PRIMARY_FLIP_MARGIN) return leader.sponsorId;
  return currentId;
}

function upsertRelationship(
  membership: SphereMembership,
  next: SphereRelationship
): SphereMembership {
  const others = membership.relationships.filter((rel) => rel.sponsorId !== next.sponsorId);
  const relationships = [...others, next].sort((a, b) => a.sponsorId.localeCompare(b.sponsorId));
  const draft: SphereMembership = {
    ...membership,
    relationships,
  };
  return {
    ...draft,
    primarySphereId: resolvePrimaryAfterDrift(draft),
  };
}

/**
 * Deterministic NPP intent for one sponsor×member pair.
 * Uses relationship state only — no wall-clock, no RNG.
 */
export function decideNppSponsorIntent(
  membership: SphereMembership,
  sponsorId: WorldEntityId
): SphereSponsorIntent {
  const rel = findRel(membership, sponsorId);
  if (!rel) return "court";

  const primaryId = resolvePrimarySponsor(membership);
  const isPrimary = primaryId === sponsorId;
  const rival = bestRival(membership, sponsorId);

  if (rel.alignment < LOSE_INTENT_ALIGNMENT || rel.treatyState === "suspended") {
    if (isPrimary && rival && rival.alignment > rel.alignment - CONTEST_MARGIN) {
      return "retain";
    }
    return "lose";
  }

  if (isPrimary && rival && rival.alignment >= rel.alignment - CONTEST_MARGIN) {
    return "retain";
  }

  if (isPrimary || rel.treatyState === "active") {
    return "support";
  }

  return "court";
}

export interface ApplySponsorIntentInput {
  membership: SphereMembership;
  sponsorId: WorldEntityId;
  intent: SphereSponsorIntent;
  controller: SphereSponsorController;
  turn: number;
}

export interface ApplySponsorIntentResult {
  membership: SphereMembership;
  decision: SphereSponsorDecision;
}

/**
 * Apply a court / support / retain / lose intent through normal relationship
 * drift. Same surface for NPP and player controllers — eligibility is preset-
 * matrix only.
 */
export function applySponsorIntent(input: ApplySponsorIntentInput): ApplySponsorIntentResult {
  const { sponsorId, intent, controller, turn } = input;
  assertEligibleSphereSponsor(input.membership.presetId, sponsorId);

  let membership = cloneMembership(input.membership);
  const before = findRel(membership, sponsorId);
  const beforePrimary = membership.primarySphereId;
  let reason = "";

  if (intent === "court") {
    if (!before) {
      const created: SphereRelationship = {
        sponsorId,
        alignment: COURT_INITIAL_ALIGNMENT,
        integration: COURT_INITIAL_INTEGRATION,
        treatyIds: [`sphere-court-${sponsorId}-${membership.entityId}`],
        treatyState: "proposed",
      };
      membership = upsertRelationship(membership, created);
      reason = `${sponsorId} courts ${membership.entityId}: new proposed relationship`;
    } else {
      const nextAlignment = before.alignment;
      const nextIntegration = roundScore(before.integration + COURT_INTEGRATION_DELTA);
      const next: SphereRelationship = {
        ...before,
        alignment: nextAlignment,
        integration: nextIntegration,
        treatyState: maybeActivateTreaty({
          ...before,
          alignment: nextAlignment,
          integration: nextIntegration,
        }),
      };
      membership = upsertRelationship(membership, next);
      reason = `${sponsorId} courts ${membership.entityId}: integration drift up`;
    }
  } else if (intent === "support") {
    if (!before) {
      return applySponsorIntent({ ...input, intent: "court" });
    }
    const nextAlignment = before.alignment;
    const nextIntegration = roundScore(before.integration + SUPPORT_INTEGRATION_DELTA);
    const next: SphereRelationship = {
      ...before,
      alignment: nextAlignment,
      integration: nextIntegration,
      treatyState: maybeActivateTreaty({
        ...before,
        alignment: nextAlignment,
        integration: nextIntegration,
      }),
    };
    membership = upsertRelationship(membership, next);
    reason = `${sponsorId} supports ${membership.entityId}: reinforce sphere ties`;
  } else if (intent === "retain") {
    if (!before) {
      return applySponsorIntent({ ...input, intent: "court" });
    }
    const nextAlignment = before.alignment;
    const nextIntegration = roundScore(before.integration + RETAIN_INTEGRATION_DELTA);
    const next: SphereRelationship = {
      ...before,
      alignment: nextAlignment,
      integration: nextIntegration,
      treatyState: maybeActivateTreaty({
        ...before,
        alignment: nextAlignment,
        integration: nextIntegration,
      }),
    };
    membership = upsertRelationship(membership, next);
    if (beforePrimary === sponsorId) {
      membership = { ...membership, primarySphereId: sponsorId };
    }
    reason = `${sponsorId} retains ${membership.entityId}: contested primary defense`;
  } else {
    if (!before) {
      const decision: SphereSponsorDecision = {
        turn,
        sponsorId,
        memberId: membership.entityId,
        intent,
        controller,
        alignmentDelta: 0,
        integrationDelta: 0,
        primaryChanged: false,
        previousPrimaryId: beforePrimary,
        nextPrimaryId: membership.primarySphereId,
        reason: `${sponsorId} has no relationship with ${membership.entityId} to lose`,
      };
      return { membership, decision };
    }
    const nextAlignment = before.alignment;
    const nextIntegration = roundScore(before.integration + LOSE_INTEGRATION_DELTA);
    let treatyState: SphereTreatyState = before.treatyState;
    if (nextAlignment < LOSE_SUSPEND_ALIGNMENT) {
      treatyState = nextAlignment <= 0 && nextIntegration <= 0 ? "none" : "suspended";
    }
    const next: SphereRelationship = {
      ...before,
      alignment: nextAlignment,
      integration: nextIntegration,
      treatyState,
    };
    membership = upsertRelationship(membership, next);
    const rival = bestRival(membership, sponsorId);
    if (
      membership.primarySphereId === sponsorId &&
      rival &&
      rival.alignment >= nextAlignment + LOSE_DROP_PRIMARY_MARGIN
    ) {
      membership = { ...membership, primarySphereId: rival.sponsorId };
    }
    reason = `${sponsorId} loses influence over ${membership.entityId}: relationship decay`;
  }

  const after = findRel(membership, sponsorId);
  const decision: SphereSponsorDecision = {
    turn,
    sponsorId,
    memberId: membership.entityId,
    intent,
    controller,
    alignmentDelta: Math.round(((after?.alignment ?? 0) - (before?.alignment ?? 0)) * 1000) / 1000,
    integrationDelta:
      Math.round(((after?.integration ?? 0) - (before?.integration ?? 0)) * 1000) / 1000,
    primaryChanged: membership.primarySphereId !== beforePrimary,
    previousPrimaryId: beforePrimary,
    nextPrimaryId: membership.primarySphereId,
    reason,
  };

  return { membership, decision };
}

export interface ProcessSphereSponsorTickInput {
  turn: number;
  memberships: readonly SphereMembership[];
  /**
   * Control map for eligible sponsors. Missing entries default to `"npp"`.
   * Player-controlled sponsors are skipped here — they use {@link applySponsorIntent}
   * directly (same capability surface, no cadence throttle).
   */
  controllerBySponsor?: ReadonlyMap<WorldEntityId, SphereSponsorController>;
  /**
   * Sponsors that may act. Defaults to every distinct sponsor already present
   * on the memberships, plus any keys from {@link controllerBySponsor}.
   */
  sponsorIds?: readonly WorldEntityId[];
}

export interface ProcessSphereSponsorTickResult {
  memberships: SphereMembership[];
  decisions: SphereSponsorDecision[];
  /** Sponsors skipped because ineligible, off-cadence, or player-controlled. */
  skippedSponsors: WorldEntityId[];
}

/**
 * Cadence-gated NPP sponsor management over a roster of memberships.
 * Mutates relationship state gradually; callers persist + ledger the decisions.
 */
export function processSphereSponsorTick(
  input: ProcessSphereSponsorTickInput
): ProcessSphereSponsorTickResult {
  const { turn } = input;
  const byEntity = new Map<string, SphereMembership>();
  for (const membership of input.memberships) {
    byEntity.set(membership.entityId, cloneMembership(membership));
  }

  const defaultSponsors = new Set<WorldEntityId>();
  for (const membership of byEntity.values()) {
    for (const rel of membership.relationships) {
      defaultSponsors.add(rel.sponsorId);
    }
  }
  if (input.controllerBySponsor) {
    for (const sponsorId of input.controllerBySponsor.keys()) {
      defaultSponsors.add(sponsorId);
    }
  }

  const sponsorIds = [...(input.sponsorIds ?? defaultSponsors)].sort((a, b) => a.localeCompare(b));

  const decisions: SphereSponsorDecision[] = [];
  const skippedSponsors: WorldEntityId[] = [];

  for (const sponsorId of sponsorIds) {
    const controller = input.controllerBySponsor?.get(sponsorId) ?? "npp";
    if (controller === "player") {
      skippedSponsors.push(sponsorId);
      continue;
    }
    if (!isSphereSponsorDecisionTurn(turn, sponsorId)) {
      skippedSponsors.push(sponsorId);
      continue;
    }

    const memberIds = [...byEntity.keys()].sort((a, b) => a.localeCompare(b));
    let acted = false;
    for (const memberId of memberIds) {
      const membership = byEntity.get(memberId)!;
      if (!isEligibleSphereSponsor(membership.presetId, sponsorId)) {
        continue;
      }
      const intent = decideNppSponsorIntent(membership, sponsorId);
      const result = applySponsorIntent({
        membership,
        sponsorId,
        intent,
        controller: "npp",
        turn,
      });
      byEntity.set(memberId, result.membership);
      decisions.push(result.decision);
      acted = true;
    }
    if (!acted) {
      skippedSponsors.push(sponsorId);
    }
  }

  return {
    memberships: [...byEntity.values()].sort((a, b) => a.entityId.localeCompare(b.entityId)),
    decisions,
    skippedSponsors,
  };
}
