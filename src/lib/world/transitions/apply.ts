import type { Db } from "mongodb";
import {
  getWorldEntityOrThrow,
  type WorldEntityManifestEntry,
  type WorldEntityTreatyState,
} from "@/lib/world/worldEntityManifest";
import {
  assertValidSphereMembership,
  membershipFromManifestEntry,
} from "@/lib/world/spheres/relationships";
import type { SphereMembership } from "@/lib/world/spheres/types";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import { evaluateTransition, evaluateTransitionWithDefaults } from "./evaluate";
import { getTransitionMacroCountry } from "./rosterMacros";
import {
  DEFAULT_TRANSITION_PRESSURES,
  getTransitionRule,
  GHANA_ENTITY_ID,
  GOLD_COAST_ENTITY_ID,
  GOLD_COAST_TO_GHANA_RULE_ID,
} from "./rules";
import type {
  SovereigntyApplication,
  TransitionEvaluation,
  TransitionPressures,
  UnLifecycleSnapshot,
} from "./types";

const AUTONOMY_BLOCKER =
  "The entity is not wired for a full autonomous country simulation in this preset.";
const PLAYER_BLOCKER = "Player access is not enabled for this entity in the active preset.";

function activateProposedTreaties(
  relationships: WorldEntityManifestEntry["sphere"]["relationships"]
): WorldEntityManifestEntry["sphere"]["relationships"] {
  return relationships.map((rel) => {
    const treatyState: WorldEntityTreatyState =
      rel.treatyState === "proposed" ? "active" : (rel.treatyState ?? "none");
    return { ...rel, treatyState };
  });
}

/**
 * Promote an emergent target manifest row to a live sovereign entry.
 * Grants only the rule's configured Tier-2 or Tier-3 — never automatic Tier-1.
 */
export function buildSovereignEntity(evaluation: TransitionEvaluation): WorldEntityManifestEntry {
  const rule = getTransitionRule(evaluation.ruleId);
  const emergent = getWorldEntityOrThrow(rule.presetId, rule.targetEntityId);

  if (emergent.simulationTier === "full-autonomous") {
    throw new Error(
      `Emergent target ${rule.targetEntityId} is already full-autonomous; refusing transition apply.`
    );
  }

  const tier = rule.targetSimulationTier;
  if (tier !== "sphere-macro" && tier !== "historical-presence") {
    throw new Error(
      `Transition ${rule.ruleId} illegally targets ${String(tier)}; Tier-1 requires an authored migration.`
    );
  }

  const isMacro = tier === "sphere-macro";

  return {
    ...emergent,
    status: "sovereign",
    parentEntityId: undefined,
    coParentEntityIds: undefined,
    simulationTier: tier,
    economicArchetype: isMacro ? "macro" : "none",
    sphere: {
      ...emergent.sphere,
      relationships: activateProposedTreaties(emergent.sphere.relationships),
    },
    lifecycle: {
      ...emergent.lifecycle,
      expectedYear: evaluation.effectiveYear ?? evaluation.year,
    },
    readiness: {
      autonomous: "blocked",
      player: "blocked",
      hardBlockers: [
        AUTONOMY_BLOCKER,
        PLAYER_BLOCKER,
        ...(isMacro
          ? ["Sphere-macro countries have no domestic player offices or firm simulation."]
          : ["Historical-presence entities have no domestic player simulation."]),
      ],
      flavorGaps: ["Post-independence domestic politics and parties are not yet authored."],
    },
  };
}

/** @deprecated Prefer buildSovereignEntity — Ghana tracer compatibility wrapper. */
export function buildSovereignGhanaEntity(
  evaluation: TransitionEvaluation
): WorldEntityManifestEntry {
  return buildSovereignEntity(evaluation);
}

export function getSovereignSphereMembership(
  sovereignEntity: WorldEntityManifestEntry
): SphereMembership {
  if (sovereignEntity.sphere.relationships.length === 0) {
    throw new Error(
      `Sovereign entity ${sovereignEntity.entityId} has no sphere relationships; refusing empty membership.`
    );
  }
  const membership = membershipFromManifestEntry(sovereignEntity);
  assertValidSphereMembership(membership);
  return membership;
}

export function getGhanaSphereMembership(ghanaEntity?: WorldEntityManifestEntry): SphereMembership {
  const entry =
    ghanaEntity ??
    buildSovereignEntity({
      ruleId: GOLD_COAST_TO_GHANA_RULE_ID,
      sourceEntityId: GOLD_COAST_ENTITY_ID,
      targetEntityId: GHANA_ENTITY_ID,
      year: 1957,
      turn: 1,
      outcome: "sovereignty",
      score: 1,
      threshold: 0.35,
      historicalPrior: 0.55,
      pressureDelta: 0,
      rationale: [],
      un: { state: "admitted", rationale: [] },
      effectiveYear: 1957,
    });
  return getSovereignSphereMembership(entry);
}

/**
 * Apply a successful sovereignty decision for any authored transition rule.
 * Pure regarding evaluation; optional DB write seeds the Tier-2 macro document.
 */
export async function applySovereigntyTransition(
  evaluation: TransitionEvaluation,
  options: { db?: Db; now?: Date } = {}
): Promise<SovereigntyApplication> {
  if (evaluation.outcome !== "sovereignty") {
    throw new Error(
      `Cannot apply sovereignty for ${evaluation.ruleId}: outcome is ${evaluation.outcome}.`
    );
  }
  const rule = getTransitionRule(evaluation.ruleId);

  const sovereignEntity = buildSovereignEntity(evaluation);
  if (sovereignEntity.simulationTier === "full-autonomous") {
    throw new Error(`Refusing Tier-1 result for ${rule.ruleId}.`);
  }

  const now = options.now ?? new Date();
  const macroSeed =
    rule.targetSimulationTier === "sphere-macro"
      ? getTransitionMacroCountry(rule.targetEntityId, evaluation.turn, now)
      : null;

  if (rule.targetSimulationTier === "sphere-macro" && !macroSeed) {
    throw new Error(
      `Sphere-macro target ${rule.targetEntityId} has no authored macro seed; refusing apply.`
    );
  }

  const sphereMembership =
    sovereignEntity.sphere.relationships.length > 0
      ? getSovereignSphereMembership(sovereignEntity)
      : null;

  const un: UnLifecycleSnapshot = evaluation.un;
  const rationale = [
    ...evaluation.rationale,
    `Dissolved dependency ${rule.sourceEntityId}; created sovereign ${rule.targetEntityId} as ${rule.targetSimulationTier}.`,
    ...(sphereMembership
      ? [`Primary sphere: ${sphereMembership.primarySphereId}.`]
      : ["No sphere membership authored for this sovereign yet."]),
    `UN state: ${un.state}.`,
    ...un.rationale,
  ];

  if (options.db && macroSeed) {
    const collection = await getMacroCountriesCollection(options.db);
    await collection.updateOne(
      { _id: macroSeed._id },
      { $set: { ...macroSeed, updatedAt: now } },
      { upsert: true }
    );
  }

  return {
    evaluation,
    dissolvedEntityId: rule.sourceEntityId,
    sovereignEntity,
    macroSeed,
    sphereMembership,
    un,
    rationale,
  };
}

/**
 * Evaluate then apply when the decision is sovereignty; otherwise return the hold/prevented evaluation.
 */
export async function runTransition(
  ruleId: string,
  year: number,
  turn: number,
  pressures: Partial<TransitionPressures> = {},
  options: { db?: Db; now?: Date } = {}
): Promise<{ evaluation: TransitionEvaluation; application: SovereigntyApplication | null }> {
  const evaluation = evaluateTransition({
    ruleId,
    year,
    turn,
    pressures: { ...DEFAULT_TRANSITION_PRESSURES, ...pressures },
  });

  if (evaluation.outcome !== "sovereignty") {
    return { evaluation, application: null };
  }

  const application = await applySovereigntyTransition(evaluation, options);
  return { evaluation, application };
}

/** @deprecated Prefer runTransition — Ghana tracer compatibility wrapper. */
export async function runGoldCoastTransition(
  year: number,
  turn: number,
  pressures: Partial<TransitionPressures> = {},
  options: { db?: Db; now?: Date } = {}
): Promise<{ evaluation: TransitionEvaluation; application: SovereigntyApplication | null }> {
  return runTransition(GOLD_COAST_TO_GHANA_RULE_ID, year, turn, pressures, options);
}

export { evaluateTransitionWithDefaults };
